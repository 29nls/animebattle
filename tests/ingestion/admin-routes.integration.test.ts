/**
 * Loop lengkap lewat **handler route sungguhan**: admin mengantrikan impor lewat
 * API, cron mengerjakannya, dan panel admin melihat hasilnya.
 *
 * Berbeda dari `pipeline.test.ts` (yang memanggil modul pipeline langsung), test
 * ini memanggil `Request` ke handler Next.js — jadi yang diperiksa adalah
 * kontrak yang benar-benar dipakai: status HTTP, bentuk JSON, guard Bearer,
 * dan urutan "antri dulu, kerjakan kemudian" (AC-25).
 *
 * Database tetap nyata (PGlite + `docs/schema.sql` + `docs/seed.sql`), tetapi
 * disuntikkan lewat `setSqlClient()` — antarmuka yang memang disediakan untuk
 * worker/test/CLI. Tidak ada mock SQL di sini: yang diuji adalah query asli.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

// Impor rute memakai jalur relatif, bukan alias `@/`: loader alias memetakan
// `@/` ke `src/`, sedangkan route berada di `app/` — pola yang sama dengan
// `tests/security/*.integration.test.ts`. Alias `@/` yang ada *di dalam* route
// tetap diselesaikan loader.
import { setSqlClient } from '../../src/lib/db/client.ts';
import type { SqlClient } from '../../src/lib/db/client.ts';
import { POST as importPost } from '../../app/api/admin/ingestion/import/route.ts';
import { GET as jobsGet } from '../../app/api/admin/ingestion/jobs/route.ts';
import { GET as errorsGet } from '../../app/api/admin/ingestion/jobs/[id]/errors/route.ts';
import { POST as retryPost } from '../../app/api/admin/ingestion/jobs/[id]/retry/route.ts';
import { POST as cancelPost } from '../../app/api/admin/ingestion/jobs/[id]/cancel/route.ts';
import { GET as metricsGet } from '../../app/api/admin/metrics/route.ts';
import { GET as cronGet } from '../../app/api/cron/sync/route.ts';

const resolveDoc = (name: string): string =>
  fileURLToPath(new URL(`../../docs/${name}`, import.meta.url));

const ADMIN_SECRET = 'secret-admin-uji';
const CRON_SECRET = 'secret-cron-uji';

const db = await PGlite.create({ extensions: { pg_trgm, unaccent, pgcrypto } });

before(async () => {
  await db.exec(readFileSync(resolveDoc('schema.sql'), 'utf8'));
  await db.exec(readFileSync(resolveDoc('seed.sql'), 'utf8'));
  const client: SqlClient = {
    async query<T>(text: string, params?: readonly unknown[]): Promise<T[]> {
      const result = await db.query(text, params as unknown[]);
      return result.rows as T[];
    },
  };
  setSqlClient(client);
  process.env.ADMIN_INGESTION_SECRET = ADMIN_SECRET;
  process.env.CRON_SECRET = CRON_SECRET;
});

after(() => {
  setSqlClient(null);
  delete process.env.ADMIN_INGESTION_SECRET;
  delete process.env.CRON_SECRET;
});

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function adminHeaders(): Record<string, string> {
  return { authorization: `Bearer ${ADMIN_SECRET}` };
}

function sampleDataset(characterSlug: string): Record<string, unknown> {
  return {
    parser_version: 'dataset-json@1.0.0',
    source_slug: 'admin-dataset-import',
    source_url: `dataset://admin-dataset-import/${characterSlug}`,
    verse: { slug: 'route-verse', name: 'Route Verse', origin_media: 'other' },
    characters: [
      {
        slug: characterSlug,
        name: 'Route Tester',
        media_type: 'other',
        forms: [
          {
            slug: 'base',
            name: 'Route Tester (Base)',
            form_order: 1,
            is_default: true,
            tier_code: '5-B',
            statistics: [
              {
                metric: 'attack_potency',
                raw_text: 'Island level',
                qualifier: 'exact',
                confidence: 0.8,
                scale_code: 'island',
              },
            ],
          },
        ],
      },
    ],
  };
}

async function jobStatus(jobId: string): Promise<string> {
  const rows = await db.query<{ status: string }>(`select status from ingestion_jobs where id = $1`, [jobId]);
  return rows.rows[0]!.status;
}

describe('rute admin → cron → panel (integrasi penuh)', () => {
  it('fail-closed dulu: tanpa secret, semua rute admin menolak 503', async () => {
    const saved = process.env.ADMIN_INGESTION_SECRET;
    delete process.env.ADMIN_INGESTION_SECRET;
    try {
      const jobs = await jobsGet(new Request('http://localhost/api/admin/ingestion/jobs'));
      assert.equal(jobs.status, 503);
      const impor = await importPost(jsonRequest('http://localhost/api/admin/ingestion/import', { dataset: {} }));
      assert.equal(impor.status, 503);
      const metrics = await metricsGet(new Request('http://localhost/api/admin/metrics'));
      assert.equal(metrics.status, 503);
    } finally {
      process.env.ADMIN_INGESTION_SECRET = saved;
    }
  });

  it('impor dataset lewat API hanya menulis staging + antrian (belum ada upsert)', async () => {
    const response = await importPost(
      jsonRequest('http://localhost/api/admin/ingestion/import', { dataset: sampleDataset('route-char') }, adminHeaders()),
    );
    assert.equal(response.status, 201);
    const body = (await response.json()) as { job_id: string; raw_page_id: string; content_hash: string };

    assert.equal(await jobStatus(body.job_id), 'pending');
    const canonical = await db.query<{ n: number }>(`select count(*)::int as n from characters where slug = 'route-char'`);
    assert.equal(canonical.rows[0]!.n, 0, 'route tidak boleh meng-upsert; itu pekerjaan worker');

    const staged = await db.query<{ n: number }>(
      `select count(*)::int as n from ingestion_raw_pages where id = $1`,
      [body.raw_page_id],
    );
    assert.equal(staged.rows[0]!.n, 1);
  });

  it('impor URL di luar allow-list ditolak 409 SOURCE_DISABLED sebelum masuk antrian (AC-19)', async () => {
    const before = await db.query<{ n: number }>(`select count(*)::int as n from ingestion_jobs`);
    const response = await importPost(
      jsonRequest(
        'http://localhost/api/admin/ingestion/import',
        { scope: 'import_url', target_ref: 'https://evil.test/data.json' },
        adminHeaders(),
      ),
    );
    assert.equal(response.status, 409);
    const body = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'SOURCE_DISABLED');
    assert.match(body.error.message, /allow-list/);

    const after = await db.query<{ n: number }>(`select count(*)::int as n from ingestion_jobs`);
    assert.equal(after.rows[0]!.n, before.rows[0]!.n, 'penolakan tidak boleh menulis baris antrian');
  });

  it('cron mengerjakan antrian: job selesai, data kanonik + atribusi muncul lewat API', async () => {
    const unauthorized = await cronGet(new Request('http://localhost/api/cron/sync'));
    assert.equal(unauthorized.status, 401);

    const tick = await cronGet(
      new Request('http://localhost/api/cron/sync', { headers: { authorization: `Bearer ${CRON_SECRET}` } }),
    );
    assert.equal(tick.status, 200);
    const tickBody = (await tick.json()) as { processed: Array<{ job_id: string; outcome: string }>; count: number };
    assert.ok(tickBody.count >= 1, 'cron harus mengerjakan job yang diantrikan admin');
    assert.ok(tickBody.processed.some((entry) => entry.outcome === 'completed'));

    const list = await jobsGet(
      new Request('http://localhost/api/admin/ingestion/jobs?status=completed', { headers: adminHeaders() }),
    );
    assert.equal(list.status, 200);
    const body = (await list.json()) as {
      jobs: Array<{ id: string; status: string; source_slug: string | null; records_created: number }>;
    };
    assert.ok(body.jobs.length >= 1);
    assert.equal(body.jobs[0]!.source_slug, 'admin-dataset-import');
    assert.ok(body.jobs[0]!.records_created > 0);

    // Data kanonik sudah ada, lengkap dengan atribusi.
    const character = await db.query<{ source_name: string; source_url: string }>(
      `select source_name, source_url from characters where slug = 'route-char'`,
    );
    assert.equal(character.rows[0]!.source_name, 'Admin Dataset Import');
    assert.match(character.rows[0]!.source_url, /^dataset:\/\//);
  });

  it('job gagal terlihat lewat API (daftar + detail error), lalu dapat di-retry dan dibatalkan', async () => {
    const broken = await importPost(
      jsonRequest(
        'http://localhost/api/admin/ingestion/import',
        { dataset: { source_slug: 'admin-dataset-import', verse: {} } },
        adminHeaders(),
      ),
    );
    const brokenJob = (await broken.json()) as { job_id: string };

    await cronGet(new Request('http://localhost/api/cron/sync', { headers: { authorization: `Bearer ${CRON_SECRET}` } }));

    assert.equal(await jobStatus(brokenJob.job_id), 'failed', 'dataset cacat bentuk bersifat terminal');

    const failedList = await jobsGet(
      new Request('http://localhost/api/admin/ingestion/jobs?status=failed', { headers: adminHeaders() }),
    );
    const failedBody = (await failedList.json()) as { jobs: Array<{ id: string; error_type: string | null }> };
    assert.equal(failedBody.jobs.length, 1);
    assert.equal(failedBody.jobs[0]!.error_type, 'ParserError');

    const detail = await errorsGet(
      new Request(`http://localhost/api/admin/ingestion/jobs/${brokenJob.job_id}/errors`, { headers: adminHeaders() }),
      { params: Promise.resolve({ id: brokenJob.job_id }) },
    );
    assert.equal(detail.status, 200);
    const detailBody = (await detail.json()) as {
      job: { id: string; status: string };
      errors: Array<{ error_type: string; error_message: string }>;
    };
    assert.equal(detailBody.job.status, 'failed');
    assert.equal(detailBody.errors.length, 1);
    assert.equal(detailBody.errors[0]!.error_type, 'ParserError');
    assert.match(detailBody.errors[0]!.error_message, /bentuk minimum|verse wajib/i);

    // Retry → pending lagi; lalu cancel → skipped (dan completed_at terisi).
    const retry = await retryPost(
      new Request(`http://localhost/api/admin/ingestion/jobs/${brokenJob.job_id}/retry`, {
        method: 'POST',
        headers: adminHeaders(),
      }),
      { params: Promise.resolve({ id: brokenJob.job_id }) },
    );
    assert.equal(retry.status, 200);
    assert.equal(await jobStatus(brokenJob.job_id), 'pending');

    const cancel = await cancelPost(
      new Request(`http://localhost/api/admin/ingestion/jobs/${brokenJob.job_id}/cancel`, {
        method: 'POST',
        headers: adminHeaders(),
      }),
      { params: Promise.resolve({ id: brokenJob.job_id }) },
    );
    assert.equal(cancel.status, 200);
    assert.equal(await jobStatus(brokenJob.job_id), 'skipped');
  });

  it('metrics mengembalikan hitungan nyata dari database', async () => {
    const response = await metricsGet(
      new Request('http://localhost/api/admin/metrics', { headers: adminHeaders() }),
    );
    assert.equal(response.status, 200);
    const stats = (await response.json()) as { total_characters: number; total_verses: number };
    assert.equal(stats.total_characters, 1);
    assert.ok(stats.total_verses >= 1);
  });

  it('id tidak sah ditolak 400 sebelum menyentuh database', async () => {
    const response = await retryPost(
      new Request('http://localhost/api/admin/ingestion/jobs/bukan-uuid/retry', {
        method: 'POST',
        headers: adminHeaders(),
      }),
      { params: Promise.resolve({ id: 'bukan-uuid' }) },
    );
    assert.equal(response.status, 400);
  });
});
