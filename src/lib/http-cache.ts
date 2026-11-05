/**
 * Header cache HTTP untuk endpoint baca anonim.
 *
 * Kenapa dipusatkan: nilai `s-maxage` dan `stale-while-revalidate` adalah janji
 * tentang seberapa basi data boleh dilihat pengguna. Menuliskannya sebagai
 * string lepas di setiap route membuat janji itu menyimpang antar endpoint tanpa
 * ada yang menyadarinya — dan test tidak dapat memeriksa angka yang tidak
 * bernama.
 *
 * Dua direktif dipakai bersama:
 *
 *   * `s-maxage` — batas umur di cache bersama (CDN/edge). Browser tidak
 *     menyimpannya; permintaan pengguna tetap sampai ke server kecuali lewat
 *     edge.
 *   * `stale-while-revalidate` — setelah kedaluwarsa, edge masih boleh menyajikan
 *     salinan basi selama jendela ini sambil menyegarkan di latar belakang.
 *     Untuk pencarian, ini yang membuat lonjakan trafik tidak berubah menjadi
 *     lonjakan query database.
 *
 * `private` sengaja TIDAK dipakai: respons ini tidak berisi data per pengguna,
 * jadi cache bersama justru yang diinginkan. Sebaliknya, route yang menyentuh
 * data sensitif tidak boleh memakai helper ini sama sekali.
 */

/** Umur cache bersama untuk hasil pencarian (PRD §22 tabel endpoint: 60 s). */
export const SEARCH_S_MAXAGE_SECONDS = 60;

/**
 * Jendela penyajian basi. Dipilih 5× `s-maxage`: cukup untuk menyerap lonjakan
 * singkat (mis. satu kata kunci menjadi tren) tanpa membuat hasil terasa
 * ketinggalan zaman setelah konten diperbarui.
 */
export const SEARCH_STALE_WHILE_REVALIDATE_SECONDS = 300;

/**
 * Nilai `Cache-Control` untuk `/api/search` dan `/api/search/suggest`.
 *
 * Dibangun dari konstanta di atas, bukan literal, supaya test dapat memeriksa
 * angka yang sama yang dikirim route.
 */
export const SEARCH_CACHE_CONTROL = `public, s-maxage=${SEARCH_S_MAXAGE_SECONDS}, stale-while-revalidate=${SEARCH_STALE_WHILE_REVALIDATE_SECONDS}`;

/**
 * Header siap pakai untuk `Response.json(..., { headers })`.
 *
 * `Vary` tidak dicantumkan karena respons tidak bergantung pada header
 * permintaan apa pun (tanpa auth, tanpa bahasa). Menambahkannya hanya akan
 * memecah cache tanpa manfaat.
 */
export function searchCacheHeaders(): Record<string, string> {
  return { 'Cache-Control': SEARCH_CACHE_CONTROL };
}
