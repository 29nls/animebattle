/**
 * `GET /api/admin/ingestion/jobs/:id/errors` — detail error satu job (AC-10).
 *
 * Sesi Supabase viewer + rate limit 300/jam; respons `no-store`.
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
  const auth = await guardAdminRequest(request, {
    limit: 300,
    windowMs: 3_600_000,
    minLevel: 'viewer',
  });
  if (!auth.ok) return auth.response;

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
