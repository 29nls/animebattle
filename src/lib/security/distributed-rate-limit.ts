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
  const rows = await sql.query<RateLimitRow>(
    `select allowed, remaining, retry_after_ms
       from rate_limit_hit($1, $2, $3, to_timestamp($4 / 1000.0))`,
    [bucket, options.windowMs, options.limit, options.nowMs ?? Date.now()],
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
    console.error(`[rate-limit] ${options.scope}: pemeriksaan kuota gagal, permintaan diteruskan:`, error);
    return null;
  }

  if (result.allowed) return null;

  return apiError('RATE_LIMITED', 'Terlalu banyak permintaan. Coba lagi sebentar lagi.', 429, {
    details: { retry_after_ms: result.retryAfterMs },
    headers: rateLimitHeaders(result),
  });
}
