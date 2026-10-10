/**
 * Query halaman verse. Pola yang sama dengan `features/characters/queries.ts`:
 * satu modul yang mengekspor query terparameterisasi, tidak ada SQL langsung
 * di komponen (PRD §39).
 */

import { demoEnabled, demoVerseDetail, demoVerseListItems } from '../demo/provider.ts';
import { getSqlClient, isDatabaseConfigured, type SqlClient } from '../../lib/db/client.ts';

export interface VerseListItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  character_count: number;
  media_type: string;
  updated_at: string;
}

/**
 * Nama kolom di `verses` berbeda dari nama view-model halaman; pemetaannya
 * dilakukan di sini, bukan dengan mengubah DDL:
 *
 *   * `origin_media` → `media_type` (nama yang sudah dipakai halaman dan dataset demo).
 *   * Jumlah karakter tidak didenormalisasi di `verses`, jadi dihitung dari
 *     `characters.verse_id` (index `idx_characters_verse` sudah ada). Kolom ini
 *     juga dipakai untuk pengurutan, sehingga angka di UI tidak dapat menyimpang
 *     dari baris yang benar-benar ada.
 *   * `verses` **tidak punya kolom gambar**; gantinya tiap kartu memakai ikon.
 *     Sebelumnya query meminta `v.image_url`/`v.media_type`/`v.character_count`
 *     yang tidak ada di `docs/schema.sql` — tidak terlihat selama database belum
 *     dapat dihubungi, dan langsung menjadi galat pertama begitu terhubung.
 */

export async function listVerses(
  sql: SqlClient,
  params: { limit?: number; offset?: number } = {},
): Promise<VerseListItem[]> {
  const limit = Math.min(Math.max(1, params.limit ?? 50), 200);
  const offset = Math.max(0, params.offset ?? 0);

  return sql.query<VerseListItem>(
    `select v.id, v.slug, v.name, v.description,
            (select count(*) from characters c where c.verse_id = v.id)::int as character_count,
            v.origin_media as media_type, v.updated_at
       from verses v
      order by character_count desc, v.name asc
      limit $1 offset $2`,
    [limit, offset],
  );
}

export async function countVerses(sql: SqlClient): Promise<number> {
  const rows = await sql.query<{ total: string }>(`select count(*)::text as total from verses`);
  return Number(rows[0]?.total ?? '0');
}

export interface VerseDetail {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  media_type: string;
  character_count: number;
  updated_at: string;
}

export async function getVerseBySlug(sql: SqlClient, slug: string): Promise<VerseDetail | null> {
  const rows = await sql.query<VerseDetail>(
    `select v.id, v.slug, v.name, v.description,
            v.origin_media as media_type,
            (select count(*) from characters c where c.verse_id = v.id)::int as character_count,
            v.updated_at
       from verses v
      where v.slug = $1
      limit 1`,
    [slug],
  );
  return rows[0] ?? null;
}

export interface VerseCharacterItem {
  id: string;
  slug: string;
  name: string;
  native_name: string | null;
  image_url: string | null;
  tier_code: string | null;
  popularity_score: number;
}

export async function listVerseCharacters(
  sql: SqlClient,
  verseId: string,
  params: { limit?: number; offset?: number } = {},
): Promise<VerseCharacterItem[]> {
  const limit = Math.min(Math.max(1, params.limit ?? 20), 200);
  const offset = Math.max(0, params.offset ?? 0);

  return sql.query<VerseCharacterItem>(
    `select c.id, c.slug, c.name, c.native_name, c.image_url,
            t.tier_code, c.popularity_score
       from characters c
       left join character_versions cv on cv.character_id = c.id and cv.is_default = true
       left join tiers t on t.id = cv.tier_id
      where c.verse_id = $1
      order by c.popularity_score desc, c.name asc
      limit $2 offset $3`,
    [verseId, limit, offset],
  );
}

/** Dari mana baris berasal — halaman menampilkan penanda bila `demo`. */
export type DataSource = 'database' | 'demo';

/** Sumber data daftar verse: database dulu, demo hanya bila belum dikonfigurasi. */
export async function loadVerseList(): Promise<{ rows: VerseListItem[]; source: DataSource }> {
  if (demoEnabled() && !isDatabaseConfigured()) {
    return { rows: demoVerseListItems(), source: 'demo' };
  }

  const sql = getSqlClient();
  return { rows: await listVerses(sql), source: 'database' };
}

export interface VerseDetailBundle {
  verse: VerseDetail;
  characters: VerseCharacterItem[];
  source: DataSource;
}

/** Sumber data detail verse. Prioritas sama: database dulu, demo bila tidak ada. */
export async function loadVerseDetail(slug: string): Promise<VerseDetailBundle | null> {
  if (demoEnabled() && !isDatabaseConfigured()) {
    const demo = demoVerseDetail(slug);
    return demo ? { ...demo, source: 'demo' } : null;
  }

  const sql = getSqlClient();
  const verse = await getVerseBySlug(sql, slug);
  if (!verse) return null;

  const characters = await listVerseCharacters(sql, verse.id, { limit: 50 });
  return { verse, characters, source: 'database' };
}
