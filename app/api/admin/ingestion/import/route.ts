/**
 * `POST /api/admin/ingestion/import` — menerima URL atau scope untuk diimpor.
 * Hanya insert ke antrian (PRD AC-25: ingestion tidak di jalur request).
 *
 * Keamanan (AC-26, PRD §28): guard Bearer fail-closed + rate limit 6/menit per
 * identitas (AC-26 menugaskan 60/jam untuk import). Tanpa secret → 503.
 */

import { apiError } from '@/lib/errors.ts';
import { adminGuard } from '@/lib/security/admin-guard.ts';
import { FixedWindowRateLimiter } from '@/lib/security/rate-limiter.ts';
import { getSqlClient, isDatabaseUnavailable } from '@/lib/db/client.ts';
import { enqueueIngestionJob } from '@/services/queue/ingestion-jobs.ts';
import type { IngestionJobScope } from '@/services/queue/ingestion-jobs.ts';
import {
  ImportRequestError,
  resolveImportUrlSource,
  stageDatasetImport,
} from '@/features/admin/import-requests.ts';

export const dynamic = 'force-dynamic';

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

const VALID_SCOPES: IngestionJobScope[] = [
  'incremental', 'scheduled_full', 'manual_run',
  'single_character', 'single_verse', 'reparse',
  'import_url', 'import_dataset',
];

export async function POST(request: Request): Promise<Response> {
  const denied = reject(request);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return apiError('INVALID_INPUT', 'Body harus berupa JSON.', 400);
  }

  // Jalur impor terkelola: body memuat dataset lengkap. Penyiapan hanya
  // men-stage + mengantrikan (lihat features/admin/import-requests.ts);
  // parsing dan upsert tetap pekerjaan worker (AC-25). Pemeriksaan ini mendahului
  // validasi `scope` karena pemanggil jalur ini memang tidak perlu menyebut
  // scope — bentuk body-nya sendiri sudah menentukan job yang dibuat.
  if (body.dataset !== undefined) {
    try {
      const staged = await stageDatasetImport(getSqlClient(), body.dataset, {
        dryRun: body.dry_run === true,
        createdBy: typeof body.created_by === 'string' ? body.created_by : undefined,
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

  try {
    const sql = getSqlClient();

    // Impor URL diperiksa terhadap allow-list **sebelum** masuk antrian: 409
    // `SOURCE_DISABLED` adalah kontrak AC-19, dan admin sebaiknya tidak menunggu
    // satu putaran worker hanya untuk diberi tahu URL-nya tidak diizinkan.
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

    const result = await enqueueIngestionJob(sql, {
      scope: scope as IngestionJobScope,
      target_ref: targetRef,
      source_id: sourceId,
      priority: typeof body.priority === 'number' ? body.priority : undefined,
      dry_run: typeof body.dry_run === 'boolean' ? body.dry_run : undefined,
      created_by: typeof body.created_by === 'string' ? body.created_by : undefined,
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return isDatabaseUnavailable(error)
      ? apiError('UNAVAILABLE', message, 503)
      : apiError('INTERNAL', message, 500);
  }
}
