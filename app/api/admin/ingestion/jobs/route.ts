/**
 * `GET /api/admin/ingestion/jobs` — daftar job + atribusi sumber (PRD §24).
 *
 * Kontrak: `?status=pending|processing|completed|partial|failed|skipped`
 * (opsional), `?limit=` (1..200, default 50), `?offset=` (default 0).
 * Respons `no-store` karena isi antrian berubah tiap kali worker selesai.
 *
 * Keamanan (AC-26, PRD §28): guard Bearer fail-closed + 300 permintaan/jam.
 */

import { apiError } from '@/lib/errors.ts';
import { guardAdminRequest } from '@/features/admin/guard.ts';
import { getSqlClient, isDatabaseUnavailable } from '@/lib/db/client.ts';
import { listIngestionJobs } from '@/features/admin/queries.ts';

export const dynamic = 'force-dynamic';

const STATUSES = ['pending', 'processing', 'completed', 'partial', 'failed', 'skipped'] as const;

export async function GET(request: Request): Promise<Response> {
  const denied = guardAdminRequest(request, { limit: 300, windowMs: 3_600_000 });
  if (denied) return denied;

  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  if (status !== null && !(STATUSES as readonly string[]).includes(status)) {
    return apiError('INVALID_INPUT', `status tidak dikenal. Pilihan: ${STATUSES.join(', ')}.`, 400);
  }

  const limit = Number(url.searchParams.get('limit') ?? '50');
  const offset = Number(url.searchParams.get('offset') ?? '0');
  if (!Number.isFinite(limit) || !Number.isFinite(offset)) {
    return apiError('INVALID_INPUT', 'limit/offset harus berupa angka.', 400);
  }

  try {
    const jobs = await listIngestionJobs(getSqlClient(), {
      ...(status === null ? {} : { status }),
      limit,
      offset,
    });
    return Response.json({ jobs, count: jobs.length }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return isDatabaseUnavailable(error)
      ? apiError('UNAVAILABLE', message, 503)
      : apiError('INTERNAL', message, 500);
  }
}
