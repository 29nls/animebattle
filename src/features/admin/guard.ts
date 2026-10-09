/**
 * Pembungkus guard + rate limit untuk rute `/api/admin/*`.
 *
 * Tiga rute admin yang lebih dulu ada menyalin blok `reject()` yang sama.
 * Menyalinnya untuk setiap rute baru berarti setiap rute baru berpeluang
 * mengubah urutan pemeriksaan (auth dulu, baru rate limit) atau lupa salah
 * satunya. Helper ini menutup peluang itu: urutannya satu tempat, dan pesan
 * 503/401/429 yang dihasilkan identik dengan yang sudah diuji di
 * `tests/security/`.
 *
 * Zona `web-request`: memakai `apiError` (node-runtime) dan `adminGuard`
 * (node-runtime) — keduanya boleh diimpor jalur request; tidak ada ingestion.
 */

import { apiError } from '../../lib/errors.ts';
import { adminGuard } from '../../lib/security/admin-guard.ts';
import { FixedWindowRateLimiter } from '../../lib/security/rate-limiter.ts';

const ADMIN_SECRET_ENV = 'ADMIN_INGESTION_SECRET';

export interface AdminGuardOptions {
  /** Jumlah permintaan maksimum dalam satu jendela. */
  limit: number;
  /** Panjang jendela dalam milidetik (mis. 3_600_000 untuk batas per jam). */
  windowMs: number;
}

/** Limiter dibuat sekali per kombinasi (limit, jendela) agar jendelanya tidak direset tiap request. */
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

/** `null` bila permintaan boleh lanjut; `Response` siap kirim bila ditolak. */
export function guardAdminRequest(request: Request, options: AdminGuardOptions): Response | null {
  const auth = adminGuard(request, process.env, ADMIN_SECRET_ENV);
  if (!auth.ok) {
    return apiError(auth.status === 503 ? 'UNAVAILABLE' : 'UNAUTHORIZED', auth.error, auth.status);
  }

  const limit = limiterFor(options).check(auth.identity);
  if (!limit.allowed) {
    return apiError('RATE_LIMITED', 'Terlalu banyak permintaan.', 429, {
      details: { retry_after_ms: limit.retryAfterMs },
      headers: { 'retry-after': String(Math.ceil(limit.retryAfterMs / 1000)) },
    });
  }

  return null;
}
