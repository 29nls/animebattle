/**
 * `POST /api/admin/ingestion/jobs/:id/retry` — mengembalikan job ke antrian.
 *
 * Hanya menyentuh baris `ingestion_jobs`; pekerjaannya tetap dilakukan worker
 * (AC-25). Job berstatus `processing` tidak dapat di-retry — tidak ada cara
 * membatalkan worker yang sedang memegangnya, dan menandainya `pending` akan
 * membuat dua worker mengerjakan job yang sama.
 *
 * Keamanan (AC-26): guard Bearer fail-closed + 120 permintaan/jam.
 */

import { apiError } from '@/lib/errors.ts';
import { guardAdminRequest } from '@/features/admin/guard.ts';
import { getSqlClient, isDatabaseUnavailable } from '@/lib/db/client.ts';
import { retryIngestionJob } from '@/services/queue/ingestion-jobs.ts';

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
    const updated = await retryIngestionJob(getSqlClient(), id);
    if (!updated) {
      return apiError(
        'INVALID_INPUT',
        'Job tidak ada atau sedang processing/selesai dan tidak dapat di-retry dari sini.',
        409,
      );
    }
    return Response.json({ job_id: id, status: 'pending' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return isDatabaseUnavailable(error)
      ? apiError('UNAVAILABLE', message, 503)
      : apiError('INTERNAL', message, 500);
  }
}
