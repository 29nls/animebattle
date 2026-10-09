/**
 * Token bucket per host untuk fetcher ingestion (PRD §18.3: default 1 req/s,
 * burst 3, concurrency 2).
 *
 * Kenapa per host dan bukan per job: yang dibatasi adalah beban ke sumber,
 * bukan beban ke sistem. Dua job berbeda yang menyasar host yang sama tetap
 * berbagi ember yang sama — kalau tidak, menjalankan lebih banyak job justru
 * menaikkan laju permintaan ke sumber dan itulah pelanggaran yang hendak
 * dicegah.
 *
 * Jam dan jeda disuntik lewat `Clock`, bukan memanggil `Date.now`/`setTimeout`
 * langsung. Itu yang membuat kebijakan laju ini dapat diuji tanpa test yang
 * benar-benar menunggu detik: uji memajukan jam virtual, produksi memakai jam
 * nyata.
 */

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

/** Burst 3 sesuai PRD §18.3; laju isi ulang mengikuti `sources.rate_limit_rps`. */
export const DEFAULT_BURST = 3;

export class HostRateLimiter {
  private readonly clock: Clock;
  private readonly burst: number;
  private readonly buckets = new Map<string, Bucket>();

  // Tanpa parameter property: `erasableSyntaxOnly` melarang sintaks yang
  // menghasilkan kode, karena modul ini juga dimuat Node dengan type stripping.
  constructor(clock: Clock = systemClock, burst: number = DEFAULT_BURST) {
    this.clock = clock;
    this.burst = burst;
  }

  /**
   * Menunggu sampai satu token tersedia untuk host, lalu memakainya.
   * Jeda dihitung dari kekurangan token — bukan polling — sehingga waktu tunggu
   * tepat satu interval dan tidak bergantung pada frekuensi pemeriksaan.
   */
  async acquire(host: string, ratePerSecond: number): Promise<void> {
    const rate = ratePerSecond > 0 ? ratePerSecond : 1;
    const bucket = this.buckets.get(host) ?? { tokens: this.burst, lastRefillMs: this.clock.now() };

    // Isi ulang sesuai waktu yang sudah berjalan.
    const now = this.clock.now();
    const elapsedMs = Math.max(0, now - bucket.lastRefillMs);
    bucket.tokens = Math.min(this.burst, bucket.tokens + (elapsedMs / 1000) * rate);
    bucket.lastRefillMs = now;

    if (bucket.tokens < 1) {
      const deficit = 1 - bucket.tokens;
      await this.clock.sleep(Math.ceil((deficit / rate) * 1000));
      const after = this.clock.now();
      bucket.tokens = Math.min(this.burst, bucket.tokens + ((after - bucket.lastRefillMs) / 1000) * rate);
      bucket.lastRefillMs = after;
    }

    bucket.tokens = Math.max(0, bucket.tokens - 1);
    this.buckets.set(host, bucket);
  }

  /** Hanya untuk pengujian: melupakan seluruh ember. */
  reset(): void {
    this.buckets.clear();
  }
}
