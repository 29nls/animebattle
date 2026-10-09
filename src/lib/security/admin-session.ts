/**
 * Sesi admin untuk panel `/admin` — jembatan sebelum Supabase Auth (Sprint 4).
 *
 * Masalah yang dijawab modul ini: rute `/api/admin/*` sudah fail-closed dengan
 * bearer `ADMIN_INGESTION_SECRET`, tetapi **halaman** `/admin/*` tidak punya
 * autentikasi sama sekali. Begitu halaman itu menampilkan data sungguhan (job,
 * pesan error, URL sumber), membiarkannya terbuka berarti membocorkan isi
 * operasional ke publik — termasuk pesan error yang dapat menyebut detail
 * internal. Karena itu halaman admin memakai token sesi.
 *
 * Bentuknya sengaja stateless: cookie berisi `v1.<issued>.<hmac>` dengan
 * tanda tangan HMAC-SHA256 atas `v1.<issued>` memakai secret yang sama dengan
 * bearer API. Tidak ada tabel sesi, tidak ada state yang perlu dibersihkan —
 * dan tidak ada kata sandi kedua yang harus dikelola. Batas umur 12 jam
 * mengikat cookie yang bocor tanpa perlu daftar pencabutan.
 *
 * Yang **tidak** dilakukan: modul ini tidak menggantikan otorisasi berperan
 * (PRD §25.2). Siapa pun yang memegang token admin adalah admin. Role
 * `viewer`/`curator`/`admin`/`owner` baru bermakna setelah Supabase Auth ada.
 *
 * Zona `node-runtime` (PRD §39): impor relatif ber-ekstensi `.ts` untuk modul
 * internal; `node:crypto` adalah specifier bare paket yang sah.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const ADMIN_SESSION_COOKIE = 'avb_admin_session';

/** Umur sesi; cukup untuk satu shift kerja, tidak lebih. */
export const ADMIN_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const TOKEN_VERSION = 'v1';

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

function signaturesMatch(a: string, b: string): boolean {
  // Panjang disamakan oleh sha256 sebelum dibandingkan; ini menjaga perbandingan
  // tetap timing-safe walau bentuk token diubah di masa depan.
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Membuat token sesi untuk jam yang diberikan (disuntik agar dapat diuji). */
export function createAdminSessionToken(secret: string, nowMs: number): string {
  const issued = Math.floor(nowMs / 1000);
  return `${TOKEN_VERSION}.${issued}.${sign(secret, `${TOKEN_VERSION}.${issued}`)}`;
}

/**
 * Memverifikasi token: bentuk, tanda tangan, dan umur. Mengembalikan `false`
 * untuk semua bentuk yang tidak sah — pemanggil tidak perlu tahu alasannya,
 * dan halaman hanya perlu satu keputusan: tampilkan atau minta login.
 */
export function verifyAdminSessionToken(
  token: string | null | undefined,
  secret: string | null | undefined,
  nowMs: number,
  maxAgeMs: number = ADMIN_SESSION_MAX_AGE_MS,
): boolean {
  if (typeof token !== 'string' || typeof secret !== 'string' || secret.trim() === '') return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [version, issuedRaw, signature] = parts;
  if (version !== TOKEN_VERSION) return false;

  const issued = Number(issuedRaw);
  if (!Number.isInteger(issued) || issued < 0) return false;

  const expected = sign(secret, `${TOKEN_VERSION}.${issued}`);
  if (!signaturesMatch(signature, expected)) return false;

  const ageMs = nowMs - issued * 1000;
  // `ageMs < 0` menolak token dari masa depan (jam yang bergeser / token dibuat
  // dengan stempel waktu palsu).
  return ageMs >= 0 && ageMs <= maxAgeMs;
}
