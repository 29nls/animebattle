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
 *     `?sort=name` yang diam-diam diabaikan membuat klien mengira urutannya
 *     berubah, padahal tidak. Sama untuk `types` yang berisi nilai tak dikenal:
 *     `types=character,episode` harus ditolak, bukan diperlakukan sebagai
 *     "hanya karakter" — kalau tidak, klien mengira episode ikut dicari.
 *  2. **Nilai di luar daftar yang diizinkan ditolak**, bukan dijepit diam-diam:
 *     `per_page=37` yang berubah sendiri menjadi 20 membuat pemanggil tidak tahu
 *     batas mana yang berlaku. Daftar 20/50/100/200 adalah kontrak PRD §18.
 *  3. **Kueri kosong bukan galat.** `?q=` (atau tanpa `q`) menjawab 200 dengan
 *     daftar kosong: kotak pencarian yang masih kosong bukan permintaan yang
 *     salah. Yang salah adalah mengembalikan seluruh katalog sebagai "hasil".
 */

/** Nama parameter yang diterima; dipakai juga di pesan galat agar dapat ditindaklanjuti. */
export const ACCEPTED_SEARCH_PARAMS = ['q', 'verse', 'media', 'page', 'per_page', 'limit', 'types'] as const;

/** Ukuran halaman yang sah — sama dengan batas yang dipaksakan fungsi RPC. */
export const PER_PAGE_OPTIONS = [20, 50, 100, 200] as const;

/**
 * Tipe entitas yang dapat dicari. Daftar ini juga menjadi daftar nilai sah
 * parameter `types`; fungsi RPC memakai string yang sama untuk memilih cabang.
 * Menambah tipe di sini tanpa menambah cabang di `search_characters_page` hanya
 * menghasilkan hasil kosong, jadi keduanya harus berubah bersama.
 */
export const SEARCH_TYPES = ['character', 'verse'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

/** Tipe bawaan: perilaku lama (hanya karakter) tetap berlaku untuk klien lama. */
export const DEFAULT_SEARCH_TYPES: readonly SearchType[] = ['character'];

/** Nilai `media` yang sah; sama dengan enum `media_type_t` di DDL. */
export const MEDIA_VALUES = ['manga', 'anime', 'game', 'novel', 'comic', 'movie', 'mixed', 'other'] as const;

/** Batas panjang kueri. Lebih panjang dari ini bukan pencarian, melainkan payload. */
export const MAX_QUERY_LENGTH = 200;

/** Batas halaman tertinggi; di atas ini, hasilnya pasti kosong dan hanya membebani DB. */
export const MAX_PAGE = 10_000;

/** Parameter yang disebut kontrak API tetapi belum diimplementasikan. */
const UNIMPLEMENTED_PARAMS: Record<string, string> = {};

export interface SearchQuery {
  /** Kueri setelah dipangkas; boleh kosong (hasil kosong, bukan seluruh katalog). */
  q: string;
  verseSlug: string | null;
  media: string | null;
  /** Dimulai dari 1. */
  page: number;
  perPage: number;
  /** Tipe entitas yang dicari; minimal satu, tanpa duplikat. */
  types: SearchType[];
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

  // `types` dipisah koma, mis. `types=character,verse`. Nilai kosong berarti
  // "pakai bawaan" supaya `?types=` dari form yang belum diisi tidak menjadi
  // galat; nilai yang tidak dikenal tetap ditolak dengan daftar pilihan.
  const rawTypes = params.get('types');
  let types: SearchType[] = [...DEFAULT_SEARCH_TYPES];
  if (rawTypes !== null && rawTypes.trim() !== '') {
    const requested = rawTypes
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry !== '');
    if (requested.length === 0) {
      return fail(`Parameter types kosong. Diterima: ${SEARCH_TYPES.join(', ')}.`);
    }
    const unknown = requested.filter((entry) => !(SEARCH_TYPES as readonly string[]).includes(entry));
    if (unknown.length > 0) {
      return fail(
        `Parameter types tidak dikenal: ${unknown.join(', ')}. Diterima: ${SEARCH_TYPES.join(', ')}.`,
      );
    }
    // Duplikat dibuang, urutan dipertahankan: `types=verse,verse` bukan alasan
    // menggandakan baris di RPC, dan urutan tidak memengaruhi hasil.
    types = [...new Set(requested)] as SearchType[];
  }

  return { ok: true, value: { q: rawQuery, verseSlug, media, page, perPage, types } };
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
