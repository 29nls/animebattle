/**
 * Guard async untuk `/api/admin/*`.
 *
 * Urutan: sesi Supabase (503/401/403) → peran minimum → rate limit per user.
 * Rate limit memakai `user_id`, bukan header yang dapat dipalsukan; sesi tanpa
 * identitas sudah ditolak sebelum limiter dipanggil.
 */

import { apiError } from '../../lib/errors.ts';
import {
  getAdminAuth,
  type AdminAccessLevel,
  type AdminIdentity,
} from './auth.ts';
import { FixedWindowRateLimiter } from '../../lib/security/rate-limiter.ts';

export interface AdminGuardOptions {
  limit: number;
  windowMs: number;
  /** Default `viewer`; mutasi memakai `editor`, aksi admin memakai `admin`. */
  minLevel?: AdminAccessLevel;
}

export type AdminGuardResult =
  | { ok: true; identity: AdminIdentity }
  | { ok: false; response: Response };

const limiters = new Map<string, FixedWindowRateLimiter>();

function limiterFor(options: AdminGuardOptions): FixedWindowRateLimiter {
  const key = `${options.limit}/${options.windowMs}`;
  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = new FixedWindowRateLimiter(options.limit, options.windowMs, () => Date.now());
    limiters.set(key, limiter);
  }
  return limiter;
}

export async function guardAdminRequest(
  _request: Request,
  options: AdminGuardOptions,
): Promise<AdminGuardResult> {
  const auth = await getAdminAuth(options.minLevel ?? 'viewer');
  if (!auth.ok) {
    return {
      ok: false,
      response: apiError(auth.code, auth.message, auth.status, {
        details: { reason: auth.reason },
      }),
    };
  }

  const limit = limiterFor(options).check(auth.identity.userId);
  if (!limit.allowed) {
    return {
      ok: false,
      response: apiError('RATE_LIMITED', 'Terlalu banyak permintaan.', 429, {
        details: { retry_after_ms: limit.retryAfterMs },
        headers: { 'retry-after': String(Math.ceil(limit.retryAfterMs / 1000)) },
      }),
    };
  }

  return { ok: true, identity: auth.identity };
}
