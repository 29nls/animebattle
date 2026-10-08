/**
 * `GET /api/admin/stats` — ringkasan sistem untuk dashboard admin.
 *
 * Keamanan (AC-26, PRD §28): guard Bearer fail-closed + rate limit 30/menit
 * (baca lebih ringan daripada mutasi, tetap dibatasi). Tanpa secret → 503.
 */

import { adminGuard } from '@/lib/security/admin-guard.ts';
import { FixedWindowRateLimiter } from '@/lib/security/rate-limiter.ts';
import { getSqlClient, DatabaseNotConfiguredError } from '@/lib/db/client.ts';
import { getSystemStats } from '@/features/admin/queries.ts';

export const dynamic = 'force-dynamic';

const limiter = new FixedWindowRateLimiter(30, 60_000, () => Date.now());

export async function GET(request: Request): Promise<Response> {
  const auth = adminGuard(request, process.env, 'ADMIN_INGESTION_SECRET');
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const limit = limiter.check(auth.identity);
  if (!limit.allowed) {
    return Response.json(
      { error: 'Terlalu banyak permintaan.', retry_after_ms: limit.retryAfterMs },
      { status: 429, headers: { 'retry-after': String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }

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
