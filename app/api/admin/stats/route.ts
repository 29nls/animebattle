/**
 * `GET /api/admin/stats` — ringkasan sistem untuk dashboard admin.
 */

import { getSqlClient, DatabaseNotConfiguredError } from '@/lib/db/client.ts';
import { getSystemStats } from '@/features/admin/queries.ts';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const sql = getSqlClient();
    const stats = await getSystemStats(sql);
    return Response.json(stats);
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
