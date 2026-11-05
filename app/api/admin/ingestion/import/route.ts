/**
 * `POST /api/admin/ingestion/import` — menerima URL atau dataset untuk diimpor.
 *
 * Hanya staging + insert antrian (AC-25). Autentikasi sesi Supabase (editor)
 * dan rate limit 6/menit per user. `created_by` dan aktor audit selalu berasal
 * dari sesi, bukan body request.
 */

import { apiError } from '@/lib/errors.ts';
import { guardAdminRequest } from '@/features/admin/guard.ts';
import { recordAdminAudit } from '@/features/admin/audit.ts';
import { hashIp, requestIp } from '@/lib/security/ip-hash.ts';
import { getSqlClient, isDatabaseUnavailable } from '@/lib/db/client.ts';
import { enqueueIngestionJob } from '@/services/queue/ingestion-jobs.ts';
import type { IngestionJobScope } from '@/services/queue/ingestion-jobs.ts';
import {
  ImportRequestError,
  resolveImportUrlSource,
  stageDatasetImport,
} from '@/features/admin/import-requests.ts';

export const dynamic = 'force-dynamic';

const VALID_SCOPES: IngestionJobScope[] = [
  'incremental', 'scheduled_full', 'manual_run',
  'single_character', 'single_verse', 'reparse',
  'import_url', 'import_dataset',
];

export async function POST(request: Request): Promise<Response> {
  const auth = await guardAdminRequest(request, {
    limit: 6,
    windowMs: 60_000,
    minLevel: 'editor',
  });
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return apiError('INVALID_INPUT', 'Body harus berupa JSON.', 400);
  }

  if (body.dataset !== undefined) {
    try {
      const sql = getSqlClient();
      const staged = await stageDatasetImport(sql, body.dataset, {
        dryRun: body.dry_run === true,
        createdBy: auth.identity.userId,
      });
      await recordAdminAudit(sql, {
        actorId: auth.identity.userId,
        action: 'ingestion.import',
        entityType: 'ingestion_job',
        entityId: staged.job_id,
        params: { mode: 'dataset', dry_run: body.dry_run === true },
        ipHash: hashIp(requestIp(request.headers)),
      });
      return Response.json(
        {
          ...staged,
          message:
            'Dataset di-stage dan job masuk antrian. Validasi bentuk penuh dijalankan worker; pantau status di /admin/ingestion.',
        },
        { status: 201 },
      );
    } catch (error) {
      if (error instanceof ImportRequestError) {
        return error.code === 'SOURCE_DISABLED'
          ? apiError('SOURCE_DISABLED', error.message, 409)
          : apiError('INVALID_INPUT', error.message, 400);
      }
      const message = error instanceof Error ? error.message : String(error);
      return isDatabaseUnavailable(error)
        ? apiError('UNAVAILABLE', message, 503)
        : apiError('INTERNAL', message, 500);
    }
  }

  const scope = body.scope as string;
  if (!scope || !VALID_SCOPES.includes(scope as IngestionJobScope)) {
    return apiError(
      'INVALID_INPUT',
      `scope wajib diisi dan salah satu dari: ${VALID_SCOPES.join(', ')}`,
      400,
    );
  }

  const targetRef = typeof body.target_ref === 'string' ? body.target_ref : undefined;
  const dryRun = typeof body.dry_run === 'boolean' ? body.dry_run : undefined;
  const priority = typeof body.priority === 'number' ? body.priority : undefined;

  try {
    const sql = getSqlClient();
    let sourceId = typeof body.source_id === 'string' ? body.source_id : undefined;
    if (scope === 'import_url') {
      if (!targetRef) {
        return apiError('INVALID_INPUT', 'scope import_url memerlukan target_ref berisi URL.', 400);
      }
      try {
        const resolved = await resolveImportUrlSource(sql, targetRef);
        sourceId = resolved.source_id;
      } catch (error) {
        if (error instanceof ImportRequestError) {
          return apiError('SOURCE_DISABLED', error.message, 409);
        }
        throw error;
      }
    }

    const job = await enqueueIngestionJob(sql, {
      scope: scope as IngestionJobScope,
      target_ref: targetRef,
      source_id: sourceId,
      priority,
      dry_run: dryRun,
      created_by: auth.identity.userId,
    });

    await recordAdminAudit(sql, {
      actorId: auth.identity.userId,
      action: 'ingestion.import',
      entityType: 'ingestion_job',
      entityId: job.job_id,
      params: { mode: 'scope', scope, target_ref: targetRef ?? null, dry_run: dryRun ?? false },
      ipHash: hashIp(requestIp(request.headers)),
    });

    return Response.json(job, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return isDatabaseUnavailable(error)
      ? apiError('UNAVAILABLE', message, 503)
      : apiError('INTERNAL', message, 500);
  }
}
