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

import type { SqlClient } from '../../lib/db/client.ts';

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

export async function countCharacters(sql: SqlClient): Promise<number> {
  const rows = await sql.query<{ total: string }>(`select count(*)::text as total from characters`);
  return Number(rows[0]?.total ?? '0');
}
