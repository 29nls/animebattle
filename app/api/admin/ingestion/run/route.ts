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
 * Keamanan (AC-26, PRD §28): guard otentikasi Bearer fail-closed + rate limit
 * per identitas (6 permintaan/menit). Tanpa `ADMIN_INGESTION_SECRET`, route ini
 * menolak 503 untuk SEMUA penelepon — tidak pernah bisa dipanggil publik.
 * CSRF menyusul bersama migrasi ke Supabase Auth (Sprint 4).
 */

import { apiError } from '@/lib/errors.ts';
import { adminGuard } from '@/lib/security/admin-guard.ts';
import { FixedWindowRateLimiter } from '@/lib/security/rate-limiter.ts';
import { getSqlClient, isDatabaseUnavailable } from '@/lib/db/client.ts';
import { enqueueIngestionJob } from '@/services/queue/ingestion-jobs.ts';
import type { IngestionJobScope } from '@/services/queue/ingestion-jobs.ts';

export const dynamic = 'force-dynamic';

// Limit 6/menit: jauh di bawah kebutuhan operasional (tombol Sync Now),
// jauh di atas yang sah; AC-26 menugaskan 60/jam/admin untuk import.
const limiter = new FixedWindowRateLimiter(6, 60_000, () => Date.now());

function reject(request: Request): Response | null {
  const auth = adminGuard(request, process.env, 'ADMIN_INGESTION_SECRET');
  if (!auth.ok) {
    return apiError(auth.status === 503 ? 'UNAVAILABLE' : 'UNAUTHORIZED', auth.error, auth.status);
  }
  const limit = limiter.check(auth.identity);
  if (!limit.allowed) {
    return apiError('RATE_LIMITED', 'Terlalu banyak permintaan.', 429, {
      details: { retry_after_ms: limit.retryAfterMs },
      headers: { 'retry-after': String(Math.ceil(limit.retryAfterMs / 1000)) },
    });
  }
  return null;
}

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
  const denied = reject(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('INVALID_INPUT', 'Body harus berupa JSON.', 400);
  }

  const payload = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const scope = payload.scope ?? 'manual_run';
  if (!isScope(scope)) {
    return apiError('INVALID_INPUT', `scope tidak dikenal. Pilihan: ${SCOPES.join(', ')}.`, 400);
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
    // Admin adalah pemanggil tepercaya, jadi pesan asli tetap ditampilkan;
    // yang diperbaiki adalah klasifikasinya (gangguan konektivitas → 503).
    return isDatabaseUnavailable(error)
      ? apiError('UNAVAILABLE', message, 503)
      : apiError('INTERNAL', message, 500);
  }
}
