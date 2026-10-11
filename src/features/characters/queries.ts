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

/**
 * Kolom yang dibutuhkan kartu daftar. Sengaja bukan `*`: menambah kolom ke sini
 * harus keputusan sadar, karena setiap kolom ikut ke setiap render dan ke
 * payload cache.
 */
export const CHARACTER_LIST_COLUMNS = [
  'id',
  'slug',
  'name',
  'native_name',
  'image_url',
  'data_completeness',
  'popularity_score',
  'updated_at',
] as const;

export interface CharacterListItem {
  id: string;
  slug: string;
  name: string;
  native_name: string | null;
  image_url: string | null;
  data_completeness: 'complete' | 'partial' | 'minimal';
  popularity_score: number;
  updated_at: string;
  /**
   * Kode tier form default. Hanya diisi jalur demo saat ini; jalur database
   * menambahkannya bersama join tier ketika halaman daftar mengembalikan tier
   * (Sprint 1) — sengaja opsional supaya kedua sumber tetap cocok.
   */
  tier_code?: string | null;
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
    `select ${columns}
       from characters
      order by popularity_score desc, name asc
      limit $1 offset $2`,
    [limit, offset],
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
    `select * from public.search_characters($1, $2, true)`,
    [q, normalizePageSize(limit)],
  );
}

/** Satu baris hasil pencarian berhalaman (kolom eksplisit dari fungsi RPC). */
export interface CharacterSearchRow {
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
    `select public.search_characters_page($1, $2, $3, $4, $5, true) as payload`,
    [q, params.verseSlug ?? null, params.media ?? null, perPage, offset],
  );

  const payload = parseJsonPayload<{ total?: unknown; rows?: unknown }>(result[0]?.payload, {});
  const rows = Array.isArray(payload.rows) ? (payload.rows as CharacterSearchRow[]) : [];
  const total = Number(payload.total ?? rows.length);

  return { total: Number.isFinite(total) ? total : rows.length, rows };
}

export async function countCharacters(sql: SqlClient): Promise<number> {
  const rows = await sql.query<{ total: string }>(`select count(*)::text as total from characters`);
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
export async function loadCharacterList(
  params: ListCharactersParams & { query?: string } = {},
): Promise<CharacterListResult> {
  if (demoEnabled() && !isDatabaseConfigured()) {
    const rows = demoCharacterListItems(params.query);
    return { rows, total: rows.length, source: 'demo' };
  }

  const sql = getSqlClient();
  const [rows, total] = await Promise.all([
    listCharacters(sql, { limit: params.limit, offset: params.offset }),
    countCharacters(sql),
  ]);
  return { rows, total, source: 'database' };
}
