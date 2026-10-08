/**
 * `GET /api/admin/metrics` — ringkasan sistem untuk dashboard admin.
 *
 * Path mengikuti PRD §24/APPENDICES G (`/api/admin/metrics`); sebelumnya
 * `admin/stats`, yang tidak ada di kontrak API mana pun.
 *
 * Keamanan (AC-26, PRD §28): guard Bearer fail-closed + rate limit 30/menit
 * (baca lebih ringan daripada mutasi, tetap dibatasi). Tanpa secret → 503.
 */

import { apiError } from '@/lib/errors.ts';
import { adminGuard } from '@/lib/security/admin-guard.ts';
import { FixedWindowRateLimiter } from '@/lib/security/rate-limiter.ts';
import { getSqlClient, isDatabaseUnavailable } from '@/lib/db/client.ts';
import { getSystemStats } from '@/features/admin/queries.ts';

export const dynamic = 'force-dynamic';

const limiter = new FixedWindowRateLimiter(30, 60_000, () => Date.now());

export async function GET(request: Request): Promise<Response> {
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

  try {
    const sql = getSqlClient();
    const stats = await getSystemStats(sql);
    return Response.json(stats);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return isDatabaseUnavailable(error)
      ? apiError('UNAVAILABLE', message, 503)
      : apiError('INTERNAL', message, 500);
  }
}
