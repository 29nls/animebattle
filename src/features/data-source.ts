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
 * Saran langkah-perbaikan untuk kegagalan yang tindakannya sudah jelas.
 *
 * Hanya dua kasus, keduanya pernah benar-benar terjadi pada deployment ini:
 * sertifikat TLS Supabase yang tidak terverifikasi, dan skema yang belum
 * diterapkan ke database tujuan. Selain itu `null` — pesan mentah driver
 * dibiarkan apa adanya, bukan ditutup tebakan.
 */
function remedyHint(error: unknown): string | null {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  const message = error instanceof Error ? error.message : '';

  if (
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    /self-signed certificate|certificate chain|unable to verify/i.test(message)
  ) {
    return (
      'Sertifikat TLS server tidak dapat diverifikasi. Untuk host Supabase, root CA-nya sudah ' +
      'menjadi bawaan aplikasi (src/lib/db/supabase-ca.ts), jadi kegagalan ini biasanya berarti ' +
      'host pada DATABASE_URL bukan host Supabase atau rantai sertifikatnya berbeda — setel ' +
      'DATABASE_CA_CERT berisi PEM CA-nya bila begitu (lihat README §Konfigurasi lingkungan).'
    );
  }

  if (code === '42P01') {
    return (
      'Skema aplikasi tidak ada di database tujuan: jalankan docs/schema.sql (lalu docs/seed.sql ' +
      'bila perlu) pada DATABASE_URL yang dipakai, atau arahkan DATABASE_URL ke project Supabase ' +
      'yang benar.'
    );
  }

  return null;
}

/**
 * Pesan yang ditampilkan ke operator: menyebut apa yang hilang, apa yang harus
 * diisi, dan — bila diketahui — langkah perbaikannya, bukan hanya
 * "internal server error".
 */
export function describeLoadFailure(error: unknown): string {
  const base =
    error instanceof DatabaseNotConfiguredError
      ? error.message
      : `Gagal memuat data: ${error instanceof Error ? error.message : String(error)}`;
  const hint = remedyHint(error);
  return hint ? `${base} ${hint}` : base;
}

/**
 * Pesan yang boleh dilihat **pengunjung anonim**.
 *
 * Detail driver (`DATABASE_URL`, `sslmode`, nama skema/tabel) adalah informasi
 * infrastruktur: berguna bagi operator, tetapi tidak perlu dipublikasikan ke
 * siapa pun yang membuka halaman. Kontrak yang sama sudah berlaku untuk API
 * (`tests/security/api-error-contract.test.ts`); panel halaman kini mengikutinya.
 */
export const GENERIC_UNAVAILABLE_MESSAGE =
  'Database sedang tidak dapat dihubungi, jadi data belum bisa ditampilkan. ' +
  'Coba muat ulang halaman ini beberapa saat lagi.';

/**
 * Pilih pesan panel sesuai siapa yang melihat: detail untuk operator yang sudah
 * masuk panel admin, pesan generik untuk pengunjung lain.
 *
 * Catatan cakupan: cookie sesi admin di-scope ke `path=/admin`
 * (`features/admin/session.ts`), sehingga pada halaman publik `viewerIsOperator`
 * bernilai false untuk semua orang — termasuk admin. Artinya hari ini pengunjung
 * anonim selalu mendapat pesan generik, dan detail lengkap dapat dibaca operator
 * dari log server serta `/api/health/ready`. Agar detail ikut tampil di halaman
 * publik untuk admin, path cookie harus diperluas lebih dulu.
 */
export function visibleFailureMessage(detail: string, viewerIsOperator: boolean): string {
  return viewerIsOperator ? detail : GENERIC_UNAVAILABLE_MESSAGE;
}

/**
 * Jalankan `load` dan ubah setiap galat menjadi hasil `failed`.
 *
 * Kontrak: fungsi ini **tidak pernah** melempar. Halaman tetap menjawab 200
 * dengan panel galat yang jujur, terlewatnya `DATABASE_URL` tidak lagi menjadi
 * halaman 500, dan kegagalan yang benar-benar tak terduga pun tetap terlihat
 * pesannya — bukan ditelan diam-diam.
 *
 * Detailnya dicatat ke log server, bukan ke halaman: pengunjung anonim hanya
 * menerima `GENERIC_UNAVAILABLE_MESSAGE`, sedangkan operator mendapatkannya dari
 * log platform (Vercel) atau `/api/health/ready`.
 */
export async function attemptLoad<T>(load: () => Promise<T>): Promise<LoadOutcome<T>> {
  try {
    return { status: 'ok', data: await load() };
  } catch (error) {
    console.error('[database] pemuatan data halaman gagal:', error);
    return { status: 'failed', message: describeLoadFailure(error) };
  }
}
