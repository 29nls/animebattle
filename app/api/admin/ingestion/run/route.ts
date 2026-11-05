/**
 * `POST /api/admin/ingestion/run` — memicu sinkronisasi dari dashboard admin.
 *
 * Hanya insert ke `ingestion_jobs`; worker terpisah yang mengerjakan fetch,
 * parse, dan upsert (AC-25). Autentikasi memakai sesi Supabase (role minimal
 * editor), bukan Bearer shared secret. Setiap job mencatat aktor sesi dan
 * `audit_logs`.
 */

import { apiError } from '@/lib/errors.ts';
import { guardAdminRequest } from '@/features/admin/guard.ts';
import { recordAdminAudit } from '@/features/admin/audit.ts';
import { hashIp, requestIp } from '@/lib/security/ip-hash.ts';
import { getSqlClient, isDatabaseUnavailable } from '@/lib/db/client.ts';
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
  const auth = await guardAdminRequest(request, {
    limit: 6,
    windowMs: 60_000,
    minLevel: 'editor',
  });
  if (!auth.ok) return auth.response;

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
  const dryRun = payload.dry_run === true;
  const priority = typeof payload.priority === 'number' ? payload.priority : 3;

  try {
    const sql = getSqlClient();
    const job = await enqueueIngestionJob(sql, {
      scope,
      target_ref: targetRef,
      dry_run: dryRun,
      priority,
      created_by: auth.identity.userId,
    });

    await recordAdminAudit(sql, {
      actorId: auth.identity.userId,
      action: 'ingestion.run',
      entityType: 'ingestion_job',
      entityId: job.job_id,
      params: { scope, target_ref: targetRef ?? null, dry_run: dryRun, priority },
      ipHash: hashIp(requestIp(request.headers)),
    });

    return Response.json(
      {
        job_id: job.job_id,
        status: job.status,
        created_at: job.created_at,
        message:
          'Job masuk antrian. Worker mengambilnya di proses terpisah; pantau status di /admin/ingestion.',
      },
      { status: 202 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return isDatabaseUnavailable(error)
      ? apiError('UNAVAILABLE', message, 503)
      : apiError('INTERNAL', message, 500);
  }
}
