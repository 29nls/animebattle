-- 0004 — Performa pencarian: kolom ternormalisasi tersimpan + cabang
-- index-usable + kandidat terbatas + types.
--
-- Baseline Postgres 16.15 (10.000 baris sintetis, ANALYZE setelah seed):
-- selektif p50 2.293,9 ms / p95 2.371,5 ms; luas 2.418,1 / 2.568,7;
-- prefiks "go" 2.081,6 / 2.285,5; prefiks "be" 3.936,6 / 4.177,0.
--
-- Penyebab utama bukan sekadar OR gabungan: f_normalize_name() dipanggil ulang
-- untuk setiap baris yang lolos index (recheck), ~1,4 detik untuk satu kueri
-- luas. Kolom generated stored membayar normalisasi sekali saat tulis.
--
-- Jalankan di luar transaksi panjang; CREATE INDEX mengunci tulis singkat.

alter table characters
  add column if not exists name_norm text
    generated always as (animebattle.f_normalize_name(name)) stored;
alter table characters
  add column if not exists native_norm text
    generated always as (animebattle.f_normalize_name(coalesce(native_name, ''))) stored;

-- Index native lama meng-index coalesce(native_name, '') mentah, bukan bentuk
-- ternormalisasi, sehingga cabang trigram native tidak pernah memakainya.
drop index if exists idx_characters_name_trgm;
drop index if exists idx_characters_native_trgm;
create index idx_characters_name_trgm on characters using gin (name_norm gin_trgm_ops);
create index idx_characters_native_trgm on characters using gin (native_norm gin_trgm_ops);
create index if not exists idx_characters_name_norm on characters (name_norm text_pattern_ops);
create index if not exists idx_characters_native_norm on characters (native_norm text_pattern_ops);
create index if not exists idx_aliases_norm on character_aliases (alias_norm text_pattern_ops);

-- Ganti signature 6-arg dengan 7-arg (types). Grant lama ikut hilang bersama
-- fungsi lama; grant baru diberikan di akhir berkas.
drop function if exists search_characters_page(text, text, text, integer, integer, boolean);

create or replace function search_characters_page(
  q text,
  verse_slug text default null,
  media text default null,
  lim integer default 20,
  off integer default 0,
  only_public boolean default true,
  types text[] default array['character']::text[]
)
returns jsonb
language sql
stable
set search_path = animebattle, public
as $$
  with needle as (
    -- Normalisasi yang sama dengan kolom yang dibandingkan (lihat
    -- f_normalize_name). Kueri kosong tidak masuk ke cabang prefiks, yang
    -- tanpa penjaga ini akan cocok dengan seluruh katalog.
    select animebattle.f_normalize_name(coalesce(q, '')) as raw,
           plainto_tsquery('simple', animebattle.f_unaccent(coalesce(q, ''))) as ts
     where animebattle.f_normalize_name(coalesce(q, '')) <> ''
  ),
  wanted as (
    select coalesce(types, array['character']::text[]) as kinds
  ),
  -- Cabang dipisah supaya masing-masing dapat memakai index-nya sendiri:
  -- btree ternormalisasi untuk exact/prefix, GIN trigram untuk typo, dan GIN
  -- search_vector untuk FTS. Satu OR gabungan membuat planner memilih scan
  -- seluruh tabel lalu menghitung similarity untuk setiap baris.
  character_matches as (
    select c.id, 3 as match_kind
      from characters c cross join needle n cross join wanted w
     where 'character' = any(w.kinds)
       and c.name_norm = n.raw
    union all
    select c.id, 3
      from characters c cross join needle n cross join wanted w
     where 'character' = any(w.kinds)
       and c.native_norm = n.raw
    union all
    select a.character_id, 3
      from character_aliases a cross join needle n cross join wanted w
     where 'character' = any(w.kinds)
       and a.alias_norm = n.raw
    union all
    select c.id, 2
      from characters c cross join needle n cross join wanted w
     where 'character' = any(w.kinds)
       and c.name_norm like n.raw || '%'
    union all
    select c.id, 2
      from characters c cross join needle n cross join wanted w
     where 'character' = any(w.kinds)
       and c.native_norm like n.raw || '%'
    union all
    select a.character_id, 2
      from character_aliases a cross join needle n cross join wanted w
     where 'character' = any(w.kinds)
       and a.alias_norm like n.raw || '%'
    union all
    select c.id, 1
      from characters c cross join needle n cross join wanted w
     where 'character' = any(w.kinds)
       and char_length(n.raw) >= 3
       and c.name_norm % n.raw
    union all
    select c.id, 1
      from characters c cross join needle n cross join wanted w
     where 'character' = any(w.kinds)
       and char_length(n.raw) >= 3
       and c.native_norm % n.raw
    union all
    select a.character_id, 1
      from character_aliases a cross join needle n cross join wanted w
     where 'character' = any(w.kinds)
       and char_length(n.raw) >= 3
       and a.alias_norm % n.raw
    union all
    select c.id, 1
      from characters c cross join needle n cross join wanted w
     where 'character' = any(w.kinds)
       and c.search_vector @@ n.ts
  ),
  character_ids as (
    select id, max(match_kind) as match_kind
      from character_matches
     group by id
  ),
  -- `verses` sengaja tetap memakai fungsi, bukan kolom tersimpan: tabelnya
  -- puluhan baris, jadi biaya normalisasi per baris tidak terukur. Kolom
  -- tersimpan hanya dibayar di `characters`, tempat 10.000 baris membuat
  -- evaluasi ulang menjadi 1,4 detik.
  verse_matches as (
    select v.id, 3 as match_kind
      from verses v cross join needle n cross join wanted w
     where 'verse' = any(w.kinds)
       and animebattle.f_normalize_name(v.name) = n.raw
    union all
    select v.id, 2
      from verses v cross join needle n cross join wanted w
     where 'verse' = any(w.kinds)
       and animebattle.f_normalize_name(v.name) like n.raw || '%'
    union all
    select v.id, 1
      from verses v cross join needle n cross join wanted w
     where 'verse' = any(w.kinds)
       and char_length(n.raw) >= 3
       and animebattle.f_normalize_name(v.name) % n.raw
  ),
  verse_ids as (
    select id, max(match_kind) as match_kind
      from verse_matches
     group by id
  ),
  character_rows as (
    select 'character'::text as entity_type,
           ci.id,
           ci.match_kind,
           c.slug,
           c.name,
           c.name_norm,
           c.native_name,
           c.data_completeness,
           c.popularity_score,
           c.search_vector,
           v.slug as verse_slug,
           v.name as verse_name
      from character_ids ci
      join characters c on c.id = ci.id
      join verses v on v.id = c.verse_id
     where (not only_public or c.verification_status in ('verified', 'imported', 'partially_verified'))
       and (verse_slug is null or v.slug = verse_slug)
       and (media is null or c.media_type::text = media)
  ),
  verse_rows as (
    select 'verse',
           vi.id,
           vi.match_kind,
           v.slug,
           v.name,
           animebattle.f_normalize_name(v.name),
           null::text,
           v.data_completeness,
           v.popularity_score,
           null::tsvector,
           v.slug,
           v.name
      from verse_ids vi
      join verses v on v.id = vi.id
     where (verse_slug is null or v.slug = verse_slug)
       and (media is null or v.origin_media::text = media)
  ),
  candidates as (
    select * from character_rows
    union all
    select * from verse_rows
  ),
  -- Batasi kandidat SEBELUM menghitung skor. 500 cukup untuk halaman normal;
  -- halaman yang lebih dalam menaikkan batas ini agar offset tidak kehilangan
  -- baris, dan total tetap dihitung dari seluruh kandidat (bukan dari halaman).
  candidate_ids as (
    select *
      from candidates
     order by match_kind desc, popularity_score desc, name asc, entity_type, id
     limit greatest(coalesce(off, 0) + least(coalesce(lim, 20), 200) + 480, 500)
  ),
  ranked as (
    select cd.*,
           (
             case when cd.entity_type = 'character' then
               0.60 * ts_rank_cd(cd.search_vector, n.ts)
             + 0.25 * greatest(
                 similarity(cd.name_norm, n.raw),
                 coalesce((select max(similarity(a.alias_norm, n.raw))
                             from character_aliases a where a.character_id = cd.id), 0))
             + 0.10 * (case when cd.name_norm like n.raw || '%' then 1 else 0 end)
             else
               0.60 * (case when cd.name_norm = n.raw then 1 else 0 end)
             + 0.25 * similarity(cd.name_norm, n.raw)
             + 0.10 * (case when cd.name_norm like n.raw || '%' then 1 else 0 end)
             end
           + 0.05 * least(cd.popularity_score::real / 1000.0, 1.0)
           )::real as score
      from candidate_ids cd cross join needle n
  ),
  page as (
    select * from ranked
     order by score desc, popularity_score desc, name asc, entity_type, id
     limit least(coalesce(lim, 20), 200)
    offset greatest(coalesce(off, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from candidates),
    'rows', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'type', p.entity_type,
                 'id', p.id,
                 'slug', p.slug,
                 'name', p.name,
                 'native_name', p.native_name,
                 'verse_slug', p.verse_slug,
                 'verse_name', p.verse_name,
                 'tier_code', case when p.entity_type = 'character' then (
                    select t.tier_code
                      from character_versions cv join tiers t on t.id = cv.tier_id
                     where cv.character_id = p.id and cv.is_default and cv.deleted_at is null
                     limit 1
                 ) else null end,
                 'data_completeness', p.data_completeness,
                 'popularity_score', p.popularity_score,
                 'score', p.score
               )
               order by p.score desc, p.popularity_score desc, p.name asc, p.entity_type, p.id
             )
        from page p
      ), '[]'::jsonb)
  )
$$;

grant execute on function search_characters_page(text, text, text, integer, integer, boolean, text[]) to anon, authenticated;
