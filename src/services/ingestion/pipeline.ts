/**
 * Jalur ingestion — **hanya untuk worker** (PRD §18.1, AC-25).
 *
 * Zona ini dilarang diimpor dari jalur request pengguna. Pelarangan itu bukan
 * konvensi: `tools/architecture/zones.mjs` mendaftarkannya sebagai zona
 * terlarang, dan `npm run lint` gagal bila ada route, page, atau modul
 * `features/*` yang mengimpornya — termasuk secara transitif.
 *
 * Tujuh tahap PRD §18.1 dijalankan berurutan:
 *   fetch → parse → normalize → validate → dedupe/resolve → upsert → staging
 *
 * Yang perlu diketahui pembaca tentang desainnya:
 *
 * - **Semua I/O dapat disuntik** (`FetchLike`, `DnsLookup`, `Clock`). Itu yang
 *   membuat kebijakan (robots, allow-list, SSRF, rate limit, retry) dapat diuji
 *   deterministik tanpa jaringan — dan di produksi defaultnya adalah implementasi
 *   nyata (`fetch`, `node:dns`, jam sistem).
 * - **Dry-run tidak menulis apa pun**, termasuk baris `ingestion_errors`; diff-nya
 *   dilaporkan lewat `records_*` dan `notes`.
 * - **Kegagalan ber-tipe.** `SourcePolicyError` (kebijakan), `IngestionFetchError`
 *   (jaringan/HTTP), `ParserIngestionError` (data) masing-masing membawa
 *   `error_type` yang diteruskan ke `ingestion_jobs.error_type` — sehingga panel
 *   admin menyebut kategori yang benar, bukan `ParserError` untuk semua hal.
 * - **Idempoten karena lapisan upsert**, bukan karena kebetulan: menjalankan job
 *   yang sama berulang kali tidak menambah baris (AC-08).
 */

import { createHash } from 'node:crypto';

import type { SqlClient } from '../../lib/db/client.ts';
import type { ClaimedIngestionJob, IngestionErrorType } from '../queue/job-lifecycle.ts';

import {
  DATASET_PARSER_VERSION,
  datasetContentHash,
  datasetStagingUrl,
  parseDatasetEnvelope,
} from './dataset.ts';
import type { DatasetEnvelope } from './dataset.ts';
import { applyDataset } from './upsert.ts';
import type { RecordFailure } from './upsert.ts';
import {
  SourcePolicyError,
  assertSourceUsable,
  listEnabledSources,
  loadSourceById,
  loadSourceBySlug,
  resolveSourceForUrl,
} from './sources.ts';
import type { IngestionSource } from './sources.ts';
import { HostRateLimiter, systemClock } from './rate-limit.ts';
import type { Clock } from './rate-limit.ts';
import { RobotsGate } from './robots.ts';
import { IngestionFetchError, fetchSourcePage } from './fetcher.ts';
import { systemDnsLookup, systemFetch } from './http.ts';
import type { DnsLookup, FetchLike } from './http.ts';

export interface IngestionOutcome {
  records_found: number;
  records_created: number;
  records_updated: number;
  records_failed: number;
  /** Diisi bila hasil parsial; penyebabnya harus dapat dilacak (PRD §39). */
  error_code: string | null;
  error_message: string | null;
  parser_version: string | null;
  /** Catatan operasional (mis. sumber dilewati karena prioritas, 304). */
  notes: string[];
  dry_run: boolean;
}

/** Kegagalan data — bukan kebijakan, bukan jaringan. */
export class ParserIngestionError extends Error {
  override readonly name = 'ParserIngestionError';
  readonly error_type = 'ParserError' as const;
  readonly http_status: number | null = null;
  /**
   * `true` bila mengulang tidak akan mengubah apa pun (data yang di-stage sudah
   * tetap). Untuk isi yang baru dipetik dari sumber, `false`: sumber dapat
   * memperbaiki responsnya, jadi job layak dicoba ulang.
   */
  readonly terminal: boolean;

  constructor(message: string, terminal = true) {
    super(message);
    this.terminal = terminal;
  }
}

export interface IngestionDependencies {
  sql: SqlClient;
  fetchImpl?: FetchLike;
  dnsLookup?: DnsLookup;
  clock?: Clock;
  robots?: RobotsGate;
  rateLimiter?: HostRateLimiter;
  timeoutMs?: number;
  jitter?: () => number;
}

interface StagedPage {
  id: string;
  job_id: string | null;
  source_id: string | null;
  source_url: string;
  parsed_json: unknown;
  parser_version: string;
  content_hash: string;
  fetched_at: string;
}

interface SourceOutcome {
  found: number;
  created: number;
  updated: number;
  failed: number;
  notes: string[];
  parserVersion: string;
}

function emptySourceOutcome(): SourceOutcome {
  return { found: 0, created: 0, updated: 0, failed: 0, notes: [], parserVersion: DATASET_PARSER_VERSION };
}

export class IngestionNotImplementedError extends Error {
  override readonly name = 'IngestionNotImplementedError';
  readonly job_id: string;

  constructor(job_id: string) {
    super(`Scope job ${job_id} belum diimplementasikan pada pipeline ini.`);
    this.job_id = job_id;
  }
}

async function loadStagedPage(sql: SqlClient, ref: string | null): Promise<StagedPage> {
  if (!ref) {
    throw new ParserIngestionError('Job ini memerlukan target_ref berisi id halaman staging.');
  }
  const rows = await sql.query<StagedPage>(
    `select id, job_id, source_id, source_url, parsed_json, parser_version, content_hash, fetched_at
       from ingestion_raw_pages
      where id = $1`,
    [ref],
  );
  const page = rows[0];
  if (!page) {
    throw new ParserIngestionError(
      `Halaman staging ${ref} tidak ditemukan; job tidak dapat dilanjutkan tanpa sumber datanya.`,
    );
  }
  return page;
}

async function latestStagedPageForSource(sql: SqlClient, sourceId: string): Promise<StagedPage | null> {
  const rows = await sql.query<StagedPage>(
    `select id, job_id, source_id, source_url, parsed_json, parser_version, content_hash, fetched_at
       from ingestion_raw_pages
      where source_id = $1
      order by fetched_at desc
      limit 1`,
    [sourceId],
  );
  return rows[0] ?? null;
}

async function stageRawPage(
  sql: SqlClient,
  input: { jobId: string; sourceId: string; sourceUrl: string; payload: unknown; parserVersion: string },
): Promise<void> {
  const contentHash = datasetContentHash(input.payload);
  await sql.query(
    `insert into ingestion_raw_pages (job_id, source_id, source_url, parsed_json, parser_version, content_hash)
     values ($1, $2, $3, $4::jsonb, $5, $6)
     on conflict (source_url, content_hash, parser_version) do nothing`,
    [input.jobId, input.sourceId, input.sourceUrl, JSON.stringify(input.payload), input.parserVersion, contentHash],
  );
}

async function writeRecordFailures(
  sql: SqlClient,
  jobId: string,
  failures: readonly RecordFailure[],
): Promise<void> {
  for (const failure of failures) {
    await sql.query(
      `insert into ingestion_errors (job_id, source_url, error_type, error_message, http_status, payload, retry_count)
       values ($1, $2, $3, $4, $5, $6::jsonb, 0)`,
      [
        jobId,
        failure.source_url,
        failure.error_type,
        failure.message.slice(0, 2000),
        failure.http_status,
        typeof failure.payload === 'string' ? failure.payload : JSON.stringify(failure.payload),
      ],
    );
  }
}

/**
 * Menjalankan satu dataset (sudah berbentuk envelope) terhadap database.
 * Dipakai oleh semua scope: import_dataset, reparse, import_url, sync terjadwal.
 */
async function applyEnvelope(
  deps: IngestionDependencies,
  job: ClaimedIngestionJob,
  envelope: DatasetEnvelope,
): Promise<SourceOutcome> {
  const sql = deps.sql;
  const source = await loadSourceBySlug(sql, envelope.source_slug);
  if (!source) {
    throw new SourcePolicyError(
      `Sumber "${envelope.source_slug}" tidak terdaftar di registry; impor ditolak (PRD §18.5).`,
    );
  }
  assertSourceUsable(source);

  const report = await applyDataset(
    {
      sql,
      source,
      jobId: job.job_id,
      parserVersion: envelope.parser_version,
      dryRun: job.dry_run,
      // Jejak asal yang ditulis ke baris kanonik: URL dataset bila ada, jika
      // tidak basis registry sumber. Tanpa ini, `characters.source_url` terisi
      // `about:dataset` dan atribusi kehilangan tautan ke berkas asalnya.
      provenanceUrl: envelope.source_url ?? source.base_url,
    },
    envelope,
  );

  if (!job.dry_run && report.failures.length > 0) {
    await writeRecordFailures(sql, job.job_id, report.failures);
  }
  if (job.dry_run) {
    report.notes.push('Dry-run: tidak ada baris yang ditulis (termasuk ingestion_errors).');
  }

  return {
    found: report.found,
    created: report.created,
    updated: report.updated,
    failed: report.failed,
    notes: report.notes,
    parserVersion: envelope.parser_version,
  };
}

function parseEnvelopeFrom(value: unknown, terminal: boolean): DatasetEnvelope {
  const parsed = parseDatasetEnvelope(value);
  if (!parsed.ok) {
    const detail = parsed.issues
      .slice(0, 5)
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join('; ');
    throw new ParserIngestionError(
      `Dataset tidak memenuhi bentuk minimum (${parsed.issues.length} masalah): ${detail}`,
      terminal,
    );
  }
  return parsed.dataset;
}

/** Scope import_dataset / reparse / single_*: semua membaca halaman staging. */
async function runFromStaging(
  deps: IngestionDependencies,
  job: ClaimedIngestionJob,
): Promise<SourceOutcome> {
  const page = await loadStagedPage(deps.sql, job.target_ref);
  // Data yang sudah di-stage tidak berubah bila dicoba lagi → terminal.
  const envelope = parseEnvelopeFrom(page.parsed_json, true);

  if (job.scope === 'single_character' && envelope.characters.length !== 1) {
    throw new ParserIngestionError(
      `Scope single_character memerlukan dataset dengan tepat satu karakter; ditemukan ${envelope.characters.length}.`,
    );
  }
  if (job.scope === 'single_verse') {
    // Impor verse saja: karakter pada dataset yang sama tidak diikutkan.
    return applyEnvelope(deps, job, { ...envelope, characters: [] });
  }
  return applyEnvelope(deps, job, envelope);
}

function buildFetcherOptions(deps: IngestionDependencies) {
  const clock = deps.clock ?? systemClock;
  const fetchImpl = deps.fetchImpl ?? systemFetch;
  return {
    fetchImpl,
    dnsLookup: deps.dnsLookup ?? systemDnsLookup,
    clock,
    rateLimiter: deps.rateLimiter ?? new HostRateLimiter(clock),
    robots: deps.robots ?? new RobotsGate({ fetchImpl, clock }),
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
    ...(deps.jitter === undefined ? {} : { jitter: deps.jitter }),
  };
}

async function resolveFetchSource(
  deps: IngestionDependencies,
  job: ClaimedIngestionJob,
  url: string,
): Promise<IngestionSource> {
  const sql = deps.sql;
  let source: IngestionSource | null = null;
  if (job.source_id) {
    source = await loadSourceById(sql, job.source_id);
  }
  if (source === null) {
    source = resolveSourceForUrl(await listEnabledSources(sql), url);
  }
  if (source === null) {
    throw new SourcePolicyError(
      `URL ${url} tidak cocok dengan sumber mana pun di allow-list; impor ditolak (PRD §18.5).`,
    );
  }
  assertSourceUsable(source);
  return source;
}

/** Scope import_url: satu-satunya jalur yang benar-benar melakukan fetch. */
async function runFromUrl(deps: IngestionDependencies, job: ClaimedIngestionJob): Promise<SourceOutcome> {
  const sql = deps.sql;
  const url = job.target_ref;
  if (!url) {
    throw new ParserIngestionError('Scope import_url memerlukan target_ref berisi URL.');
  }

  const source = await resolveFetchSource(deps, job, url);

  const lastRows = await sql.query<{ fetched_at: string | null }>(
    `select max(fetched_at)::text as fetched_at
       from ingestion_raw_pages
      where source_id = $1 and source_url = $2`,
    [source.id, url],
  );
  const ifModifiedSince = lastRows[0]?.fetched_at ?? null;

  const result = await fetchSourcePage(source, url, buildFetcherOptions(deps), { ifModifiedSince });
  if (result.notModified) {
    return {
      ...emptySourceOutcome(),
      notes: [`Sumber menjawab 304 Not Modified; tidak ada halaman baru untuk diproses.`],
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(result.text);
  } catch (error) {
    // Respons yang rusak dapat berasal dari gangguan sesaat di sumber; job
    // masih layak dicoba ulang.
    throw new ParserIngestionError(
      `Respons ${result.url} bukan JSON yang sah: ${error instanceof Error ? error.message : String(error)}`,
      false,
    );
  }

  const envelope = parseEnvelopeFrom(payload, false);
  if (!job.dry_run) {
    await stageRawPage(sql, {
      jobId: job.job_id,
      sourceId: source.id,
      sourceUrl: result.url,
      payload,
      parserVersion: envelope.parser_version,
    });
  }
  return applyEnvelope(deps, job, envelope);
}

/**
 * Scope sinkronisasi (manual_run / incremental / scheduled_full).
 *
 * Versi ini sengaja jujur tentang batasnya: ia menerapkan **halaman staging
 * terbaru per sumber** — pekerjaan "reparse dari staging" yang idempoten, tanpa
 * fetch baru. Adapter crawling per sumber (discovery) belum ada; menambahkan
 * fetch di sini tanpa adapter hanya akan menghasilkan angka nol yang menyamar
 * sebagai pekerjaan. Bila belum ada staging sama sekali, hasilnya dilaporkan
 * apa adanya lewat `notes`.
 */
async function runSync(deps: IngestionDependencies, job: ClaimedIngestionJob): Promise<SourceOutcome> {
  const sql = deps.sql;
  const sources = await listEnabledSources(sql);
  const outcome = emptySourceOutcome();
  let applied = 0;

  for (const source of sources) {
    const page = await latestStagedPageForSource(sql, source.id);
    if (!page) continue;

    const envelope = parseEnvelopeFrom(page.parsed_json, true);
    const result = await applyEnvelope(deps, job, envelope);
    applied += 1;
    outcome.found += result.found;
    outcome.created += result.created;
    outcome.updated += result.updated;
    outcome.failed += result.failed;
    outcome.notes.push(...result.notes.map((note) => `[${source.slug}] ${note}`));
  }

  if (applied === 0) {
    outcome.notes.push(
      'Tidak ada halaman staging untuk diterapkan. Sumber tanpa adapter crawling tidak di-fetch otomatis (lihat runbook).',
    );
  } else {
    outcome.notes.push(`Menerapkan staging terbaru dari ${applied} sumber.`);
  }

  return outcome;
}

/**
 * Menjalankan satu job yang sudah diklaim worker.
 *
 * Melempar untuk kegagalan job (kebijakan/jaringan/data) — worker menangkapnya,
 * menulis baris `ingestion_errors`, lalu memanggil `markJobFailed` dengan
 * `error_type` dan jeda yang sesuai.
 */
export async function runIngestionJob(
  job: ClaimedIngestionJob,
  deps: IngestionDependencies,
): Promise<IngestionOutcome> {
  let result: SourceOutcome;

  switch (job.scope) {
    case 'import_dataset':
    case 'reparse':
    case 'single_character':
    case 'single_verse':
      result = await runFromStaging(deps, job);
      break;
    case 'import_url':
      result = await runFromUrl(deps, job);
      break;
    case 'manual_run':
    case 'incremental':
    case 'scheduled_full':
      result = await runSync(deps, job);
      break;
    default:
      throw new IngestionNotImplementedError(job.job_id);
  }

  return {
    records_found: result.found,
    records_created: result.created,
    records_updated: result.updated,
    records_failed: result.failed,
    error_code: result.failed > 0 ? 'PARTIAL' : null,
    error_message: null,
    parser_version: result.parserVersion,
    notes: result.notes,
    dry_run: job.dry_run,
  };
}

export interface JobFailureInfo {
  error_type: IngestionErrorType;
  message: string;
  http_status: number | null;
  terminal: boolean;
  retry_after_seconds: number | null;
}

/** Menerjemahkan error apa pun menjadi informasi kegagalan yang siap dicatat. */
export function describeJobFailure(error: unknown): JobFailureInfo {
  if (error instanceof SourcePolicyError) {
    return { error_type: 'PolicyBlocked', message: error.message, http_status: null, terminal: true, retry_after_seconds: null };
  }
  if (error instanceof IngestionFetchError) {
    return {
      error_type: error.error_type,
      message: error.message,
      http_status: error.http_status,
      terminal: error.terminal,
      retry_after_seconds: error.retry_after_seconds,
    };
  }
  if (error instanceof ParserIngestionError) {
    // `terminal` dibawa dari error-nya: data yang sudah di-stage bersifat tetap,
    // sedangkan respons jaringan yang rusak masih dapat pulih.
    return {
      error_type: 'ParserError',
      message: error.message,
      http_status: null,
      terminal: error.terminal,
      retry_after_seconds: null,
    };
  }
  return {
    error_type: 'ParserError',
    message: error instanceof Error ? error.message : String(error),
    http_status: null,
    terminal: false,
    retry_after_seconds: null,
  };
}

/**
 * Mencatat kegagalan job yang tidak sampai ke lapisan per-record (kebijakan,
 * jaringan, parser) ke `ingestion_errors` — supaya error panel admin punya
 * detail yang sama untuk kedua jenis kegagalan (AC-10).
 */
export async function recordJobFailure(
  sql: SqlClient,
  jobId: string,
  info: JobFailureInfo,
  retryCount = 0,
): Promise<void> {
  const payload = createHash('sha256').update(info.message).digest('hex').slice(0, 16);
  await sql.query(
    `insert into ingestion_errors (job_id, error_type, error_message, http_status, payload, retry_count)
     values ($1, $2, $3, $4, $5::jsonb, $6)`,
    [jobId, info.error_type, info.message.slice(0, 2000), info.http_status, JSON.stringify({ context: payload }), retryCount],
  );
}

/** Dipakai seed/testing: URL staging kanonik untuk sebuah dataset. */
export function stagingUrlFor(sourceSlug: string, payload: unknown): string {
  return datasetStagingUrl(sourceSlug, datasetContentHash(payload));
}
