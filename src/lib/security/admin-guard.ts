/**
 * Guard otentikasi rute admin — **fail-closed** (PRD §28, AC-26).
 *
 * Aturan yang dikunci modul ini:
 *  1. Tanpa konfigurasi secret, SEMUA permintaan ditolak 503. Tidak ada fallback
 *     "izinkan bila belum disetel" — itu celah yang persis menutup permintaan
 *     sebelumnya ("supaya tidak pernah bisa dipanggil publik").
 *  2. Perbandingan secret memakai `timingSafeEqual`: perbandingan string biasa
 *     bocor panjang/prefiks melalui waktu eksekusi.
 *  3. Identitas untuk rate limit dipilih dari header proxy standar
 *     (X-Forwarded-For), dengan fallback ke principal statis.
 *
 * Zona `node-runtime` (PRD §39): impor relatif + ekstensi `.ts` eksplisit,
 * tanpa `services/ingestion` di graf impor.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

/** Dilempar bila pemanggil (kode route) salah memakai guard — bug, bukan request jahat. */
export class AdminGuardConfigError extends Error {
  override readonly name = 'AdminGuardConfigError';
}

export type GuardEnvironment = Record<string, string | undefined>;

export type AdminGuardResult =
  | { ok: true; principal: string; identity: string }
  | { ok: false; status: 401 | 503; error: string };

/** Ambil satu header dari request dengan gaya netral platform. */
interface HeaderLike {
  get(name: string): string | null;
}

/**
 * Perbandingan yang aman terhadap timing attack. Kedua buffer dibuat
 * berpanjang tetap (sha256) sehingga timingSafeEqual tidak melempar saat
 * panjangnya berbeda.
 *
 * Diekspor agar kontrak "timing-safe" dapat diuji langsung (unit test memeriksa
 * mekanisme perbandingannya, bukan hanya keluarannya).
 */
export function secretsMatch(provided: string, configured: string): boolean {
  const a = (provided ?? '').trim();
  const b = (configured ?? '').trim();
  if (a.length === 0 || b.length === 0) return false;
  const digest = (value: string): Buffer =>
    // createHash murni deterministik — panjang output konstan 32 byte.
    createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * Periksa request admin. Urutan keputusan sengaja: konfigurasi dulu (503),
 * baru kredensial (401) — request tidak pernah lolos bila konfigurasi hilang.
 */
export function adminGuard(
  request: { headers: HeaderLike },
  env: GuardEnvironment = process.env,
  envKey: string,
): AdminGuardResult {
  if (typeof envKey !== 'string' || envKey.trim() === '') {
    throw new AdminGuardConfigError('adminGuard wajib dipanggil dengan nama env secret.');
  }

  const configured = env[envKey];
  if (typeof configured !== 'string' || configured.trim() === '') {
    return {
      ok: false,
      status: 503,
      error: `${envKey} belum dikonfigurasi; rute admin sengaja gagal tertutup.`,
    };
  }

  const header = request.headers.get('authorization');
  if (header === null || header.trim() === '') {
    return { ok: false, status: 401, error: 'Tidak berwenang.' };
  }

  const [scheme, ...rest] = header.trim().split(/\s+/);
  if ((scheme ?? '').toLowerCase() !== 'bearer' || rest.length === 0) {
    return { ok: false, status: 401, error: 'Tidak berwenang.' };
  }
  const provided = rest.join(' ');
  if (!secretsMatch(provided, configured)) {
    return { ok: false, status: 401, error: 'Tidak berwenang.' };
  }

  const forwardedFor = request.headers.get('x-forwarded-for');
  const identity = forwardedFor !== null && forwardedFor.trim() !== '' ? forwardedFor.trim() : 'bearer-admin';

  return { ok: true, principal: 'bearer-admin', identity };
}
