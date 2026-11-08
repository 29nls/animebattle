/**
 * Rate limit terdistribusi untuk endpoint publik (PRD §28, AC-26).
 *
 * Kenapa tidak memakai `FixedWindowRateLimiter`: Map di modul itu hidup di satu
 * proses. Di deployment serverless, 30/menit menjadi 30 × jumlah instance yang
 * kebetulan hidup — batasnya tidak berarti apa-apa justru saat trafik naik.
 *
 * Hitungan dipindahkan ke tabel `rate_limit_windows` lewat fungsi
 * `rate_limit_hit` (migrasi 0006). Satu pernyataan SQL menaikkan hitungan dan
 * melaporkan sisa kuota, sehingga dua permintaan bersamaan tidak dapat
 * sama-sama membaca hitungan lama.
 *
 * Identitas: IP klien di-hash (`hashIp`, salt harian) sebelum menjadi bagian
 * bucket. IP mentah tidak pernah masuk database, dan bucket tidak dapat dipakai
 * untuk melacak satu pengguna lintas hari. Bucket selalu menyertakan nama
 * endpoint supaya kuota simulasi tidak memakan kuota pencarian.
 *
 * Kegagalan infrastruktur: **fail-open**. Bila tabel/fungsi tidak dapat
 * dihubungi, permintaan diteruskan dan galatnya dicatat. Alasannya, database
 * yang sama juga sumber data endpoint ini: permintaan tetap berakhir 503 pada
 * jalur data, sehingga menolaknya lebih dulu sebagai 429 hanya menyamarkan
 * gangguan sebagai "terlalu banyak permintaan". Yang tidak boleh terjadi adalah
 * kegagalan limiter membuat situs tampak rusak bagi semua pengguna.
 */

import { getSqlClient, type SqlClient } from '../db/client.ts';
import { apiError } from '../errors.ts';
import { logEvent } from '../observability/logger.ts';
import { hashIp, requestIp } from './ip-hash.ts';

/** Hasil pemeriksaan kuota, dalam bentuk yang siap dipetakan route. */
export type DistributedRateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterMs: number };

export interface RateLimitOptions {
  /** Nama endpoint — bagian bucket, memisahkan kuota antar endpoint. */
  scope: string;
  /** Jumlah permintaan yang diizinkan per jendela. */
  limit: number;
  /** Panjang jendela tetap, milidetik. */
  windowMs: number;
  /** Waktu acuan; dapat disuntik agar pengujian deterministik. */
  nowMs?: number;
}

interface HeaderLike {
  get(name: string): string | null;
}

/**
 * Bucket untuk satu permintaan.
 *
 * `unknown` dipakai bila tidak ada header IP (mis. `next dev` tanpa proxy).
 * Semua pemanggil tanpa IP berbagi satu bucket — sengaja: membuat bucket acak
 * per permintaan akan menghapus batasnya sama sekali, sedangkan menolak
 * permintaan tanpa IP membuat pengembangan lokal tidak dapat berjalan.
 */
export function rateLimitBucket(
  headers: HeaderLike | null | undefined,
  scope: string,
  nowMs?: number,
): string {
  const ip = headers ? requestIp(headers) : null;
  const digest = hashIp(ip, nowMs) ?? 'unknown';
  return `${scope}:${digest}`;
}

/** Baris `rate_limit_hit`. */
interface RateLimitRow {
  allowed: boolean;
  remaining: number;
  retry_after_ms: number;
}

/**
 * Catat satu permintaan dan laporkan apakah masih dalam kuota.
 *
 * `p_now` dikirim eksplisit supaya jendela yang dipakai sama dengan waktu yang
 * diuji, dan supaya jam database tidak menjadi sumber perbedaan antar instance.
 */
export async function checkDistributedRateLimit(
  sql: SqlClient,
  bucket: string,
  options: RateLimitOptions,
): Promise<DistributedRateLimitResult> {
  const nowMs = options.nowMs ?? Date.now();
  const rows =
    sql.dialect === 'sqlite'
      ? await hitRateLimitSqlite(sql, bucket, options, nowMs)
      : await sql.query<RateLimitRow>(
          `select allowed, remaining, retry_after_ms
             from rate_limit_hit($1, $2, $3, to_timestamp($4 / 1000.0))`,
          [bucket, options.windowMs, options.limit, nowMs],
        );

  const row = rows[0];
  // Fungsi mengembalikan tepat satu baris berbentuk boolean/integer. Bentuk lain
  // berarti skema belum dimigrasikan (atau klien yang disuntik bukan Postgres):
  // diperlakukan sebagai limiter tidak tersedia, bukan sebagai "ditolak".
  if (!row || typeof row.allowed !== 'boolean') {
    throw new Error('rate_limit_hit tidak mengembalikan baris yang dikenali');
  }

  if (row.allowed) return { allowed: true, remaining: Number(row.remaining) };
  return { allowed: false, retryAfterMs: Math.max(1, Number(row.retry_after_ms)) };
}

/**
 * Jalur SQLite: RPC `rate_limit_hit` tidak ada, jadi langkah atomiknya ditulis
 * langsung — satu `insert ... on conflict do update ... returning hits`, yang
 * memang didukung D1. Perhitungan jendela tetap identik dengan versi Postgres
 * (jendela tetap, bukan bergeser) supaya batasnya tetap dapat diprediksi.
 */
async function hitRateLimitSqlite(
  sql: SqlClient,
  bucket: string,
  options: RateLimitOptions,
  nowMs: number,
): Promise<RateLimitRow[]> {
  if (options.windowMs <= 0 || options.limit <= 0) {
    throw new Error('rate_limit_hit: windowMs dan limit harus > 0');
  }

  const windowStartMs = Math.floor(nowMs / options.windowMs) * options.windowMs;
  const windowStart = new Date(windowStartMs).toISOString();
  const rows = await sql.query<{ hits: number }>(
    `insert into rate_limit_windows (bucket, window_start, hits)
     values ($1, $2, 1)
     on conflict (bucket, window_start) do update set hits = rate_limit_windows.hits + 1
     returning hits`,
    [bucket, windowStart],
  );

  const hits = Number(rows[0]?.hits ?? 0);
  const allowed = hits <= options.limit;
  const retryAfterMs = allowed ? 0 : Math.max(1, Math.ceil(windowStartMs + options.windowMs - nowMs));

  // Pembersihan oportunistik (1%), sama seperti versi Postgres: tabel tidak
  // tumbuh tanpa batas tanpa perlu cron khusus.
  if (Math.random() < 0.01) {
    const cutoff = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
    await sql.query(`delete from rate_limit_windows where window_start < $1`, [cutoff]);
  }

  return [{ allowed, remaining: Math.max(options.limit - hits, 0), retry_after_ms: retryAfterMs }];
}

/** Header 429 yang sama dengan guard admin: detik, dibulatkan ke atas. */
export function rateLimitHeaders(result: { retryAfterMs: number }): Record<string, string> {
  return { 'retry-after': String(Math.ceil(result.retryAfterMs / 1000)) };
}

/**
 * Terapkan kuota pada satu permintaan route publik.
 *
 * Mengembalikan `null` bila permintaan boleh lanjut, atau respons 429 siap
 * kirim. Kegagalan limiter (skema belum dimigrasikan, database mati) diteruskan
 * sebagai `null` + log: lihat alasan fail-open di kepala berkas.
 *
 * `headers` diterima sebagai `Headers` milik `Request`, bukan `NextRequest`,
 * supaya helper ini dapat dipakai route mana pun dan diuji tanpa Next.
 */
export async function enforcePublicRateLimit(
  headers: HeaderLike | null | undefined,
  options: RateLimitOptions,
): Promise<Response | null> {
  const bucket = rateLimitBucket(headers, options.scope, options.nowMs);

  let result: DistributedRateLimitResult;
  try {
    result = await checkDistributedRateLimit(getSqlClient(), bucket, options);
  } catch (error) {
    logEvent('warn', 'rate_limit.unavailable', { scope: options.scope, error });
    return null;
  }

  if (result.allowed) return null;

  return apiError('RATE_LIMITED', 'Terlalu banyak permintaan. Coba lagi sebentar lagi.', 429, {
    details: { retry_after_ms: result.retryAfterMs },
    headers: rateLimitHeaders(result),
  });
}
