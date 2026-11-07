/**
 * Pencarian untuk SQLite/D1.
 *
 * Versi Postgres memakai FTS (`search_vector`), trigram (`%`), dan
 * `ts_rank_cd`; ketiganya tidak ada di D1. Penggantinya bukan LIKE polos:
 * peringkatnya tetap berlapis (exact → prefiks → alias → substring) supaya
 * urutan hasil mendekati RPC aslinya, dan `total` tetap dihitung dari seluruh
 * kandidat — bukan dari halaman — dengan alasan yang sama seperti di
 * `docs/schema.sql`.
 *
 * Normalisasi dilakukan di JavaScript dengan aturan yang sama seperti
 * `f_normalize_name`: NFKC → huruf kecil → buang tanda baca → rapatkan spasi.
 * Kolom `name_norm` di skema D1 hanya `lower(trim(...))`, jadi pencocokan
 * memakai nilai ternormalisasi dari aplikasi; itu cukup karena kolom yang
 * dibandingkan adalah nama pendek, bukan paragraf.
 */

import type { SqlClient } from '../../lib/db/client.ts';
import type { CharacterSearchHit, CharacterSearchPage, SearchCharacterPageParams } from './queries.ts';
import type { SearchType } from './search-params.ts';

/** Normalisasi yang sejajar `f_normalize_name` (tanpa unaccent — D1 tak punya). */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Potongan SQL yang dipakai bersama oleh pencarian dan halaman. */
const MATCHED_CTE = `
with needle as (
  select $1 as q
),
matched as (
  select 'character' as entity_type,
         c.id,
         c.slug,
         c.name,
         c.native_name,
         c.data_completeness,
         c.popularity_score,
         v.slug as verse_slug,
         v.name as verse_name,
         (case
            when c.name_norm = n.q then 1.0
            when c.native_norm = n.q then 0.95
            when exists (select 1 from character_aliases a
                          where a.character_id = c.id and a.alias_norm = n.q) then 0.9
            when c.name_norm like n.q || '%' then 0.85
            when c.native_norm like n.q || '%' then 0.8
            when exists (select 1 from character_aliases a
                          where a.character_id = c.id and a.alias_norm like n.q || '%') then 0.75
            else 0.5
          end) as match_score
    from characters c
    join verses v on v.id = c.verse_id
    cross join needle n
   where ($6 = 0 or c.verification_status in ('verified', 'imported', 'partially_verified'))
     and ($2 is null or v.slug = $2)
     and ($3 is null or c.media_type = $3)
     and exists (select 1 from json_each($7) where value = 'character')
     and (c.name_norm like '%' || n.q || '%'
       or c.native_norm like '%' || n.q || '%'
       or exists (select 1 from character_aliases a
                   where a.character_id = c.id and a.alias_norm like '%' || n.q || '%'))
  union all
  select 'verse',
         v.id,
         v.slug,
         v.name,
         null,
         v.data_completeness,
         v.popularity_score,
         v.slug,
         v.name,
         (case
            when lower(trim(v.name)) = n.q then 1.0
            when lower(trim(v.name)) like n.q || '%' then 0.85
            else 0.5
          end)
    from verses v
    cross join needle n
   where ($2 is null or v.slug = $2)
     and ($3 is null or v.origin_media = $3)
     and exists (select 1 from json_each($7) where value = 'verse')
     and lower(trim(v.name)) like '%' || n.q || '%'
)
`;

/**
 * Peringkat akhir: kecocokan teks (0..1) lalu popularitas sebagai penentu
 * kedua, sama seperti RPC yang memberi 5% bobot popularitas.
 */
const RANKED = `
select entity_type as type,
       id,
       slug,
       name,
       native_name,
       verse_slug,
       verse_name,
       data_completeness,
       popularity_score,
       (select t.tier_code
          from character_versions cv join tiers t on t.id = cv.tier_id
         where cv.character_id = m.id and cv.is_default = 1 and cv.deleted_at is null
         limit 1) as tier_code,
       (match_score * 0.95 + min(popularity_score, 1000) / 1000.0 * 0.05) as score
  from matched m
 order by score desc, popularity_score desc, name asc, entity_type, id
`;

/** Saran pencarian ringkas (autocomplete + `/api/search`). */
export async function searchCharactersSqlite(
  sql: SqlClient,
  query: string,
  limit: number,
): Promise<CharacterSearchHit[]> {
  const q = normalizeSearchText(query);
  if (q === '') return [];

  const rows = await sql.query<CharacterSearchHit & { type: string }>(
    `${MATCHED_CTE}${RANKED} limit $4 offset $5`,
    [q, null, null, limit, 0, 1, JSON.stringify(['character'])],
  );

  // Bentuk keluaran `search_characters` tidak punya `type`; buang agar kontrak
  // fungsi ini tetap sama dengan jalur Postgres.
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    verse_name: row.verse_name,
    tier_code: row.tier_code,
    score: Number(row.score),
  }));
}

/** Pencarian berhalaman dengan filter verse/media dan tipe entitas. */
export async function searchCharacterPageSqlite(
  sql: SqlClient,
  params: SearchCharacterPageParams,
  perPage: number,
  offset: number,
): Promise<CharacterSearchPage> {
  const q = normalizeSearchText(params.query);
  if (q === '') return { total: 0, rows: [] };

  const types: readonly SearchType[] =
    params.types && params.types.length > 0 ? params.types : ['character'];

  const rows = await sql.query<Record<string, unknown>>(
    `${MATCHED_CTE}${RANKED} limit $4 offset $5`,
    [q, params.verseSlug ?? null, params.media ?? null, perPage, offset, 1, JSON.stringify(types)],
  );

  // `total` dihitung terpisah dari seluruh kandidat, bukan dari halaman: halaman
  // yang melewati hasil terakhir tetap melaporkan total yang benar.
  const totals = await sql.query<{ total: number }>(
    `${MATCHED_CTE}select count(*) as total from matched`,
    [q, params.verseSlug ?? null, params.media ?? null, perPage, offset, 1, JSON.stringify(types)],
  );

  return {
    total: Number(totals[0]?.total ?? 0),
    rows: rows as unknown as CharacterSearchPage['rows'],
  };
}
