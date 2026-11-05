/**
 * Parameter halaman `/characters` — dipisah dari JSX supaya dapat diuji tanpa
 * Next maupun database.
 *
 * Beda dengan `search-params.ts` (kontrak API yang menolak input di luar batas
 * dengan 400), halaman publik tidak boleh menjawab galat hanya karena URL hasil
 * ketikan pengguna tidak sempurna. Nilai yang tidak dikenal karena itu
 * **diabaikan** di sini: `?media=light-novel` menampilkan katalog tanpa filter
 * media, bukan halaman galat. Yang tidak boleh terjadi adalah filter yang
 * diam-diam berubah arti — karena itu nilai yang sah selalu diteruskan apa
 * adanya ke query.
 */

/** Nilai media yang sama dengan enum `media_type_t` di DDL. */
export const CHARACTER_MEDIA_VALUES = [
  'manga',
  'anime',
  'game',
  'novel',
  'comic',
  'movie',
  'mixed',
  'other',
] as const;

export type CharacterMedia = (typeof CHARACTER_MEDIA_VALUES)[number];

/** Ukuran halaman yang sama dengan kontrak pagination PRD §18. */
export const CHARACTER_PAGE_SIZES = [20, 50, 100, 200] as const;
export const DEFAULT_CHARACTER_PAGE_SIZE = 50;
export const MAX_CHARACTER_QUERY_LENGTH = 200;

export interface CharacterListParams {
  query: string;
  verseSlug: string | null;
  media: CharacterMedia | null;
  /** Dimulai dari 1. */
  page: number;
  perPage: number;
}

export interface CharacterListSearchInput {
  q?: string;
  verse?: string;
  media?: string;
  page?: string;
  per_page?: string;
}

function positiveInteger(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Normalisasi parameter URL menjadi bentuk yang selalu aman dikirim ke query.
 *
 * - `q` dipangkas dan dipotong pada batas kontrak (bukan ditolak).
 * - `media` hanya diterima bila persis salah satu nilai enum.
 * - `page`/`per_page` kembali ke default bila tidak sah.
 */
export function parseCharacterListParams(input: CharacterListSearchInput): CharacterListParams {
  const query = (input.q ?? '').trim().slice(0, MAX_CHARACTER_QUERY_LENGTH);
  const verse = (input.verse ?? '').trim();
  const media = (input.media ?? '').trim().toLowerCase();
  const parsedPage = positiveInteger(input.page);
  const parsedSize = positiveInteger(input.per_page);

  return {
    query,
    verseSlug: verse === '' ? null : verse.slice(0, 100),
    media: (CHARACTER_MEDIA_VALUES as readonly string[]).includes(media)
      ? (media as CharacterMedia)
      : null,
    page: parsedPage ?? 1,
    perPage:
      parsedSize !== null && (CHARACTER_PAGE_SIZES as readonly number[]).includes(parsedSize)
        ? parsedSize
        : DEFAULT_CHARACTER_PAGE_SIZE,
  };
}

export function hasCharacterFilters(params: CharacterListParams): boolean {
  return params.query !== '' || params.verseSlug !== null || params.media !== null;
}

/**
 * URL halaman dengan filter yang dipertahankan.
 *
 * Pagination wajib membawa filter yang sedang aktif: tautan "halaman 2" yang
 * membuang `verse` mengubah arti halaman di tengah jalan. Nilai default tidak
 * ditulis supaya URL tetap pendek, dan `null` pada `overrides` menghapus filter.
 */
export function characterListHref(
  current: CharacterListParams,
  overrides: Partial<CharacterListParams> = {},
): string {
  const merged: CharacterListParams = { ...current, ...overrides };
  const params = new URLSearchParams();
  if (merged.query !== '') params.set('q', merged.query);
  if (merged.verseSlug !== null) params.set('verse', merged.verseSlug);
  if (merged.media !== null) params.set('media', merged.media);
  if (merged.page > 1) params.set('page', String(merged.page));
  if (merged.perPage !== DEFAULT_CHARACTER_PAGE_SIZE) {
    params.set('per_page', String(merged.perPage));
  }
  const suffix = params.toString();
  return suffix === '' ? '/characters' : `/characters?${suffix}`;
}

/** Label manusiawi untuk nilai media; dipakai filter dan kartu. */
export const MEDIA_LABELS: Record<CharacterMedia, string> = {
  manga: 'Manga',
  anime: 'Anime',
  game: 'Game',
  novel: 'Novel',
  comic: 'Komik',
  movie: 'Film',
  mixed: 'Campuran',
  other: 'Lainnya',
};

export function mediaLabel(value: string): string {
  return MEDIA_LABELS[value as CharacterMedia] ?? value;
}
