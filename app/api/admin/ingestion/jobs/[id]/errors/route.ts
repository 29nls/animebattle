/**
 * `GET /api/admin/ingestion/jobs/:id/errors` — detail error satu job (AC-10).
 *
 * Yang dikembalikan sengaja bukan hanya pesan: `error_type`, `http_status`,
 * `retry_count`, `source_url`, dan `payload` mentahnya ikut disertakan, karena
 * gunanya adalah mereproduksi kegagalan parser offline (VA-3) dan menautkan
 * admin ke sumbernya (US-23).
 *
 * Keamanan (AC-26): guard Bearer fail-closed + 300 permintaan/jam, `no-store`.
 */

import { apiError } from '@/lib/errors.ts';
import { guardAdminRequest } from '@/features/admin/guard.ts';
import { getSqlClient, isDatabaseUnavailable } from '@/lib/db/client.ts';
import { getIngestionJob, listIngestionErrors } from '@/features/admin/queries.ts';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const denied = guardAdminRequest(request, { limit: 300, windowMs: 3_600_000 });
  if (denied) return denied;

  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return apiError('INVALID_INPUT', 'id job harus berupa UUID.', 400);
  }

  try {
    const sql = getSqlClient();
    const job = await getIngestionJob(sql, id);
    if (!job) {
      return apiError('NOT_FOUND', `Job ${id} tidak ditemukan.`, 404);
    }
    const errors = await listIngestionErrors(sql, { jobIds: [id] });
    return Response.json({ job, errors }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return isDatabaseUnavailable(error)
      ? apiError('UNAVAILABLE', message, 503)
      : apiError('INTERNAL', message, 500);
  }
}
