/**
 * Query halaman karakter. Modul ini adalah satu-satunya tempat query karakter
 * ditulis — komponen dan route memanggil fungsi di sini, tidak pernah SQL
 * sendiri (PRD §39: "tidak ada query SQL langsung di komponen").
 *
 * Dua aturan yang terlihat jelas di berkas ini:
 *
 * 1. **Kolom selalu dieksplisitkan.** Tidak ada `select *`. Halaman daftar hanya
 *    butuh 8 dari 27 kolom `characters`; mengambil semuanya berarti mengangkut
 *    `description`, seluruh kolom lisensi gambar, dan kolom audit ke setiap
 *    request. Aturan ini ditegakkan lint (`no-select-star`), dan daftar tabel
 *    besar beserta alasannya ada di `tools/architecture/large-tables.mjs`.
 * 2. **Pagination di server.** `limit`/`offset` diteruskan ke SQL; tidak ada
 *    jalur yang memuat seluruh tabel ke memori lalu memotongnya di aplikasi
 *    (PRD §18, §37).
 */

import { demoCharacterListItems, demoEnabled } from '../demo/provider.ts';
import { getSqlClient, isDatabaseConfigured, type SqlClient } from '../../lib/db/client.ts';
import type { SearchType } from './search-params.ts';

/**
 * Kolom yang dibutuhkan kartu daftar. Sengaja bukan `*`: menambah kolom ke sini
 * harus keputusan sadar, karena setiap kolom ikut ke setiap render dan ke
 * payload cache.
 */
export const CHARACTER_LIST_COLUMNS = [
  'c.id',
  'c.slug',
  'c.name',
  'c.native_name',
  'c.image_url',
  'c.data_completeness',
  'c.popularity_score',
  'c.updated_at',
] as const;

export interface CharacterListItem {
  id: string;
  slug: string;
  name: string;
  native_name: string | null;
  image_url: string | null;
  data_completeness: 'complete' | 'partial' | 'minimal';
  popularity_score: number;
  /** Bisa `null` pada hasil pencarian: RPC tidak mengembalikan kolom audit ini. */
  updated_at?: string | null;
  /** Kode tier form default; `null` bila form default belum punya tier. */
  tier_code?: string | null;
  /** Verse asal — ditampilkan di kartu dan dipakai filter. */
  verse_slug?: string | null;
  verse_name?: string | null;
}

/** Batas atas yang sama dengan yang dipaksakan fungsional RPC (PRD §18: 20/50/100/200). */
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

export function normalizePageSize(requested: number | undefined): number {
  if (!Number.isFinite(requested) || requested === undefined || requested <= 0) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.floor(requested), MAX_PAGE_SIZE);
}

export interface ListCharactersParams {
  limit?: number;
  offset?: number;
  /** Filter verse (slug) dan media; `null`/absen berarti tidak menyaring. */
  verseSlug?: string | null;
  media?: string | null;
}

/** Kondisi filter yang dipakai query daftar dan hitungan. */
export interface CharacterListFilters {
  verseSlug?: string | null;
  media?: string | null;
}

/**
 * Daftar karakter untuk `/characters`, diurutkan seperti yang dijanjikan UI
 * (popularitas, lalu nama) sehingga pagination stabil — urutan tanpa tie-breaker
 * membuat `offset` dapat mengulang atau melewatkan baris antar request.
 */
export async function listCharacters(
  sql: SqlClient,
  params: ListCharactersParams = {},
): Promise<CharacterListItem[]> {
  const columns = CHARACTER_LIST_COLUMNS.join(', ');
  const limit = normalizePageSize(params.limit);
  const offset = Math.max(0, Math.floor(params.offset ?? 0));

  return sql.query<CharacterListItem>(
    `select ${columns},
            v.slug as verse_slug, v.name as verse_name,
            t.tier_code
       from characters c
       join verses v on v.id = c.verse_id
       left join character_versions cv
         on cv.character_id = c.id and cv.is_default = true and cv.deleted_at is null
       left join tiers t on t.id = cv.tier_id
      where ($1::text is null or v.slug = $1)
        and ($2::text is null or v.origin_media::text = $2)
      order by c.popularity_score desc, c.name asc
      limit $3 offset $4`,
    [params.verseSlug ?? null, params.media ?? null, limit, offset],
  );
}

export interface CharacterSearchHit {
  id: string;
  slug: string;
  name: string;
  verse_name: string;
  tier_code: string | null;
  score: number;
}

/**
 * Pencarian memakai RPC `search_characters` (FTS + trigram + alias + boost
 * popularitas), bukan LIKE bertingkat di aplikasi. Dua alasan: toleransi typo
 * ("testaroin") hanya jalan di index trigram, dan pemeringkatan harus satu
 * tempat agar hasil `/search` dan saran autocomplete tidak berbeda pendapat.
 *
 * `select * from <fungsi>` di sini bukan pelanggaran aturan kolom eksplisit:
 * bentuk keluarannya ditetapkan tanda tangan fungsi di DDL, bukan oleh tabel
 * yang dapat bertambah kolom tanpa sepengetahuan pemanggil.
 */
export async function searchCharacters(
  sql: SqlClient,
  query: string,
  limit = 20,
): Promise<CharacterSearchHit[]> {
  const q = query.trim();
  if (q === '') return [];

  return sql.query<CharacterSearchHit>(
    `select * from search_characters($1, $2, true)`,
    [q, normalizePageSize(limit)],
  );
}

/** Satu baris hasil pencarian berhalaman (kolom eksplisit dari fungsi RPC). */
export interface CharacterSearchRow {
  /**
   * Jenis entitas baris. RPC kini dapat mengembalikan karakter **dan** verse,
   * jadi pemanggil tidak boleh menganggap `id`/`slug` selalu milik karakter.
   */
  type: 'character' | 'verse';
  id: string;
  slug: string;
  name: string;
  native_name: string | null;
  verse_slug: string;
  verse_name: string;
  tier_code: string | null;
  data_completeness: string;
  popularity_score: number;
  score: number;
}

export interface CharacterSearchPage {
  /** Jumlah **seluruh** baris yang cocok, bukan jumlah baris di halaman ini. */
  total: number;
  rows: CharacterSearchRow[];
}

export interface SearchCharacterPageParams {
  query: string;
  verseSlug?: string | null;
  media?: string | null;
  /** Dimulai dari 1. */
  page?: number;
  perPage?: number;
  /**
   * Tipe entitas yang dicari. Bawaan `['character']` mempertahankan perilaku
   * lama; `['character', 'verse']` mengaktifkan pencarian lintas tipe.
   */
  types?: readonly SearchType[];
}

/**
 * Nilai `jsonb` dari driver dapat berupa objek (sudah di-parse) atau string
 * (terjadi pada klien yang disuntikkan maupun sebagian jalur postgres.js).
 * Bentuk apa pun yang tak terduga menjadi hasil kosong, bukan lemparan —
 * pencarian yang salah bentuk tidak boleh menjatuhkan halaman.
 */
function parseJsonPayload<T extends object>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as T) : fallback;
    } catch {
      return fallback;
    }
  }
  return typeof value === 'object' ? (value as T) : fallback;
}

/**
 * Pencarian berhalaman dengan filter verse/media.
 *
 * Satu round-trip: RPC `search_characters_page` mengembalikan `{ total, rows }`,
 * sehingga `total` tetap benar pada halaman yang kosong (mis. `page` melewati
 * halaman terakhir) — lihat alasan di `docs/schema.sql`.
 *
 * `page`/`perPage` di sini sudah divalidasi pemanggil (`search-params.ts`);
 * fungsi ini tetap menormalkannya supaya tidak ada jalur yang dapat mengirim
 * `offset` negatif atau `limit` di luar batas ke database.
 */
export async function searchCharacterPage(
  sql: SqlClient,
  params: SearchCharacterPageParams,
): Promise<CharacterSearchPage> {
  const q = params.query.trim();
  if (q === '') return { total: 0, rows: [] };

  const perPage = normalizePageSize(params.perPage);
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const offset = (page - 1) * perPage;

  const result = await sql.query<{ payload: unknown }>(
    `select search_characters_page($1, $2, $3, $4, $5, true, $6) as payload`,
    [
      q,
      params.verseSlug ?? null,
      params.media ?? null,
      perPage,
      offset,
      params.types && params.types.length > 0 ? [...params.types] : ['character'],
    ],
  );

  const payload = parseJsonPayload<{ total?: unknown; rows?: unknown }>(result[0]?.payload, {});
  const rows = Array.isArray(payload.rows) ? (payload.rows as CharacterSearchRow[]) : [];
  const total = Number(payload.total ?? rows.length);

  return { total: Number.isFinite(total) ? total : rows.length, rows };
}

export async function countCharacters(
  sql: SqlClient,
  filters: CharacterListFilters = {},
): Promise<number> {
  const rows = await sql.query<{ total: string }>(
    `select count(*)::text as total
       from characters c
       join verses v on v.id = c.verse_id
      where ($1::text is null or v.slug = $1)
        and ($2::text is null or v.origin_media::text = $2)`,
    [filters.verseSlug ?? null, filters.media ?? null],
  );
  return Number(rows[0]?.total ?? '0');
}

/** Dari mana baris daftar berasal — halaman menampilkan penanda bila `demo`. */
export type CharacterListSource = 'database' | 'demo';

export interface CharacterListResult {
  rows: CharacterListItem[];
  total: number | null;
  source: CharacterListSource;
}

/**
 * Pemilih sumber data untuk halaman `/characters`.
 *
 * Urutan yang disengaja: **database dulu**, demo hanya bila database memang belum
 * dikonfigurasi dan operator mengaktifkannya (`ALLOW_DEMO_DATA=1`). Database yang
 * dikonfigurasi tetapi tidak dapat dihubungi sengaja **tidak** ditutupi data demo:
 * galatnya diteruskan supaya gangguan infrastruktur terlihat, bukan tersamar.
 */
function completeness(value: string): CharacterListItem['data_completeness'] {
  return value === 'complete' || value === 'partial' ? value : 'minimal';
}

function fromSearchRow(row: CharacterSearchRow): CharacterListItem {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    native_name: row.native_name,
    image_url: null,
    data_completeness: completeness(row.data_completeness),
    popularity_score: row.popularity_score,
    updated_at: null,
    tier_code: row.tier_code,
    verse_slug: row.verse_slug,
    verse_name: row.verse_name,
  };
}

/**
 * Pemilih sumber data untuk halaman `/characters`.
 *
 * Urutan yang disengaja: **database dulu**, demo hanya bila database memang belum
 * dikonfigurasi dan operator mengaktifkannya (`ALLOW_DEMO_DATA=1`). Database yang
 * dikonfigurasi tetapi tidak dapat dihubungi sengaja **tidak** ditutupi data demo:
 * galatnya diteruskan supaya gangguan infrastruktur terlihat, bukan tersamar.
 *
 * Kueri non-kosong memakai RPC pencarian yang sama dengan `/api/search` supaya
 * halaman dan API tidak berbeda pendapat soal hasil, total, dan urutan. Kueri
 * kosong memakai query daftar ber-filter — RPC sengaja menjawab kosong untuk
 * kueri kosong, bukan seluruh katalog.
 */
export async function loadCharacterList(
  params: ListCharactersParams & { query?: string; verseSlug?: string | null; media?: string | null } = {},
): Promise<CharacterListResult> {
  if (demoEnabled() && !isDatabaseConfigured()) {
    const rows = demoCharacterListItems(params.query, {
      verseSlug: params.verseSlug,
      media: params.media,
    });
    return { rows, total: rows.length, source: 'demo' };
  }

  const sql = getSqlClient();
  const perPage = normalizePageSize(params.limit);
  const offset = Math.max(0, Math.floor(params.offset ?? 0));
  const query = (params.query ?? '').trim();

  if (query !== '') {
    const result = await searchCharacterPage(sql, {
      query,
      verseSlug: params.verseSlug ?? null,
      media: params.media ?? null,
      page: Math.floor(offset / perPage) + 1,
      perPage,
      types: ['character'],
    });
    return { rows: result.rows.map(fromSearchRow), total: result.total, source: 'database' };
  }

  const [rows, total] = await Promise.all([
    listCharacters(sql, {
      limit: perPage,
      offset,
      verseSlug: params.verseSlug,
      media: params.media,
    }),
    countCharacters(sql, { verseSlug: params.verseSlug, media: params.media }),
  ]);
  return { rows, total, source: 'database' };
}
