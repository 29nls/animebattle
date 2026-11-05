-- 0009 — Selaraskan index pencarian dengan baseline docs/schema.sql.
--
-- 0004 membuat ketiga index prefix tanpa INCLUDE dan tidak pernah membuat
-- index ekspresi untuk materialized view. Karena 0001 sudah membuat index
-- dengan nama sama, `create index if not exists` di 0004 tidak pernah
-- menggantinya. Akibatnya database hasil migrasi berbeda dari baseline dan
-- job CI `database` (check:schema-drift) gagal.
--
-- Runner migrasi membungkus tiap berkas dalam transaksi, jadi
-- `create index concurrently` tidak dapat dipakai di sini. Dataset saat ini
-- puluhan ribu baris; penguncian tulis singkat ini disengaja dan harus
-- dievaluasi ulang sebelum katalog membesar.

drop index if exists animebattle.idx_characters_name_norm;
create index idx_characters_name_norm
  on animebattle.characters (name_norm text_pattern_ops) include (id);

drop index if exists animebattle.idx_characters_native_norm;
create index idx_characters_native_norm
  on animebattle.characters (native_norm text_pattern_ops) include (id);

drop index if exists animebattle.idx_aliases_norm;
create index idx_aliases_norm
  on animebattle.character_aliases (alias_norm text_pattern_ops) include (character_id);

create index if not exists idx_mv_character_search_norm
  on animebattle.mv_character_search (animebattle.f_normalize_name(name) text_pattern_ops);
