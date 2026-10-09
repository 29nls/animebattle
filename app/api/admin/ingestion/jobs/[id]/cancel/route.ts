/**
 * `POST /api/admin/ingestion/jobs/:id/cancel` — menandai job `skipped`.
 *
 * Job yang sedang `processing` sengaja tidak dapat dibatalkan dari sini:
 * menghentikan worker yang sedang berjalan bukan sesuatu yang dapat dijanjikan
 * oleh satu `update` (lihat runbook ingestion.md). Untuk job itu, tindakan yang
 * tersedia adalah menunggu worker selesai lalu menghentikan job berikutnya.
 *
 * Keamanan (AC-26): guard Bearer fail-closed + 120 permintaan/jam.
 */

import { apiError } from '@/lib/errors.ts';
import { guardAdminRequest } from '@/features/admin/guard.ts';
import { getSqlClient, isDatabaseUnavailable } from '@/lib/db/client.ts';
import { cancelIngestionJob } from '@/services/queue/ingestion-jobs.ts';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const denied = guardAdminRequest(request, { limit: 120, windowMs: 3_600_000 });
  if (denied) return denied;

  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return apiError('INVALID_INPUT', 'id job harus berupa UUID.', 400);
  }

  try {
    const updated = await cancelIngestionJob(getSqlClient(), id);
    if (!updated) {
      return apiError(
        'INVALID_INPUT',
        'Job tidak ada, sudah selesai, atau sedang processing (tidak dapat dibatalkan dengan aman).',
        409,
      );
    }
    return Response.json({ job_id: id, status: 'skipped' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return isDatabaseUnavailable(error)
      ? apiError('UNAVAILABLE', message, 503)
      : apiError('INTERNAL', message, 500);
  }
}
