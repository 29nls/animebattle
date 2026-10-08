/**
 * Rate limiter jendela-tetap yang murni terhadap waktu (PRD §28, AC-26).
 *
 * Jam disuntikkan (`now`), sehingga pengujian deterministik dan modul bebas
 * dari `Date.now()` internal — konsisten dengan filosofi repo: waktu adalah
 * argumen, bukan keadaan global.
 *
 * Penyimpanan in-process Map cukup untuk satu instance route (dan untuk
 * pengembangan); produksi multi-instance memakai penyimpanan bersama
 * (Upstash/KV) dengan antarmuka yang sama — PRD §28 menugaskan itu pada
 * Sprint 4 tanpa mengubah kontrak modul ini.
 */

/** Hasil satu pemeriksaan kuota. */
export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterMs: number };

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { windowStart: number; count: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(limit: number, windowMs: number, now: () => number) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error(`limit harus integer > 0, didapat ${limit}`);
    }
    if (!Number.isInteger(windowMs) || windowMs <= 0) {
      throw new Error(`windowMs harus integer > 0, didapat ${windowMs}`);
    }
  }

  /** Catat satu permintaan untuk `key` dan nyatakan boleh/tidak. */
  check(key: string): RateLimitResult {
    const t = this.now();
    const windowStart = Math.floor(t / this.windowMs) * this.windowMs;
    const entry = this.windows.get(key);

    if (entry === undefined || entry.windowStart !== windowStart) {
      this.windows.set(key, { windowStart, count: 1 });
      return { allowed: true, remaining: this.limit - 1 };
    }

    if (entry.count < this.limit) {
      entry.count += 1;
      return { allowed: true, remaining: this.limit - entry.count };
    }

    const retryAfterMs = entry.windowStart + this.windowMs - t;
    return { allowed: false, retryAfterMs: Math.max(1, retryAfterMs) };
  }
}
