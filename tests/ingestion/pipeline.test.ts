/**
 * Uji integrasi pipeline ingestion + query admin di atas **skema sungguhan**.
 *
 * Cara kerjanya sama dengan `scripts/validate-schema.mjs`: `docs/schema.sql` dan
 * `docs/seed.sql` dieksekusi di Postgres (PGlite, WASM), lalu kode produksi
 * dijalankan di atasnya. Bedanya, yang diuji di sini bukan DDL melainkan jalur
 * yang memakainya:
 *
 *   1. `stageDatasetImport` (jalur request) → `claimNextPendingJob` → pipeline →
 *      `markJobCompleted` (jalur worker) benar-benar menghasilkan baris kanonik
 *      dengan atribusi lengkap.
 *   2. Menjalankan ulang dataset yang sama **tiga kali** tidak menambah baris dan
 *      melaporkan `records_created = 0` pada eksekusi berikutnya (AC-08).
 *   3. Kegagalan per record muncul di `ingestion_errors` dan dapat dibaca lewat
 *      query yang dipakai panel admin (AC-10).
 *   4. Kebijakan sumber benar-benar menggigit: allow-list, robots.txt (termasuk
 *      fail-closed), SSRF, dan rate limit per host — semuanya tanpa jaringan,
 *      karena `fetch` dan DNS disuntik.
 *   5. Query halaman admin berjalan di atas skema nyata — ini yang menangkap
 *      tabel/kolom yang disebut salah (dan sudah pernah menangkap satu).
 *
 * Node menjalankan TypeScript langsung (type stripping); repo ini tidak memakai
 * Jest, dan test engine juga memakai `node --test`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

import type { SqlClient } from '../../src/lib/db/client.ts';
import { stableContentHash } from '../../src/lib/stable-hash.ts';
import { datasetContentHash } from '../../src/services/ingestion/dataset.ts';
import { describeJobFailure, recordJobFailure, runIngestionJob } from '../../src/services/ingestion/pipeline.ts';
import type { IngestionDependencies } from '../../src/services/ingestion/pipeline.ts';
import { HostRateLimiter } from '../../src/services/ingestion/rate-limit.ts';
import type { Clock } from '../../src/services/ingestion/rate-limit.ts';
import type { FetchInitLike, FetchResponseLike } from '../../src/services/ingestion/http.ts';
import {
  enqueueIngestionJob,
  cancelIngestionJob,
  retryIngestionJob,
} from '../../src/services/queue/ingestion-jobs.ts';
import { claimNextPendingJob, markJobCompleted, markJobFailed } from '../../src/services/queue/job-lifecycle.ts';
import { stageDatasetImport } from '../../src/features/admin/import-requests.ts';
import {
  getConflictSummary,
  getDashboardSummary,
  getSystemStats,
  listConflicts,
  listIngestionErrors,
  listIngestionJobs,
} from '../../src/features/admin/queries.ts';

const resolveDoc = (name: string): string =>
  fileURLToPath(new URL(`../../docs/${name}`, import.meta.url));

function pgliteClient(db: PGlite): SqlClient {
  return {
    async query<T>(text: string, params?: readonly unknown[]): Promise<T[]> {
      const result = await db.query(text, params as unknown[]);
      return result.rows as T[];
    },
  };
}

/** Jam virtual: `sleep` memajukan waktu, sehingga kebijakan laju teruji tanpa menunggu. */
function virtualClock(startMs = 1_700_000_000_000): { clock: Clock; elapsed: () => number } {
  let now = startMs;
  return {
    clock: {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    },
    elapsed: () => now - startMs,
  };
}

interface FakeResponseInit {
  body?: string;
  headers?: Record<string, string>;
}

function fakeResponse(status: number, init: FakeResponseInit = {}): FetchResponseLike {
  const headers = init.headers ?? {};
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => init.body ?? '',
  };
}

/** Fetch palsu dengan rute eksplisit; permintaan tak dikenal = kegagalan test. */
function routedFetch(routes: Record<string, (init: FetchInitLike | undefined) => FetchResponseLike>) {
  const calls: string[] = [];
  const fetchImpl = async (url: string, init?: FetchInitLike): Promise<FetchResponseLike> => {
    calls.push(url);
    const route = routes[url];
    if (!route) throw new Error(`fetch tak terduga: ${url}`);
    return route(init);
  };
  return { fetchImpl, calls };
}

const db = await PGlite.create({ extensions: { pg_trgm, unaccent, pgcrypto } });
let sql: SqlClient;

before(async () => {
  await db.exec(readFileSync(resolveDoc('schema.sql'), 'utf8'));
  await db.exec(readFileSync(resolveDoc('seed.sql'), 'utf8'));
  sql = pgliteClient(db);

  // Sumber HTTP untuk uji fetch: satu-satunya sumber berskema http, ditambahkan
  // di sini karena adapter pihak ketiga memang tidak di-seed (butuh review legal).
  await sql.query(
    `insert into sources (slug, name, base_url, source_type, priority, legal_status,
                          legal_reviewed_by, legal_reviewed_at, respect_robots,
                          rate_limit_rps, max_fetches_per_day, license, license_url, attribution_text, is_active)
     values ('ext-test', 'Ext Test', 'https://ext.test/api/', 'api', 2, 'allowed',
             'tester', now(), true, 1.0, 100, 'cc-by-4.0', 'https://ext.test/license',
             'Data berasal dari Ext Test.', true)`,
  );
});

interface DatasetOptions {
  sourceSlug?: string;
  characterSlug?: string;
  abilityCategory?: string;
  tierCode?: string | null;
}

function sampleDataset(options: DatasetOptions = {}): Record<string, unknown> {
  const characterSlug = options.characterSlug ?? 'aster-vale';
  return {
    parser_version: 'dataset-json@1.0.0',
    source_slug: options.sourceSlug ?? 'admin-dataset-import',
    source_url: 'dataset://admin-dataset-import/test',
    verse: {
      slug: 'astral-verse',
      name: 'Astral Verse',
      description: 'Verse sintetis untuk uji integrasi pipeline.',
      origin_media: 'novel',
    },
    characters: [
      {
        slug: characterSlug,
        name: 'Aster Vale',
        native_name: null,
        description: 'Karakter sintetis untuk uji pipeline.',
        classification: 'swordsman',
        origin: 'Astral Verse',
        media_type: 'novel',
        forms: [
          {
            slug: 'squire',
            name: 'Aster Vale (Squire)',
            era: 'First arc',
            form_order: 1,
            is_default: true,
            tier_code: options.tierCode === undefined ? '5-B' : options.tierCode,
            statistics: [
              {
                metric: 'attack_potency',
                raw_text: 'Island level',
                qualifier: 'exact',
                confidence: 0.8,
                scale_code: 'island',
              },
              {
                metric: 'speed',
                raw_text: 'Massively FTL+',
                qualifier: 'possibly',
                confidence: 0.72,
                scale_code: 'mftl_plus',
              },
            ],
            abilities: [
              {
                category_slug: options.abilityCategory ?? 'time-manipulation',
                name: 'Time Stop',
                proficiency: 'master',
                evidence_text: 'Menghentikan waktu selama lima detik.',
                confidence: 0.9,
              },
            ],
            resistances: [
              {
                category_slug: 'time-manipulation',
                level: 2,
                evidence_text: 'Menahan manipulasi waktu.',
                confidence: 0.7,
              },
            ],
          },
          {
            slug: 'sovereign',
            name: 'Aster Vale (Sovereign)',
            era: 'Final arc',
            form_order: 2,
            is_default: false,
            statistics: [
              {
                metric: 'attack_potency',
                raw_text: 'Large Island level',
                qualifier: 'at_least',
                confidence: 0.85,
                scale_code: 'island',
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Mengklaim satu job tertentu lalu menjalankannya dengan jalur kegagalan yang
 * sama seperti worker (`recordJobFailure` + `markJobFailed`). Job pending lain
 * dinetralkan lebih dulu supaya klaimnya deterministik — tanpa itu, jadwal retry
 * job lain dapat membuat test ini bergantung pada waktu berjalan.
 */
async function runJobById(
  jobId: string,
  deps: IngestionDependencies,
): Promise<{ status: string; outcome?: Awaited<ReturnType<typeof runIngestionJob>> }> {
  await sql.query(
    `update ingestion_jobs set status = 'skipped', completed_at = now(), updated_at = now()
      where status = 'pending' and id <> $1`,
    [jobId],
  );

  const job = await claimNextPendingJob(sql);
  assert.ok(job, `job ${jobId} harus dapat diklaim`);
  assert.equal(job.job_id, jobId);

  try {
    const outcome = await runIngestionJob(job, deps);
    await markJobCompleted(sql, {
      job_id: job.job_id,
      records_found: outcome.records_found,
      records_created: outcome.records_created,
      records_updated: outcome.records_updated,
      records_failed: outcome.records_failed,
      parser_version: outcome.parser_version,
      partial: outcome.records_failed > 0,
    });
    return { status: outcome.records_failed > 0 ? 'partial' : 'completed', outcome };
  } catch (error) {
    const info = describeJobFailure(error);
    await recordJobFailure(sql, job.job_id, info, job.retry_count + 1);
    const after = await markJobFailed(sql, job.job_id, info.message, {
      error_type: info.error_type,
      terminal: info.terminal,
    });
    return { status: after.status };
  }
}

async function countRows(table: string, where = 'true'): Promise<number> {
  const rows = await sql.query<{ n: string }>(`select count(*)::text as n from ${table} where ${where}`);
  return Number(rows[0]!.n);
}

const DETACHED_DEPS: Omit<IngestionDependencies, 'sql'> = {
  fetchImpl: routedFetch({}).fetchImpl,
  dnsLookup: async () => ['93.184.216.34'],
  clock: virtualClock().clock,
  jitter: () => 0,
};

describe('pipeline ingestion di atas skema sungguhan', () => {
  it('impor dataset membuat baris kanonik ber-atribusi lengkap', async () => {
    const staged = await stageDatasetImport(sql, sampleDataset());
    const result = await runJobById(staged.job_id, { sql, ...DETACHED_DEPS });

    assert.equal(result.status, 'completed');
    const outcome = result.outcome!;
    assert.ok(
      outcome.records_created >= 7,
      `created=${outcome.records_created} (verse + karakter + 2 form + 3 statistik + ability + resistensi)`,
    );
    assert.equal(outcome.records_failed, 0);
    assert.equal(outcome.parser_version, 'dataset-json@1.0.0');

    assert.equal(await countRows('verses', `slug = 'astral-verse'`), 1);
    assert.equal(await countRows('characters', `slug = 'aster-vale'`), 1);
    assert.equal(await countRows('character_versions', `slug in ('squire','sovereign')`), 2);

    // Atribusi: inilah yang membuat AC-09 tetap benar setelah impor.
    const attribution = await sql.query<{
      source_slug: string;
      source_name: string;
      source_url: string | null;
    }>(
      `select s.slug as source_slug, ch.source_name, ch.source_url
         from characters ch join sources s on s.id = ch.source_id
        where ch.slug = 'aster-vale'`,
    );
    assert.equal(attribution[0]!.source_slug, 'admin-dataset-import');
    assert.equal(attribution[0]!.source_name, 'Admin Dataset Import');
    assert.match(attribution[0]!.source_url ?? '', /^dataset:\/\//);

    // Statistik: tier dipetakan trigger ke `tiers`, cache skala form terisi.
    const formCache = await sql.query<{ tier_code: string | null; ap_cached: boolean }>(
      `select t.tier_code, cv.attack_potency_scale_id is not null as ap_cached
         from character_versions cv
         left join tiers t on t.id = cv.tier_id
        where cv.slug = 'squire'`,
    );
    assert.equal(formCache[0]!.tier_code, '5-B');
    assert.equal(formCache[0]!.ap_cached, true);

    const ability = await sql.query<{ proficiency: string; category: string }>(
      `select ca.proficiency, ac.slug as category
         from character_abilities ca
         join abilities a on a.id = ca.ability_id
         join ability_categories ac on ac.id = a.category_id`,
    );
    assert.equal(ability.length, 1);
    assert.equal(ability[0]!.proficiency, 'master');
    assert.equal(ability[0]!.category, 'time-manipulation');

    const resistance = await sql.query<{ level: number; level_label: string }>(
      `select level, level_label from character_resistances`,
    );
    assert.equal(resistance.length, 1);
    assert.equal(resistance[0]!.level, 2);
    assert.equal(resistance[0]!.level_label, 'moderate');

    // Staging menyimpan halaman yang dapat di-parse ulang tanpa fetch.
    assert.equal(
      await countRows('ingestion_raw_pages', `source_id = (select id from sources where slug = 'admin-dataset-import')`),
      1,
    );
    const job = await sql.query<{ status: string; records_created: number }>(
      `select status, records_created from ingestion_jobs where id = $1`,
      [staged.job_id],
    );
    assert.equal(job[0]!.status, 'completed');
    assert.ok(job[0]!.records_created > 0);
  });

  it('menjalankan dataset yang sama 3× tidak menambah baris dan created = 0 (AC-08)', async () => {
    const forStaging = sampleDataset();
    const expectedHash = stableContentHash(forStaging);
    const expectedUrl = `dataset://admin-dataset-import/${expectedHash.slice(0, 12)}`;

    const baseline = {
      characters: await countRows('characters'),
      versions: await countRows('character_versions'),
      statistics: await countRows('statistics'),
      staging: await countRows('ingestion_raw_pages'),
    };

    const createdCounts: number[] = [];
    for (let i = 0; i < 2; i += 1) {
      // Staging dedup: hash identik → baris staging yang sama, bukan baris baru.
      const staged = await stageDatasetImport(sql, sampleDataset());
      const stagingRows = await sql.query<{ id: string }>(
        `select id from ingestion_raw_pages where source_url = $1 and content_hash = $2`,
        [expectedUrl, expectedHash],
      );
      assert.equal(stagingRows.length, 1);
      assert.equal(stagingRows[0]!.id, staged.raw_page_id);

      const result = await runJobById(staged.job_id, { sql, ...DETACHED_DEPS });
      assert.equal(result.status, 'completed');
      createdCounts.push(result.outcome!.records_created);
    }

    assert.deepEqual(createdCounts, [0, 0]);
    assert.equal(await countRows('characters'), baseline.characters);
    assert.equal(await countRows('character_versions'), baseline.versions);
    assert.equal(await countRows('statistics'), baseline.statistics);
    assert.equal(await countRows('ingestion_raw_pages'), baseline.staging);
  });

  it('reparse dari staging menghasilkan 0 baris baru (tanpa fetch)', async () => {
    const staged = await sql.query<{ id: string }>(
      `select id from ingestion_raw_pages
        where source_url like 'dataset://admin-dataset-import/%'
        order by fetched_at asc limit 1`,
    );
    const job = await enqueueIngestionJob(sql, { scope: 'reparse', target_ref: staged[0]!.id });
    const result = await runJobById(job.job_id, { sql, ...DETACHED_DEPS });

    assert.equal(result.status, 'completed');
    assert.equal(result.outcome!.records_created, 0);
    assert.equal(result.outcome!.records_updated, 0);
  });

  it('scheduled_full menerapkan staging terbaru dan melaporkan batasnya (bukan angka nol diam-diam)', async () => {
    const job = await enqueueIngestionJob(sql, { scope: 'scheduled_full' });
    const result = await runJobById(job.job_id, { sql, ...DETACHED_DEPS });

    assert.equal(result.status, 'completed');
    assert.equal(result.outcome!.records_created, 0, 'data sudah identik dengan staging terbaru');
    assert.ok(
      result.outcome!.notes.some((note) => note.includes('staging')),
      'notes harus menyebut apa yang benar-benar dikerjakan',
    );
  });

  it('dry-run tidak menulis satu baris pun dan melaporkan diff', async () => {
    const dataset = sampleDataset({ characterSlug: 'dryrun-char' });
    dataset.verse = { slug: 'dryrun-verse', name: 'Dryrun Verse', origin_media: 'other' };
    const staged = await stageDatasetImport(sql, dataset, { dryRun: true });
    const result = await runJobById(staged.job_id, { sql, ...DETACHED_DEPS });

    assert.equal(result.status, 'completed');
    const outcome = result.outcome!;
    assert.equal(outcome.dry_run, true);
    assert.ok(outcome.records_created > 0, 'diff dry-run melaporkan apa yang akan dibuat');
    assert.ok(outcome.notes.some((note) => note.includes('Dry-run')));

    assert.equal(await countRows('verses', `slug = 'dryrun-verse'`), 0);
    assert.equal(await countRows('characters', `slug = 'dryrun-char'`), 0);
  });

  it('record tak sah → records_failed, baris ingestion_errors, status partial (AC-10)', async () => {
    const dataset = sampleDataset({
      characterSlug: 'broken-char',
      abilityCategory: 'kategori-yang-tidak-ada',
    });
    const staged = await stageDatasetImport(sql, dataset);
    const result = await runJobById(staged.job_id, { sql, ...DETACHED_DEPS });

    assert.equal(result.status, 'partial');
    assert.ok(result.outcome!.records_failed >= 1);
    assert.equal(result.outcome!.error_code, 'PARTIAL');

    const errors = await listIngestionErrors(sql, { jobIds: [staged.job_id] });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.error_type, 'MissingRequiredField');
    assert.match(errors[0]!.error_message, /kategori-yang-tidak-ada/);

    const jobs = await listIngestionJobs(sql, { status: 'partial' });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]!.source_slug, 'admin-dataset-import');
  });

  it('dataset cacat bentuk → ParserError terminal: failed, bukan retry tanpa guna', async () => {
    const staged = await stageDatasetImport(sql, { source_slug: 'admin-dataset-import', verse: {} });
    const result = await runJobById(staged.job_id, { sql, ...DETACHED_DEPS });

    // Data yang sudah di-stage tidak berubah bila dicoba lagi; menahan job ini
    // di antrian hanya menunda terlihatnya masalah di panel admin.
    assert.equal(result.status, 'failed');

    const jobRow = await sql.query<{ status: string; error_type: string | null }>(
      `select status, error_type from ingestion_jobs where id = $1`,
      [staged.job_id],
    );
    assert.equal(jobRow[0]!.error_type, 'ParserError');

    const errors = await listIngestionErrors(sql, { jobIds: [staged.job_id] });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.error_type, 'ParserError');
    assert.match(errors[0]!.error_message, /bentuk minimum|verse wajib/i);
  });

  it('respons fetch yang rusak tetap dicoba ulang (sumber dapat pulih)', async () => {
    const { fetchImpl } = routedFetch({
      'https://ext.test/robots.txt': () => fakeResponse(200, { body: 'User-agent: *\nAllow: /\n' }),
      'https://ext.test/api/verse/broken': () => fakeResponse(200, { body: '<html>bukan json</html>' }),
    });
    const job = await enqueueIngestionJob(sql, { scope: 'import_url', target_ref: 'https://ext.test/api/verse/broken' });
    const result = await runJobById(job.job_id, { sql, fetchImpl, dnsLookup: async () => ['93.184.216.34'], clock: virtualClock().clock });

    assert.equal(result.status, 'pending', 'ParserError dari respons jaringan tidak terminal');
    const errors = await listIngestionErrors(sql, { jobIds: [job.job_id] });
    assert.equal(errors[0]!.error_type, 'ParserError');
    assert.match(errors[0]!.error_message, /bukan JSON yang sah/);
  });
});

describe('kebijakan sumber pada jalur fetch (tanpa jaringan)', () => {
  function remoteDataset(): Record<string, unknown> {
    const dataset = sampleDataset({ sourceSlug: 'ext-test', characterSlug: 'remote-char' });
    dataset.verse = { slug: 'remote-verse', name: 'Remote Verse', origin_media: 'other' };
    dataset.source_url = 'https://ext.test/api/verse/remote';
    return dataset;
  }

  it('URL di luar allow-list ditolak sebelum menyentuh jaringan', async () => {
    const { calls, fetchImpl } = routedFetch({});
    const job = await enqueueIngestionJob(sql, { scope: 'import_url', target_ref: 'https://evil.test/data.json' });
    const result = await runJobById(job.job_id, { sql, fetchImpl, dnsLookup: async () => ['93.184.216.34'], clock: virtualClock().clock });

    assert.equal(result.status, 'failed');
    assert.deepEqual(calls, []);
    const errors = await listIngestionErrors(sql, { jobIds: [job.job_id] });
    assert.equal(errors[0]!.error_type, 'PolicyBlocked');
    assert.match(errors[0]!.error_message, /allow-list/);
  });

  it('robots.txt melarang jalur → fetch dibatalkan', async () => {
    const { fetchImpl } = routedFetch({
      'https://ext.test/robots.txt': () => fakeResponse(200, { body: 'User-agent: *\nDisallow: /api/\n' }),
      'https://ext.test/api/verse/remote': () => fakeResponse(200, { body: JSON.stringify(remoteDataset()) }),
    });
    const job = await enqueueIngestionJob(sql, { scope: 'import_url', target_ref: 'https://ext.test/api/verse/remote' });
    const result = await runJobById(job.job_id, { sql, fetchImpl, dnsLookup: async () => ['93.184.216.34'], clock: virtualClock().clock });

    assert.equal(result.status, 'failed');
    const errors = await listIngestionErrors(sql, { jobIds: [job.job_id] });
    assert.equal(errors[0]!.error_type, 'PolicyBlocked');
    assert.match(errors[0]!.error_message, /robots\.txt melarang/);
  });

  it('robots.txt tidak dapat diambil → gagal tertutup', async () => {
    const { fetchImpl } = routedFetch({});
    const job = await enqueueIngestionJob(sql, { scope: 'import_url', target_ref: 'https://ext.test/api/verse/remote' });
    const result = await runJobById(job.job_id, { sql, fetchImpl, dnsLookup: async () => ['93.184.216.34'], clock: virtualClock().clock });

    assert.equal(result.status, 'failed');
    const errors = await listIngestionErrors(sql, { jobIds: [job.job_id] });
    assert.match(errors[0]!.error_message, /fail-closed/i);
  });

  it('alamat privat ditolak (SSRF) walaupun host cocok allow-list', async () => {
    await sql.query(
      `insert into sources (slug, name, base_url, source_type, priority, legal_status,
                            legal_reviewed_by, legal_reviewed_at, respect_robots, rate_limit_rps, license, is_active)
       values ('local-test', 'Local', 'http://127.0.0.1/', 'api', 2, 'allowed',
               'tester', now(), true, 1.0, 'internal-use', true)`,
    );
    const { calls, fetchImpl } = routedFetch({});
    const job = await enqueueIngestionJob(sql, { scope: 'import_url', target_ref: 'http://127.0.0.1/secret.json' });
    const result = await runJobById(job.job_id, { sql, fetchImpl, dnsLookup: async () => ['127.0.0.1'], clock: virtualClock().clock });

    assert.equal(result.status, 'failed');
    assert.deepEqual(calls, []);
    const errors = await listIngestionErrors(sql, { jobIds: [job.job_id] });
    assert.match(errors[0]!.error_message, /privat|SSRF/i);
  });

  it('fetch sukses: staging tersimpan, 304 dihormati, dan atribusi mengalir ke baris kanonik', async () => {
    const payload = remoteDataset();
    let contentFetches = 0;
    const { fetchImpl } = routedFetch({
      'https://ext.test/robots.txt': () => fakeResponse(200, { body: 'User-agent: *\nAllow: /\n' }),
      'https://ext.test/api/verse/remote': (init) => {
        contentFetches += 1;
        if (init?.headers?.['if-modified-since']) return fakeResponse(304);
        return fakeResponse(200, { body: JSON.stringify(payload) });
      },
    });

    const clock = virtualClock();
    const job = await enqueueIngestionJob(sql, { scope: 'import_url', target_ref: 'https://ext.test/api/verse/remote' });
    const first = await runJobById(job.job_id, { sql, fetchImpl, dnsLookup: async () => ['93.184.216.34'], clock: clock.clock });
    assert.equal(first.status, 'completed');
    assert.ok((first.outcome?.records_created ?? 0) > 0);

    const staged = await sql.query<{ source_url: string; parser_version: string }>(
      `select source_url, parser_version from ingestion_raw_pages where source_url = 'https://ext.test/api/verse/remote'`,
    );
    assert.equal(staged.length, 1);
    assert.equal(staged[0]!.parser_version, 'dataset-json@1.0.0');

    const remote = await sql.query<{ source_slug: string; source_name: string }>(
      `select s.slug as source_slug, ch.source_name
         from characters ch join sources s on s.id = ch.source_id
        where ch.slug = 'remote-char'`,
    );
    assert.equal(remote[0]!.source_slug, 'ext-test');
    assert.equal(remote[0]!.source_name, 'Ext Test');

    // Eksekusi kedua: staging terakhir membuat worker mengirim If-Modified-Since,
    // sumber menjawab 304 → tidak ada pekerjaan tulis, dan itu dinyatakan terbuka.
    const secondJob = await enqueueIngestionJob(sql, { scope: 'import_url', target_ref: 'https://ext.test/api/verse/remote' });
    const second = await runJobById(secondJob.job_id, { sql, fetchImpl, dnsLookup: async () => ['93.184.216.34'], clock: clock.clock });
    assert.equal(second.status, 'completed');
    assert.equal(second.outcome!.records_created, 0);
    assert.ok(second.outcome!.notes.some((note) => note.includes('304')));
    assert.equal(contentFetches, 2);
  });
});

describe('token bucket per host', () => {
  it('menahan permintaan keempat pada 1 req/s, burst 3, dan memakai kembali ember yang sama', async () => {
    const clock = virtualClock();
    const limiter = new HostRateLimiter(clock.clock);

    await limiter.acquire('ext.test', 1);
    await limiter.acquire('ext.test', 1);
    await limiter.acquire('ext.test', 1);
    assert.equal(clock.elapsed(), 0, 'tiga permintaan pertama masuk burst');

    await limiter.acquire('ext.test', 1);
    assert.ok(clock.elapsed() >= 1000, `permintaan keempat menunggu satu interval (elapsed=${clock.elapsed()}ms)`);

    // Host lain punya ember sendiri — membatasi per host, bukan global.
    const before = clock.elapsed();
    await limiter.acquire('other.test', 1);
    assert.equal(clock.elapsed(), before);
  });
});

describe('siklus hidup antrian', () => {
  it('klaim, backoff, terminal, retry, dan cancel berperilaku sesuai kontrak', async () => {
    await sql.query(`update ingestion_jobs set status = 'skipped', completed_at = now() where status = 'pending'`);
    assert.equal(await claimNextPendingJob(sql), null, 'antrian bersih setelah pending dinetralkan');

    const job = await enqueueIngestionJob(sql, { scope: 'reparse', max_retries: 2, priority: 1 });
    const claimed = await claimNextPendingJob(sql);
    assert.equal(claimed!.job_id, job.job_id);
    assert.equal(claimed!.scope, 'reparse');

    // Job yang sedang diproses tidak dapat dibatalkan dari jalur admin.
    assert.equal(await cancelIngestionJob(sql, job.job_id), false);

    const firstFailure = await markJobFailed(sql, job.job_id, 'sumber mati sementara', {
      error_type: 'SourceUnavailable',
      base_seconds: 1,
    });
    assert.equal(firstFailure.status, 'pending');
    assert.equal(firstFailure.retry_count, 1);

    // Backoff: percobaan berikutnya dijadwalkan di masa depan (2^1 × 1 detik),
    // sehingga job belum dapat diklaim sekarang — inilah yang mencegah job yang
    // sama membanjiri sumber yang sedang sakit.
    assert.ok(
      new Date(firstFailure.next_attempt_at).getTime() > Date.now(),
      'job yang gagal tidak langsung dapat diklaim lagi',
    );
    assert.equal(await claimNextPendingJob(sql), null, 'belum waktunya dicoba ulang');

    // Emulasi waktu berjalan (worker/cron menunggu); klaim tidak punya jam virtual.
    await sql.query(`update ingestion_jobs set next_attempt_at = now() - interval '1 second' where id = $1`, [
      job.job_id,
    ]);

    const claimedAgain = await claimNextPendingJob(sql);
    assert.equal(claimedAgain!.job_id, job.job_id);
    const secondFailure = await markJobFailed(sql, job.job_id, 'masih mati', {
      error_type: 'SourceUnavailable',
    });
    assert.equal(secondFailure.status, 'failed');

    const completed = await sql.query<{ completed_at: string | null; error_type: string }>(
      `select completed_at, error_type from ingestion_jobs where id = $1`,
      [job.job_id],
    );
    assert.ok(completed[0]!.completed_at !== null);
    assert.equal(completed[0]!.error_type, 'SourceUnavailable');

    // Retry manual mengembalikan ke pending tanpa menghapus riwayat percobaan.
    assert.equal(await retryIngestionJob(sql, job.job_id), true);
    const requeued = await sql.query<{ status: string; error_message: string | null; retry_count: number }>(
      `select status, error_message, retry_count from ingestion_jobs where id = $1`,
      [job.job_id],
    );
    assert.equal(requeued[0]!.status, 'pending');
    assert.equal(requeued[0]!.error_message, null);
    assert.equal(requeued[0]!.retry_count, 2);

    assert.equal(await cancelIngestionJob(sql, job.job_id), true);
    const skipped = await sql.query<{ status: string; completed_at: string | null }>(
      `select status, completed_at from ingestion_jobs where id = $1`,
      [job.job_id],
    );
    assert.equal(skipped[0]!.status, 'skipped');
    assert.ok(skipped[0]!.completed_at !== null);
  });

  it('kegagalan terminal langsung failed tanpa menunggu jatah retry', async () => {
    const { fetchImpl } = routedFetch({});
    const job = await enqueueIngestionJob(sql, {
      scope: 'import_url',
      target_ref: 'https://evil.test/x',
      max_retries: 5,
    });
    const result = await runJobById(job.job_id, { sql, fetchImpl, dnsLookup: async () => ['93.184.216.34'], clock: virtualClock().clock });

    assert.equal(result.status, 'failed');
    const row = await sql.query<{ status: string; retry_count: number }>(
      `select status, retry_count from ingestion_jobs where id = $1`,
      [job.job_id],
    );
    assert.equal(row[0]!.status, 'failed');
    assert.equal(row[0]!.retry_count, 1);
  });
});

describe('query panel admin di atas skema nyata', () => {
  it('ringkasan dashboard memakai tabel dan kolom yang benar-benar ada', async () => {
    const stats = await getSystemStats(sql);
    assert.ok(stats.total_characters >= 1);
    assert.ok(stats.total_verses >= 1);

    const summary = await getDashboardSummary(sql);
    assert.ok(summary.pending_jobs >= 0);
    assert.ok(summary.failed_jobs_24h >= 1, 'job gagal dari uji sebelumnya terhitung dalam 24 jam');
    assert.equal(typeof summary.open_conflicts, 'number');
    assert.ok(summary.last_ingestion !== null);
  });

  it('konflik sumber dibaca dari character_source_conflicts (bukan tabel karangan)', async () => {
    const character = await sql.query<{ id: string }>(`select id from characters where slug = 'aster-vale'`);
    const sources = await sql.query<{ id: string; slug: string }>(
      `select id, slug from sources where slug in ('admin-dataset-import', 'internal-editorial')`,
    );
    const sourceA = sources.find((row) => row.slug === 'admin-dataset-import')!.id;
    const sourceB = sources.find((row) => row.slug === 'internal-editorial')!.id;

    await sql.query(
      `insert into character_source_conflicts (character_id, field, value_a, value_b, source_a_id, source_b_id)
       values ($1, 'attack_potency', 'Island level', 'Country level', $2, $3)`,
      [character[0]!.id, sourceA, sourceB],
    );

    const summary = await getConflictSummary(sql);
    assert.equal(summary.pending, 1);
    assert.equal(summary.total, 1);

    const conflicts = await listConflicts(sql, {});
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.character_slug, 'aster-vale');
    assert.equal(conflicts[0]!.metric, 'attack_potency');
    assert.equal(conflicts[0]!.source_a_name, 'Admin Dataset Import');
  });

  it('daftar job membawa atribusi sumber dan dapat difilter per status', async () => {
    const all = await listIngestionJobs(sql, { limit: 100 });
    assert.ok(all.length >= 4);

    const completed = await listIngestionJobs(sql, { status: 'completed' });
    assert.ok(completed.length >= 1);
    assert.ok(completed.every((job) => job.status === 'completed'));

    const withSource = all.find((job) => job.source_slug !== null);
    assert.ok(withSource, 'setidaknya satu job punya sumber (atribusi)');
  });
});

describe('paritas hash lintas zona', () => {
  it('sisi request dan sisi worker menghitung content_hash yang sama', () => {
    const payload = sampleDataset();
    assert.equal(stableContentHash(payload), datasetContentHash(payload));
  });

  it('urutan kunci tidak mengubah hash (kunci idempotensi staging)', () => {
    const payload = sampleDataset() as Record<string, unknown>;
    const reordered: Record<string, unknown> = {};
    for (const key of Object.keys(payload).sort().reverse()) {
      reordered[key] = payload[key];
    }
    assert.equal(stableContentHash(payload), stableContentHash(reordered));
  });
});
