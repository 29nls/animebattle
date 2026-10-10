/**
 * Base URL publik situs untuk metadata, Open Graph, robots.txt, dan sitemap.
 *
 * Kenapa tidak `process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'`
 * langsung di setiap pemanggil: `.env.example` — template yang disalin setiap
 * pengembang menjadi `.env` — menetapkan variabel ini sebagai **string kosong**,
 * dan string kosong bukan nullish. Operator `??` tidak menolongnya, sehingga
 * `new URL('')` melempar `TypeError: Invalid URL` saat modul `app/layout.tsx`
 * dievaluasi. Akibatnya setiap halaman ber-`force-dynamic` (yaitu semua halaman
 * yang memuat data) menjawab HTTP 500, sementara halaman statis — HTML hasil
 * pre-render, tanpa evaluasi ulang modul — tetap 200. Gejala itu menyesatkan:
 * halaman yang rusak tampak tidak berhubungan dengan variabel ini.
 *
 * Aturannya di sini: nilai kosong atau berisi spasi saja berarti **belum
 * diatur** → pakai default. Nilai yang terisi dipakai apa adanya (spasi pinggir
 * dipangkas); validitasnya tetap tanggung jawab operator — URL yang salah
 * bentuk memang harus terlihat, bukan diam-diam diganti default.
 */

/** Nilai yang dipakai bila `NEXT_PUBLIC_SITE_URL` belum diatur (lihat README). */
export const DEFAULT_SITE_URL = 'http://localhost:3000';

/** Base URL situs yang sudah dinormalisasi — tidak pernah string kosong. */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return configured ? configured : DEFAULT_SITE_URL;
}
