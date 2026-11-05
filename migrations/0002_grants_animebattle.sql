-- Grants & revokes untuk schema animebattle (dipisah dari DDL agar urutan
-- terlihat jelas dan dapat diaudit sendiri). Dijalankan setelah 0001.
set search_path = animebattle, public;

-- ============================================================================
-- 18. Isolasi & hak akses schema
-- ============================================================================
-- RLS menentukan BARIS; grant menentukan apakah role boleh menyentuh objeknya
-- sama sekali. Keduanya diperlukan: RLS tanpa grant = permission denied, grant
-- tanpa RLS = seluruh baris terbaca.
grant usage on schema animebattle to anon, authenticated;

-- authenticated: akses SQL-level ke seluruh tabel aplikasi; policy RLS per
-- tabel yang memutuskan baris mana yang boleh dibaca/ditulis. Tanpa grant ini,
-- policy admin/curator tidak pernah tercapai. Daftar eksplisit (bukan
-- "all tables") supaya schema_migrations tidak ikut terbuka.
do $$
declare
  t text;
  app_tables text[] := array[
    'sources','stat_scale_metrics','stat_scales','tiers','verses','characters',
    'character_aliases','character_versions','character_traits','equipment',
    'statistics','ability_categories','abilities','character_abilities',
    'resistance_types','character_resistances','hax_interactions','feats',
    'character_sources','character_source_conflicts','merge_candidates',
    'slug_redirects','ingestion_jobs','ingestion_errors','ingestion_raw_pages',
    'source_snapshots','battle_rule_sets','battle_conditions','battles',
    'battle_results','battle_narratives','users','user_roles','favorites',
    'analytics_events','audit_logs','data_reports'
  ];
begin
  foreach t in array app_tables loop
    execute format('grant select, insert, update, delete on table animebattle.%I to authenticated', t);
  end loop;
end $$;

-- anon: hanya data publik (daftar yang sama dengan policy SELECT di bagian 16)
-- dan dua tabel yang memang menerima insert anonim.
grant select on table
  animebattle.verses, animebattle.characters, animebattle.character_aliases,
  animebattle.character_versions, animebattle.character_traits, animebattle.equipment,
  animebattle.statistics, animebattle.ability_categories, animebattle.abilities,
  animebattle.character_abilities, animebattle.resistance_types,
  animebattle.character_resistances, animebattle.hax_interactions, animebattle.feats,
  animebattle.tiers, animebattle.stat_scales, animebattle.stat_scale_metrics,
  animebattle.slug_redirects, animebattle.battles, animebattle.battle_results,
  animebattle.battle_conditions, animebattle.battle_rule_sets,
  animebattle.battle_narratives
  to anon;
grant insert on table animebattle.analytics_events, animebattle.data_reports to anon;
grant select on table
  animebattle.mv_battle_popularity, animebattle.mv_verse_tier_distribution,
  animebattle.mv_character_search
  to anon, authenticated;

-- Fungsi: cabut EXECUTE default PUBLIC (Postgres memberikannya ke semua role),
-- lalu berikan hanya RPC baca yang memang publik. Fungsi pemeliharaan
-- (purge/recompute/reconcile/refresh) sengaja TIDAK diberikan ke anon/authenticated.
revoke execute on all functions in schema animebattle from public;
grant execute on function animebattle.f_unaccent(text) to anon, authenticated;
grant execute on function animebattle.f_normalize_name(text) to anon, authenticated;
grant execute on function animebattle.rule_set_weight_sum(jsonb) to anon, authenticated;
grant execute on function animebattle.search_characters(text, integer, boolean) to anon, authenticated;
grant execute on function animebattle.search_characters_page(text, text, text, integer, integer, boolean) to anon, authenticated;
grant execute on function animebattle.battle_dataset(uuid[]) to anon, authenticated;
grant execute on function animebattle.battle_cache_get(text) to anon, authenticated;
grant execute on function animebattle.is_admin() to authenticated;
grant execute on function animebattle.is_curator() to authenticated;
