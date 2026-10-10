/**
 * Jembatan galat pemuatan data → hasil yang dapat dirender halaman.
 *
 * Kenapa modul ini ada: halaman server memuat data lewat pemilih di
 * modul `queries.ts` tiap fitur, dan pemilih itu sengaja **melempar** ketika
 * PostgreSQL belum dikonfigurasi (lihat `lib/db/client.ts` dan
 * `features/demo/provider.ts` — gangguan infrastruktur tidak boleh ditutupi
 * data demo, supaya operator tidak mengejar masalah yang salah). Tanpa
 * penangkap di sisi halaman, galat itu sampai ke runtime Next dan dijawab
 * HTTP 500: kegagalan konfigurasi yang menyamar sebagai bug aplikasi.
 * Terbukti pada audit Lighthouse (`npx lhci autorun`): `/` dan `/characters`
 * lolos, `/verses` gagal dengan `ERRORED_DOCUMENT_REQUEST (Status code: 500)`.
 *
 * Kenapa di modul `.ts` terpisah, bukan `try/catch` di dalam halaman: berkas
 * halaman berisi JSX dan tidak dapat dijalankan `node --test` (Node 24 menolak
 * impor `.tsx`). Menaruh keputusannya di sini membuat perilaku "galat database
 * tidak boleh menjatuhkan halaman" dapat diuji tanpa browser — lihat
 * `tests/web/data-source.test.ts`.
 */

import { DatabaseNotConfiguredError } from '../lib/db/client.ts';

/** Hasil pemuatan data halaman: berhasil, atau gagal dengan pesan yang dapat ditindaklanjuti. */
export type LoadOutcome<T> =
  | { status: 'ok'; data: T }
  | { status: 'failed'; message: string };

/**
 * Pesan yang ditampilkan ke operator: menyebut apa yang hilang dan apa yang
 * harus diisi, bukan hanya "internal server error".
 */
export function describeLoadFailure(error: unknown): string {
  if (error instanceof DatabaseNotConfiguredError) return error.message;
  return `Gagal memuat data: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Jalankan `load` dan ubah setiap galat menjadi hasil `failed`.
 *
 * Kontrak: fungsi ini **tidak pernah** melempar. Halaman tetap menjawab 200
 * dengan panel galat yang jujur, terlewatnya `DATABASE_URL` tidak lagi menjadi
 * halaman 500, dan kegagalan yang benar-benar tak terduga pun tetap terlihat
 * pesannya — bukan ditelan diam-diam.
 */
export async function attemptLoad<T>(load: () => Promise<T>): Promise<LoadOutcome<T>> {
  try {
    return { status: 'ok', data: await load() };
  } catch (error) {
    return { status: 'failed', message: describeLoadFailure(error) };
  }
}
