/**
 * Rate limit login panel admin: 10 percobaan/menit per IP.
 *
 * Limiter disimpan di proses. Produksi multi-instance tetap memerlukan
 * penyimpanan bersama (PRD §28); kontrak modul ini tidak berubah saat itu
 * dilakukan.
 */

import { FixedWindowRateLimiter } from '../../lib/security/rate-limiter.ts';

export const LOGIN_RATE_LIMIT = 10;
export const LOGIN_RATE_WINDOW_MS = 60_000;

export function createLoginLimiter(now: () => number = () => Date.now()): FixedWindowRateLimiter {
  return new FixedWindowRateLimiter(LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS, now);
}

const loginLimiter = createLoginLimiter();

export function loginRateLimitKey(ip: string | null | undefined): string {
  const value = (ip ?? '').trim();
  return value === '' ? 'unknown-client' : value;
}

export function checkLoginRateLimit(ip: string | null | undefined) {
  return loginLimiter.check(loginRateLimitKey(ip));
}
