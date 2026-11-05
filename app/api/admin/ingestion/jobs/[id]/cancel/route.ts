/**
 * `POST /api/admin/ingestion/jobs/:id/cancel` — menandai job `skipped`.
 *
 * Sesi Supabase editor + rate limit 120/jam. Aksi yang berhasil menulis
 * `audit_logs` dengan aktor sesi.
 */

import { apiError } from '@/lib/errors.ts';
import { guardAdminRequest } from '@/features/admin/guard.ts';
import { recordAdminAudit } from '@/features/admin/audit.ts';
import { hashIp, requestIp } from '@/lib/security/ip-hash.ts';
import { getSqlClient, isDatabaseUnavailable } from '@/lib/db/client.ts';
import { cancelIngestionJob } from '@/services/queue/ingestion-jobs.ts';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await guardAdminRequest(request, {
    limit: 120,
    windowMs: 3_600_000,
    minLevel: 'editor',
  });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return apiError('INVALID_INPUT', 'id job harus berupa UUID.', 400);
  }

  try {
    const sql = getSqlClient();
    const updated = await cancelIngestionJob(sql, id);
    if (!updated) {
      return apiError(
        'INVALID_INPUT',
        'Job tidak ada, sudah selesai, atau sedang processing (tidak dapat dibatalkan dengan aman).',
        409,
      );
    }
    await recordAdminAudit(sql, {
      actorId: auth.identity.userId,
      action: 'ingestion.cancel',
      entityType: 'ingestion_job',
      entityId: id,
      params: { job_id: id },
      ipHash: hashIp(requestIp(request.headers)),
    });
    return Response.json({ job_id: id, status: 'skipped' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return isDatabaseUnavailable(error)
      ? apiError('UNAVAILABLE', message, 503)
      : apiError('INTERNAL', message, 500);
  }
}
