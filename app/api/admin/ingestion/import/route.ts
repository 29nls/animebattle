/**
 * `POST /api/admin/ingestion/import` — menerima URL atau scope untuk diimpor.
 * Hanya insert ke antrian (PRD AC-25: ingestion tidak di jalur request).
 */

import { getSqlClient, DatabaseNotConfiguredError } from '@/lib/db/client.ts';
import { enqueueIngestionJob } from '@/services/queue/ingestion-jobs.ts';
import type { IngestionJobScope } from '@/services/queue/ingestion-jobs.ts';

export const dynamic = 'force-dynamic';

const VALID_SCOPES: IngestionJobScope[] = [
  'incremental', 'scheduled_full', 'manual_run',
  'single_character', 'single_verse', 'reparse',
  'import_url', 'import_dataset',
];

export async function POST(request: Request): Promise<Response> {
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
