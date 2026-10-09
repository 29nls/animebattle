/**
 * Penyiapan impor terkelola dari jalur request (PRD §18.1, AC-25).
 *
 * Modul ini adalah **satu-satunya** pekerjaan yang boleh dilakukan jalur request
 * untuk impor: menulis satu baris staging (`ingestion_raw_pages`) dan satu baris
 * antrian (`ingestion_jobs`). Tidak ada fetch, parse, validasi mendalam, atau
 * upsert di sini — semuanya pekerjaan worker, dan validasi bentuk penuh ada di
 * `services/ingestion/dataset.ts` yang sengaja tidak boleh diimpor dari zona ini.
 *
 * Konsekuensi yang disengaja: dataset yang cacat **tetap** masuk antrian, lalu
 * gagal di worker dengan `ParserError` dan alasannya yang spesifik. Itu lebih
 * baik daripada route menyimpan salinan aturan validasi yang bisa berbeda dari
 * aturan yang benar-benar dijalankan. Yang diperiksa di sini hanya hal-hal yang
 * tidak dapat ditunda: ukuran, tipe, keberadaan `source_slug`, dan status
 * kebijakan sumber (IG-3/LP-6) — kegagalan pada pemeriksaan itu tidak ada
 * gunanya diantrikan.
 */

import { stableContentHash, stableSerialize } from '../../lib/stable-hash.ts';
import { resolveSourceForUrl } from '../../lib/source-allow-list.ts';
import type { SqlClient } from '../../lib/db/client.ts';
import { enqueueIngestionJob } from '../../services/queue/ingestion-jobs.ts';

/** Batas ukuran dataset yang diterima jalur request (≈ 1 MB). */
export const MAX_DATASET_BYTES = 1_000_000;

export const DEFAULT_DATASET_PARSER_VERSION = 'dataset-json@1.0.0';

export type ImportRequestErrorCode = 'INVALID_INPUT' | 'SOURCE_DISABLED';

export class ImportRequestError extends Error {
  override readonly name = 'ImportRequestError';
  readonly code: ImportRequestErrorCode;

  constructor(code: ImportRequestErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

interface ImportUrlCandidate {
  id: string;
  slug: string;
  base_url: string;
  legal_status: string;
  is_active: boolean;
  license: string | null;
}

export interface ResolvedImportUrl {
  source_id: string;
  source_slug: string;
}

/**
 * Menjawab "boleh tidaknya URL ini diimpor" **sebelum** ia masuk antrian
 * (AC-19: 409 `SOURCE_DISABLED` + pesan kebijakan).
 *
 * Pencocokan memakai `src/lib/source-allow-list.ts` — implementasi yang sama
 * dengan yang dipakai worker, sehingga tidak ada kemungkinan UI menerima URL
 * yang kemudian ditolak worker, atau sebaliknya. Worker tetap memeriksanya lagi:
 * pemeriksaan di sini menjaga kontrak HTTP, pemeriksaan di sana menjaga
 * jaringan. Keduanya diperlukan.
 */
export async function resolveImportUrlSource(sql: SqlClient, url: string): Promise<ResolvedImportUrl> {
  const candidates = await sql.query<ImportUrlCandidate>(
    `select id, slug, base_url, legal_status, is_active, license
       from sources
      where is_active and legal_status = 'allowed'`,
  );

  const match = resolveSourceForUrl(candidates, url);
  if (!match) {
    throw new ImportRequestError(
      'SOURCE_DISABLED',
      `URL ${url} tidak cocok dengan allow-list sumber (base_url) mana pun yang berstatus allowed; impor ditolak (IG-3).`,
    );
  }
  if (match.license === null || match.license.trim() === '') {
    throw new ImportRequestError(
      'SOURCE_DISABLED',
      `Sumber "${match.slug}" tidak mencantumkan lisensi; impor ditolak (LP-6).`,
    );
  }

  return { source_id: match.id, source_slug: match.slug };
}

export interface StagedDatasetImport {
  job_id: string;
  status: 'pending';
  created_at: string;
  raw_page_id: string;
  source_slug: string;
  content_hash: string;
}

interface SourcePolicyRow {
  id: string;
  slug: string;
  legal_status: string;
  is_active: boolean;
  license: string | null;
}

/**
 * Men-stage dataset lalu mengantrikan job `import_dataset`.
 *
 * `dry_run` diteruskan ke antrian: worker akan menjalankan seluruh pemeriksaan
 * dan pembacaan tanpa menulis apa pun, sehingga admin melihat diff sebelum
 * menekan Commit (PRD §25.3).
 */
export async function stageDatasetImport(
  sql: SqlClient,
  dataset: unknown,
  options: { dryRun?: boolean; createdBy?: string } = {},
): Promise<StagedDatasetImport> {
  if (typeof dataset !== 'object' || dataset === null || Array.isArray(dataset)) {
    throw new ImportRequestError('INVALID_INPUT', 'Dataset harus berupa objek JSON.');
  }

  const record = dataset as Record<string, unknown>;
  const sourceSlug = typeof record.source_slug === 'string' ? record.source_slug.trim() : '';
  if (sourceSlug === '') {
    throw new ImportRequestError(
      'INVALID_INPUT',
      'Dataset wajib menyertakan source_slug — atribusi tidak boleh ditebak (AC-09).',
    );
  }

  const parserVersion =
    typeof record.parser_version === 'string' && record.parser_version.trim() !== ''
      ? record.parser_version.trim()
      : DEFAULT_DATASET_PARSER_VERSION;

  const serialized = stableSerialize(dataset);
  if (serialized.length > MAX_DATASET_BYTES) {
    throw new ImportRequestError(
      'INVALID_INPUT',
      `Dataset ${serialized.length} byte melebihi batas ${MAX_DATASET_BYTES} byte; pecah per verse.`,
    );
  }

  const sourceRows = await sql.query<SourcePolicyRow>(
    `select id, slug, legal_status, is_active, license from sources where slug = $1`,
    [sourceSlug],
  );
  const source = sourceRows[0];
  if (!source) {
    throw new ImportRequestError(
      'INVALID_INPUT',
      `Sumber "${sourceSlug}" tidak terdaftar di registry; daftarkan lebih dulu (PRD §18.5).`,
    );
  }
  if (source.legal_status !== 'allowed' || !source.is_active) {
    throw new ImportRequestError(
      'SOURCE_DISABLED',
      `Sumber "${sourceSlug}" berstatus ${source.legal_status}${source.is_active ? '' : '/nonaktif'}; impor ditolak (IG-3).`,
    );
  }
  if (source.license === null || source.license.trim() === '') {
    throw new ImportRequestError(
      'SOURCE_DISABLED',
      `Sumber "${sourceSlug}" tidak mencantumkan lisensi; impor ditolak (LP-6).`,
    );
  }

  const contentHash = stableContentHash(dataset);
  const sourceUrl = `dataset://${sourceSlug}/${contentHash.slice(0, 12)}`;

  const inserted = await sql.query<{ id: string }>(
    `insert into ingestion_raw_pages (job_id, source_id, source_url, parsed_json, parser_version, content_hash)
     values (null, $1, $2, $3::jsonb, $4, $5)
     on conflict (source_url, content_hash, parser_version) do nothing
     returning id`,
    [source.id, sourceUrl, serialized, parserVersion, contentHash],
  );

  let rawPageId = inserted[0]?.id ?? null;
  if (rawPageId === null) {
    // Sudah pernah di-stage dengan hash yang sama: pakai baris yang ada, dan
    // jangan buat duplikat — inilah perilaku "re-run 3×" yang diminta AC-08.
    const existing = await sql.query<{ id: string }>(
      `select id from ingestion_raw_pages where source_url = $1 and content_hash = $2 and parser_version = $3`,
      [sourceUrl, contentHash, parserVersion],
    );
    rawPageId = existing[0]?.id ?? null;
  }
  if (rawPageId === null) {
    throw new ImportRequestError('INVALID_INPUT', 'Staging dataset gagal dibuat; coba lagi.');
  }

  const job = await enqueueIngestionJob(sql, {
    scope: 'import_dataset',
    target_ref: rawPageId,
    source_id: source.id,
    dry_run: options.dryRun,
    created_by: options.createdBy,
  });

  await sql.query(`update ingestion_raw_pages set job_id = $2 where id = $1`, [rawPageId, job.job_id]);

  return {
    job_id: job.job_id,
    status: job.status,
    created_at: job.created_at,
    raw_page_id: rawPageId,
    source_slug: sourceSlug,
    content_hash: contentHash,
  };
}
