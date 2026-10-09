/**
 * Pencocokan URL sumber terhadap allow-list (`sources.base_url`).
 *
 * Kenapa di `src/lib` dan bukan di `services/ingestion`: aturan ini dibutuhkan
 * **dua sisi**. Jalur request memakainya untuk menolak impor URL yang tidak
 * diizinkan dengan 409 `SOURCE_DISABLED` (AC-19) sebelum satu baris antrian pun
 * ditulis; worker memakainya lagi sebagai pemeriksaan kedua sebelum menyentuh
 * jaringan. Bila dua sisi punya salinan aturannya sendiri, cepat atau lambat
 * keduanya berbeda — dan perbedaan itu berarti URL yang ditolak UI diterima
 * worker, atau sebaliknya.
 *
 * Fungsi di sini murni terhadap data: ia tidak membaca database dan tidak
 * melakukan fetch. Pemanggil yang mengambil baris `sources`.
 *
 * Zona `node-runtime`: tanpa impor apa pun, sehingga aman dimuat jalur request
 * maupun worker (PRD §39).
 */

export interface AllowListedSource {
  slug: string;
  base_url: string;
}

/**
 * Apakah `target` berada di dalam lingkup `baseUrl`?
 *
 * Aturannya: skema harus http/https, origin harus sama, dan jalur target harus
 * berada di bawah prefiks jalur `base_url`. Prefiks dinormalkan dengan garis
 * miring penutup agar `https://x.test/api` tidak ikut mencocokkan
 * `https://x.test/apix`.
 */
export function matchesSourceUrl(baseUrl: string, target: string): boolean {
  let base: URL;
  let url: URL;
  try {
    base = new URL(baseUrl);
    url = new URL(target);
  } catch {
    return false;
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') return false;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (base.origin !== url.origin) return false;

  const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  return url.pathname.startsWith(basePath);
}

/**
 * Memilih sumber paling spesifik yang mencakup `target` — prefiks jalur
 * terpanjang menang, sehingga sumber dengan host sama tetapi jalur lebih
 * sempit tidak "ditelan" oleh sumber yang lebih luas.
 */
export function resolveSourceForUrl<T extends AllowListedSource>(
  sources: readonly T[],
  target: string,
): T | null {
  let best: T | null = null;
  let bestLength = -1;

  for (const source of sources) {
    if (!matchesSourceUrl(source.base_url, target)) continue;
    const basePath = new URL(source.base_url).pathname;
    const length = basePath.endsWith('/') ? basePath.length : basePath.length + 1;
    if (length > bestLength) {
      best = source;
      bestLength = length;
    }
  }

  return best;
}
