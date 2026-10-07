/**
 * `POST /api/admin/ingestion/run` — memicu sinkronisasi dari dashboard admin.
 *
 * Berkas ini adalah demonstrasi aturan AC-25 dalam praktik. Route ini memicu
 * ingestion, tetapi **tidak mengimpor `services/ingestion/*`** dan tidak pernah
 * menjalankan fetch, parse, atau tulis massal di dalam siklus request. Yang
 * dilakukannya hanya satu `insert` ke `ingestion_jobs`; worker terpisah
 * (`worker/ingest.ts`) yang mengambilnya.
 *
 * Konsekuensi yang terlihat oleh admin: respons `202 Accepted` berisi `job_id`
 * dan halaman `/admin/ingestion/[id]` memantau statusnya. Itu memang lebih
 * repot daripada menunggu di dalam request — dan itulah maksudnya. Ingestion
 * yang berjalan di jalur request akan menahan respons sampai timeout platform,
 * kehilangan seluruh pekerjaan saat timeout, dan menyembunyikan status
 * sebenarnya dari admin (PRD §18.1, D10).
 *
 * Otorisasi (`is_admin()`), rate limit (AC-26), dan CSRF ada di Sprint 0/4 dan
 * belum dipasang di scaffold ini — route ini belum boleh diekspos publik.
 */

import { getSqlClient } from '@/lib/db/client.ts';
import { enqueueIngestionJob } from '@/services/queue/ingestion-jobs.ts';
import type { IngestionJobScope } from '@/services/queue/ingestion-jobs.ts';

export const dynamic = 'force-dynamic';

const SCOPES: readonly IngestionJobScope[] = [
  'incremental',
  'scheduled_full',
  'manual_run',
  'single_character',
  'single_verse',
  'reparse',
  'import_url',
  'import_dataset',
];

function isScope(value: unknown): value is IngestionJobScope {
  return typeof value === 'string' && (SCOPES as readonly string[]).includes(value);
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body harus berupa JSON.' }, { status: 400 });
  }

  const payload = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const scope = payload.scope ?? 'manual_run';
  if (!isScope(scope)) {
    return Response.json(
      { error: `scope tidak dikenal. Pilihan: ${SCOPES.join(', ')}.` },
      { status: 400 },
    );
  }

  const targetRef = typeof payload.target_ref === 'string' ? payload.target_ref : undefined;

  try {
    const job = await enqueueIngestionJob(getSqlClient(), {
      scope,
      target_ref: targetRef,
      dry_run: payload.dry_run === true,
      priority: typeof payload.priority === 'number' ? payload.priority : 3,
    });

    return Response.json(
      {
        job_id: job.job_id,
        status: job.status,
        created_at: job.created_at,
        // Pesan ini bagian dari kontrak UX: admin harus tahu pekerjaannya belum
        // jalan, bukan mengira kegagalan.
        message:
          'Job masuk antrian. Worker mengambilnya di proses terpisah; pantau status di /admin/ingestion.',
      },
      { status: 202 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 503 });
  }
}
