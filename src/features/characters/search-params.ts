/**
 * Validasi parameter `/api/search` dan `/api/search/suggest`.
 *
 * Kenapa dipisah dari route: aturan ini murni (tanpa `Request`, tanpa database),
 * sehingga dapat diuji langsung tanpa menjalankan Next maupun Postgres — dan
 * `app/api/search/route.ts` tinggal memetakan hasilnya ke status HTTP.
 *
 * Tiga keputusan yang disengaja, semuanya tentang berkata jujur kepada pemanggil:
 *
 *  1. **Parameter tak dikenal ditolak 400, bukan diabaikan.** Permintaan
 *     `?types=character,verse` yang diam-diam diabaikan membuat klien mengira
 *     ia mencari verse juga, padahal tidak. Endpoint ini hari ini hanya mencari
 *     karakter, dan itu dikatakan terus terang.
 *  2. **Nilai di luar daftar yang diizinkan ditolak**, bukan dijepit diam-diam:
 *     `per_page=37` yang berubah sendiri menjadi 20 membuat pemanggil tidak tahu
 *     batas mana yang berlaku. Daftar 20/50/100/200 adalah kontrak PRD §18.
 *  3. **Kueri kosong bukan galat.** `?q=` (atau tanpa `q`) menjawab 200 dengan
 *     daftar kosong: kotak pencarian yang masih kosong bukan permintaan yang
 *     salah. Yang salah adalah mengembalikan seluruh katalog sebagai "hasil".
 */

/** Nama parameter yang diterima; dipakai juga di pesan galat agar dapat ditindaklanjuti. */
export const ACCEPTED_SEARCH_PARAMS = ['q', 'verse', 'media', 'page', 'per_page', 'limit'] as const;

/** Ukuran halaman yang sah — sama dengan batas yang dipaksakan fungsi RPC. */
export const PER_PAGE_OPTIONS = [20, 50, 100, 200] as const;

/** Nilai `media` yang sah; sama dengan enum `media_type_t` di DDL. */
export const MEDIA_VALUES = ['manga', 'anime', 'game', 'novel', 'comic', 'movie', 'mixed', 'other'] as const;

/** Batas panjang kueri. Lebih panjang dari ini bukan pencarian, melainkan payload. */
export const MAX_QUERY_LENGTH = 200;

/** Batas halaman tertinggi; di atas ini, hasilnya pasti kosong dan hanya membebani DB. */
export const MAX_PAGE = 10_000;

/** Parameter yang disebut kontrak API tetapi belum diimplementasikan. */
const UNIMPLEMENTED_PARAMS: Record<string, string> = {
  types:
    'Pencarian lintas tipe (types) belum diimplementasikan: endpoint ini hanya mencari karakter. ' +
    'Hapus parameter types, atau gunakan /verses untuk menjelajahi verse.',
};

export interface SearchQuery {
  /** Kueri setelah dipangkas; boleh kosong (hasil kosong, bukan seluruh katalog). */
  q: string;
  verseSlug: string | null;
  media: string | null;
  /** Dimulai dari 1. */
  page: number;
  perPage: number;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function fail(message: string): ParseResult<never> {
  return { ok: false, message };
}

/**
 * Baca parameter pencarian dari `URLSearchParams`.
 *
 * `limit` tetap diterima sebagai alias `per_page` karena itu nama parameter pada
 * kontrak `/api/search` yang sudah berjalan; menerimanya berarti klien lama tidak
 * rusak. Memberi keduanya sekaligus ditolak supaya tidak ada nilai yang menang
 * tanpa pembaca tahu.
 */
export function parseSearchQuery(params: URLSearchParams): ParseResult<SearchQuery> {
  for (const key of params.keys()) {
    if (key in UNIMPLEMENTED_PARAMS) return fail(UNIMPLEMENTED_PARAMS[key]);
    if (!(ACCEPTED_SEARCH_PARAMS as readonly string[]).includes(key)) {
      return fail(
        `Parameter tidak dikenal: ${key}. Diterima: ${ACCEPTED_SEARCH_PARAMS.join(', ')}.`,
      );
    }
  }

  const rawQuery = (params.get('q') ?? '').trim();
  if (rawQuery.length > MAX_QUERY_LENGTH) {
    return fail(`Parameter q terlalu panjang (maksimum ${MAX_QUERY_LENGTH} karakter).`);
  }

  const rawVerse = (params.get('verse') ?? '').trim();
  if (rawVerse.length > 100) return fail('Parameter verse terlalu panjang.');
  const verseSlug = rawVerse === '' ? null : rawVerse;

  const rawMedia = (params.get('media') ?? '').trim().toLowerCase();
  let media: string | null = null;
  if (rawMedia !== '') {
    if (!(MEDIA_VALUES as readonly string[]).includes(rawMedia)) {
      return fail(`Parameter media tidak dikenal: ${rawMedia}. Diterima: ${MEDIA_VALUES.join(', ')}.`);
    }
    media = rawMedia;
  }

  const rawPerPage = params.get('per_page');
  const rawLimit = params.get('limit');
  if (rawPerPage !== null && rawLimit !== null) {
    return fail('Gunakan salah satu: per_page atau limit (alias lama), bukan keduanya.');
  }
  const rawSize = rawPerPage ?? rawLimit;
  let perPage: number = PER_PAGE_OPTIONS[0];
  if (rawSize !== null) {
    const parsed = Number(rawSize);
    if (!(PER_PAGE_OPTIONS as readonly number[]).includes(parsed)) {
      return fail(
        `Parameter ${rawPerPage !== null ? 'per_page' : 'limit'} harus salah satu dari ${PER_PAGE_OPTIONS.join(', ')}.`,
      );
    }
    perPage = parsed;
  }

  const rawPage = params.get('page');
  let page = 1;
  if (rawPage !== null) {
    const parsed = Number(rawPage);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PAGE) {
      return fail(`Parameter page harus bilangan bulat 1–${MAX_PAGE}.`);
    }
    page = parsed;
  }

  return { ok: true, value: { q: rawQuery, verseSlug, media, page, perPage } };
}

/** Parameter `/api/search/suggest`: hanya `q`, dan wajib berisi sesuatu. */
export function parseSuggestQuery(params: URLSearchParams): ParseResult<{ q: string }> {
  for (const key of params.keys()) {
    if (key !== 'q') {
      return fail(`Parameter tidak dikenal: ${key}. Endpoint ini hanya menerima q.`);
    }
  }
  const q = (params.get('q') ?? '').trim();
  if (q === '') return fail('Parameter q wajib diisi untuk saran pencarian.');
  if (q.length > MAX_QUERY_LENGTH) {
    return fail(`Parameter q terlalu panjang (maksimum ${MAX_QUERY_LENGTH} karakter).`);
  }
  return { ok: true, value: { q } };
}
