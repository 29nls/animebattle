/**
 * `POST /api/admin/ingestion/import` — menerima URL atau scope untuk diimpor.
 * Hanya insert ke antrian (PRD AC-25: ingestion tidak di jalur request).
 *
 * Keamanan (AC-26, PRD §28): guard Bearer fail-closed + rate limit 6/menit per
 * identitas (AC-26 menugaskan 60/jam untuk import). Tanpa secret → 503.
 */

import { adminGuard } from '@/lib/security/admin-guard.ts';
import { FixedWindowRateLimiter } from '@/lib/security/rate-limiter.ts';
import { getSqlClient, DatabaseNotConfiguredError } from '@/lib/db/client.ts';
import { enqueueIngestionJob } from '@/services/queue/ingestion-jobs.ts';
import type { IngestionJobScope } from '@/services/queue/ingestion-jobs.ts';

export const dynamic = 'force-dynamic';

const limiter = new FixedWindowRateLimiter(6, 60_000, () => Date.now());

function reject(request: Request): Response | null {
  const auth = adminGuard(request, process.env, 'ADMIN_INGESTION_SECRET');
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const limit = limiter.check(auth.identity);
  if (!limit.allowed) {
    return Response.json(
      { error: 'Terlalu banyak permintaan.', retry_after_ms: limit.retryAfterMs },
      { status: 429, headers: { 'retry-after': String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
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
    return Response.json({ error: 'Body harus berupa JSON.' }, { status: 400 });
  }

  const scope = body.scope as string;
  if (!scope || !VALID_SCOPES.includes(scope as IngestionJobScope)) {
    return Response.json(
      { error: `scope wajib diisi dan salah satu dari: ${VALID_SCOPES.join(', ')}` },
      { status: 400 },
    );
  }

  try {
    const sql = getSqlClient();
    const result = await enqueueIngestionJob(sql, {
      scope: scope as IngestionJobScope,
      target_ref: typeof body.target_ref === 'string' ? body.target_ref : undefined,
      source_id: typeof body.source_id === 'string' ? body.source_id : undefined,
      priority: typeof body.priority === 'number' ? body.priority : undefined,
      dry_run: typeof body.dry_run === 'boolean' ? body.dry_run : undefined,
      created_by: typeof body.created_by === 'string' ? body.created_by : undefined,
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof DatabaseNotConfiguredError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
