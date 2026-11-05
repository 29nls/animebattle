/**
 * `GET /api/admin/metrics` — ringkasan sistem untuk dashboard admin.
 *
 * Sesi Supabase dengan peran minimal viewer + rate limit 30/menit per user.
 */

import { apiError } from '@/lib/errors.ts';
import { guardAdminRequest } from '@/features/admin/guard.ts';
import { getSqlClient, isDatabaseUnavailable } from '@/lib/db/client.ts';
import { getSystemStats } from '@/features/admin/queries.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const auth = await guardAdminRequest(request, {
    limit: 30,
    windowMs: 60_000,
    minLevel: 'viewer',
  });
  if (!auth.ok) return auth.response;

  try {
    const stats = await getSystemStats(getSqlClient());
    return Response.json(stats);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return isDatabaseUnavailable(error)
      ? apiError('UNAVAILABLE', message, 503)
      : apiError('INTERNAL', message, 500);
  }
}
