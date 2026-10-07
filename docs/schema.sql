-- ============================================================================
-- Anime VS Battle — PostgreSQL schema
-- Target: PostgreSQL 15+ (Supabase). Idempotent-ish: jalankan di DB kosong.
-- Dokumen terkait: docs/PRD.md (§22, §37), docs/APPENDICES.md (H), docs/seed.sql
--
-- Konvensi:
--   * id          : uuid (gen_random_uuid(), core PG13+)
--   * created_at  : timestamptz default now()
--   * updated_at  : timestamptz, dikelola trigger set_updated_at()
--   * ON DELETE   : selalu eksplisit (RESTRICT untuk data rujukan, CASCADE untuk data turunan)
--   * Setiap tabel fakta WAJIB punya source_id (ditegakkan guard_fact_source)
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Ekstensi
-- ---------------------------------------------------------------------------
-- pg_trgm  : fuzzy / typo-tolerant search ("gokou" -> "goku")
-- unaccent : normalisasi diakritik ("Béatrice" -> "Beatrice")
-- pgcrypto : digest() untuk fingerprint duplikat & hash IP
create extension if not exists pg_trgm;
create extension if not exists unaccent;
create extension if not exists pgcrypto;

-- Kompatibilitas untuk Postgres non-Supabase (mis. verifikasi lokal / CI kontainer).
-- Pada Supabase, schema `auth` dan role `anon`/`authenticated` sudah ada sehingga
-- blok ini tidak melakukan apa pun.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    create schema auth;
    -- Stub: pada Supabase fungsi ini membaca klaim JWT.
    create function auth.uid() returns uuid language sql stable as $fn$ select null::uuid $fn$;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Fungsi helper
-- ---------------------------------------------------------------------------

-- Total bobot rule set. Dipakai CHECK constraint pada battle_rule_sets,
-- sehingga HARUS didefinisikan sebelum tabel itu dibuat.
-- Mengembalikan -1 bila bentuknya tidak valid (bukan objek / ada nilai non-numerik),
-- agar pelanggaran bobot muncul sebagai constraint violation yang jelas (BC-4).
create or replace function public.rule_set_weight_sum(w jsonb)
returns integer
language sql
immutable
parallel safe
as $$
  select case
    when w is null or jsonb_typeof(w) <> 'object' then -1
    when exists (
      select 1 from jsonb_each(w) as e(k, v)
       where jsonb_typeof(e.v) <> 'number'
    ) then -1
    else coalesce((select sum((e.v)::text::numeric)::integer
                     from jsonb_each(w) as e(k, v)), -1)
  end
$$;

-- unaccent() adalah STABLE, sehingga tidak dapat dipakai di expression index
-- atau generated column. Wrapper ini menandainya IMMUTABLE.
-- RISIKO: dictionary unaccent harus stabil. Karena itu dilarang mengubah
-- isi file unaccent.rules pada instance produksi tanpa REINDEX.
create or replace function public.f_unaccent(txt text)
returns text
language sql
immutable
parallel safe
strict
as $$ select public.unaccent('public.unaccent'::regdictionary, txt) $$;

-- Normalisasi nama untuk fingerprint & pencarian:
-- NFKC -> lowercase -> hapus tanda baca -> collapse spasi
create or replace function public.f_normalize_name(txt text)
returns text
language sql
immutable
parallel safe
as $$
  select trim(regexp_replace(
           regexp_replace(
             lower(public.f_unaccent(coalesce(txt, ''))),
             '[^[:alnum:][:space:]]', '', 'g'),
           '\s+', ' ', 'g'))
$$;

-- updated_at otomatis
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- CATATAN: is_admin()/is_curator() didefinisikan di bagian 12, setelah tabel
-- user_roles ada — fungsi SQL divalidasi saat dibuat, sehingga tidak boleh
-- didefinisikan sebelum tabel yang dirujuknya.

-- ---------------------------------------------------------------------------
-- 2. Enum types
-- ---------------------------------------------------------------------------
create type source_type_t        as enum ('wiki', 'api', 'dataset', 'manual_url', 'official');
create type legal_status_t       as enum ('allowed', 'restricted', 'disabled');
create type verification_t       as enum ('verified', 'imported', 'partially_verified', 'conflicting', 'unknown');
create type completeness_t       as enum ('complete', 'partial', 'minimal');
create type alias_script_t       as enum ('latin', 'kanji', 'kana', 'hangul', 'cyrillic', 'other');
create type media_type_t         as enum ('manga', 'anime', 'game', 'novel', 'comic', 'movie', 'mixed', 'other');
create type tier_band_t          as enum ('low', 'mid', 'high', 'peak', 'none');

create type stat_metric_t        as enum (
  'tier', 'attack_potency', 'durability', 'striking_strength', 'lifting_strength',
  'speed', 'reaction_speed', 'combat_speed', 'range', 'stamina',
  'intelligence', 'battle_iq', 'experience'
);
create type qualifier_t          as enum (
  'exact', 'at_least', 'at_most', 'possibly', 'likely', 'up_to',
  'higher_with', 'far_higher_with', 'varies', 'unknown'
);
create type stat_status_t        as enum ('current', 'superseded', 'conflicting');

create type proficiency_t        as enum ('novice', 'intermediate', 'advanced', 'master', 'godlike');
create type activation_speed_t   as enum ('instant', 'fast', 'moderate', 'slow', 'triggered');

create type resistance_level_t   as enum ('none', 'limited', 'moderate', 'high', 'absolute');
create type hax_relation_t       as enum ('effective', 'reduced', 'blocked', 'negated', 'bypasses');

create type feasibility_t        as enum ('minor', 'supportive', 'major', 'decisive');
create type source_role_t        as enum ('identity', 'stats', 'abilities', 'resistances', 'feats', 'image');
create type conflict_status_t    as enum ('open', 'resolved', 'ignored');
create type merge_status_t       as enum ('pending', 'merged', 'rejected');
create type char_trait_t         as enum ('aggressive', 'holds_back', 'tactical', 'reckless', 'talkative', 'measured');

create type job_scope_t          as enum ('incremental', 'scheduled_full', 'manual_run', 'single_character',
                                          'single_verse', 'reparse', 'import_url', 'import_dataset');
create type job_status_t         as enum ('pending', 'processing', 'completed', 'partial', 'failed', 'skipped');
create type ingest_error_t       as enum ('ParserError', 'SourceUnavailable', 'RateLimited', 'InvalidData',
                                          'DuplicateCharacter', 'MissingRequiredField', 'ImageUnavailable',
                                          'PolicyBlocked');

create type battle_mode_t        as enum ('standard', 'equal_speed', 'in_character', 'bloodlusted', 'random_encounter');
create type knowledge_t          as enum ('none', 'partial', 'full');
create type prep_time_t          as enum ('none', 'short', 'extended');
create type win_condition_t      as enum ('ko', 'death', 'incapacitation', 'bfr', 'submission', 'any');
create type winner_t             as enum ('a', 'b', 'draw', 'insufficient_data');
create type difficulty_t         as enum ('low', 'mid', 'high', 'extreme');
create type battle_length_t      as enum ('short', 'medium', 'long');

create type user_role_t          as enum ('viewer', 'curator', 'admin', 'owner');
create type report_status_t      as enum ('new', 'reviewing', 'accepted', 'rejected');

-- ---------------------------------------------------------------------------
-- 3. Registry sumber & konfigurasi
-- ---------------------------------------------------------------------------

-- Registry sumber. Job ingestion HANYA boleh berjalan untuk legal_status='allowed'.
create table sources (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique,
  name                  text not null,
  base_url              text not null,
  source_type           source_type_t not null,
  priority              smallint not null default 4 check (priority between 1 and 5),
  legal_status          legal_status_t not null default 'restricted',
  legal_reviewed_by     text,
  legal_reviewed_at     timestamptz,
  legal_notes           text,
  respect_robots        boolean not null default true,
  rate_limit_rps        numeric(5,2) not null default 1.0 check (rate_limit_rps > 0),
  concurrency_limit     smallint not null default 2 check (concurrency_limit between 1 and 8),
  max_fetches_per_day   integer not null default 2000 check (max_fetches_per_day > 0),
  license               text,                      -- wajib secara praktik (LP-6), lihat trigger
  license_url           text,
  attribution_text      text,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- Sumber yang aktif wajib sudah melalui review legal
  constraint sources_active_requires_review
    check (not is_active or (legal_reviewed_at is not null)),
  constraint sources_allowed_requires_license
    check (legal_status <> 'allowed' or license is not null)
);
create index idx_sources_legal on sources (legal_status) where is_active;

create trigger trg_sources_updated before update on sources
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Ladder nilai: metrik, skala, tier
-- ---------------------------------------------------------------------------

create table stat_scale_metrics (
  id                 uuid primary key default gen_random_uuid(),
  metric             stat_metric_t not null unique,
  label              text not null,
  unit               text not null,                 -- 'log10_joule' | 'log10_m_s' | 'ordinal' | ...
  higher_is_better   boolean not null default true,
  normalization_span numeric(6,2) not null check (normalization_span > 0), -- N_i di §17.1
  description        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger trg_ssm_updated before update on stat_scale_metrics
  for each row execute function public.set_updated_at();

-- Skala ordinal per metrik. rank = urutan komparatif; log_value = kuantifikasi bila
-- dapat dinyatakan (mis. log10 joule untuk AP). is_physical=false menandai rezim
-- non-fisik (FTL, outerversal) agar engine tidak berpura-pura membandingkan satuan.
create table stat_scales (
  id            uuid primary key default gen_random_uuid(),
  metric_id     uuid not null references stat_scale_metrics(id) on delete restrict,
  scale_code    text not null,
  label         text not null,
  rank          smallint not null check (rank > 0),
  log_value     numeric(8,3),
  band          tier_band_t not null default 'none',
  is_rankable   boolean not null default true,
  is_physical   boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (metric_id, scale_code),
  unique (metric_id, rank),
  constraint stat_scales_rankable_needs_value
    check (not is_rankable or log_value is not null or not is_physical)
);
create index idx_stat_scales_metric_rank on stat_scales (metric_id, rank);
create trigger trg_stat_scales_updated before update on stat_scales
  for each row execute function public.set_updated_at();

-- Tier ladder. Seluruhnya data sehingga dapat diubah admin tanpa deploy (§12).
create table tiers (
  id              uuid primary key default gen_random_uuid(),
  tier_code       text not null unique,
  tier_name       text not null,
  band            tier_band_t not null,
  display_order   smallint not null,
  numerical_rank  smallint unique,               -- NULL untuk tier non-rankable
  parent_tier_id  uuid references tiers(id) on delete set null,
  is_rankable     boolean not null default true,
  description     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (display_order),
  constraint tiers_rankable_requires_rank
    check (is_rankable = (numerical_rank is not null))
);
create trigger trg_tiers_updated before update on tiers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Domain: verse, karakter, form
-- ---------------------------------------------------------------------------

create table verses (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  name             text not null,
  description      text,
  origin_media     media_type_t not null default 'other',
  popularity_score integer not null default 0,
  data_completeness completeness_t not null default 'minimal',
  source_id        uuid references sources(id) on delete restrict,
  source_url       text,
  imported_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index idx_verses_popularity on verses (popularity_score desc);
create index idx_verses_media on verses (origin_media);
create trigger trg_verses_updated before update on verses
  for each row execute function public.set_updated_at();

create table characters (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique,
  name                  text not null,
  native_name           text,
  description           text,
  origin                text,
  verse_id              uuid not null references verses(id) on delete restrict,
  gender                text,
  age                   text,
  classification        text,
  media_type            media_type_t not null default 'other',
  -- Artwork WAJIB punya lisensi + atribusi bila diisi (LP-1)
  image_url             text,
  image_source          text,
  image_license         text,
  image_attribution     text,
  image_license_url     text,
  popularity_score      integer not null default 0,
  data_completeness     completeness_t not null default 'minimal',
  verification_status   verification_t not null default 'unknown',
  source_id             uuid references sources(id) on delete restrict,
  source_url            text,
  source_name           text,
  source_last_updated   timestamptz,
  imported_at           timestamptz,
  fp_key                text,                       -- fingerprint duplikat (§21.2)
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- Artwork tanpa lisensi tidak boleh tayang
  constraint characters_image_requires_license
    check (image_url is null or (image_license is not null and image_source is not null))
);
create index idx_characters_verse on characters (verse_id);
create index idx_characters_name_trgm on characters using gin (public.f_normalize_name(name) gin_trgm_ops);
create index idx_characters_native_trgm on characters using gin (coalesce(native_name, '') gin_trgm_ops);
create index idx_characters_fp on characters (fp_key) where fp_key is not null;
create index idx_characters_popularity on characters (popularity_score desc);
create index idx_characters_updated on characters (updated_at desc);
create index idx_characters_imported on characters (imported_at desc nulls last);
create index idx_characters_completeness on characters (data_completeness);
create trigger trg_characters_updated before update on characters
  for each row execute function public.set_updated_at();

create table character_aliases (
  id            uuid primary key default gen_random_uuid(),
  character_id  uuid not null references characters(id) on delete cascade,
  alias         text not null,
  alias_norm    text generated always as (public.f_normalize_name(alias)) stored,
  script        alias_script_t not null default 'latin',
  is_primary    boolean not null default false,
  source_id     uuid references sources(id) on delete restrict,
  created_at    timestamptz not null default now(),
  unique (character_id, alias)
);
create index idx_aliases_trgm on character_aliases using gin (alias gin_trgm_ops);
create index idx_aliases_trgm_norm on character_aliases using gin (alias_norm gin_trgm_ops);
create index idx_aliases_character on character_aliases (character_id);
create index idx_aliases_script on character_aliases (script);

-- Kolom *_scale_id di sini adalah CACHE dari `statistics` (status='current'),
-- dikelola trigger. Alasan: halaman daftar/filter/sort tidak boleh melakukan
-- 12 join. Sumber kebenaran tetap `statistics` (lihat sync_version_stat_cache).
create table character_versions (
  id                        uuid primary key default gen_random_uuid(),
  character_id              uuid not null references characters(id) on delete cascade,
  slug                      text not null,
  name                      text not null,
  description               text,
  era                       text,
  age_range                 text,
  form_order                smallint not null default 0,
  is_default                boolean not null default false,
  is_variant                boolean not null default false,
  variant_of                uuid references character_versions(id) on delete set null,
  media_type                media_type_t not null default 'other',
  tier_id                   uuid references tiers(id) on delete restrict,
  attack_potency_scale_id   uuid references stat_scales(id) on delete set null,
  durability_scale_id       uuid references stat_scales(id) on delete set null,
  striking_scale_id         uuid references stat_scales(id) on delete set null,
  lifting_scale_id          uuid references stat_scales(id) on delete set null,
  speed_scale_id            uuid references stat_scales(id) on delete set null,
  reaction_speed_scale_id   uuid references stat_scales(id) on delete set null,
  combat_speed_scale_id     uuid references stat_scales(id) on delete set null,
  range_scale_id            uuid references stat_scales(id) on delete set null,
  stamina_scale_id          uuid references stat_scales(id) on delete set null,
  intelligence_scale_id     uuid references stat_scales(id) on delete set null,
  battle_iq_scale_id        uuid references stat_scales(id) on delete set null,
  experience_years          numeric(6,1),
  data_completeness         completeness_t not null default 'minimal',
  verification_status       verification_t not null default 'unknown',
  deleted_at                timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (character_id, slug)
);
-- FR-1: tepat satu form default aktif per karakter
create unique index idx_versions_single_default
  on character_versions (character_id)
  where is_default and deleted_at is null;
create index idx_versions_character on character_versions (character_id, form_order);
create index idx_versions_tier on character_versions (tier_id);
create index idx_versions_speed on character_versions (speed_scale_id);
create index idx_versions_ap on character_versions (attack_potency_scale_id);
create index idx_versions_range on character_versions (range_scale_id);
create index idx_versions_completeness on character_versions (data_completeness);
create index idx_versions_variant on character_versions (variant_of) where variant_of is not null;
create index idx_versions_updated on character_versions (updated_at desc);
create trigger trg_versions_updated before update on character_versions
  for each row execute function public.set_updated_at();

-- Atribut perilaku karakter; dipakai mode `in_character` (§16.4)
create table character_traits (
  id                   uuid primary key default gen_random_uuid(),
  character_version_id uuid not null references character_versions(id) on delete cascade,
  trait                char_trait_t not null,
  notes                text,
  source_id            uuid not null references sources(id) on delete restrict,
  created_at           timestamptz not null default now(),
  unique (character_version_id, trait)
);
create index idx_traits_version on character_traits (character_version_id);

create table equipment (
  id                   uuid primary key default gen_random_uuid(),
  character_version_id uuid not null references character_versions(id) on delete cascade,
  name                 text not null,
  description          text,
  grants_ability_id    uuid,        -- FK ditambahkan setelah tabel abilities dibuat
  source_id            uuid not null references sources(id) on delete restrict,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index idx_equipment_version on equipment (character_version_id);
create trigger trg_equipment_updated before update on equipment
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Statistik (kebenaran per sumber, multi-baris)
-- ---------------------------------------------------------------------------

create table statistics (
  id                   uuid primary key default gen_random_uuid(),
  character_version_id uuid not null references character_versions(id) on delete cascade,
  metric               stat_metric_t not null,
  scale_id             uuid references stat_scales(id) on delete restrict,
  raw_text             text not null check (length(raw_text) <= 400),  -- LP-4 / SR-1
  qualifier            qualifier_t not null default 'exact',
  min_scale_id         uuid references stat_scales(id) on delete restrict,
  max_scale_id         uuid references stat_scales(id) on delete restrict,
  exact_value          numeric,
  confidence           numeric(3,2) not null default 0.5 check (confidence >= 0 and confidence <= 1),
  source_id            uuid not null references sources(id) on delete restrict,
  source_url           text,
  status               stat_status_t not null default 'current',
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
-- Satu nilai "current" per (form, metrik, sumber). Versi lama disimpan sebagai
-- status='superseded' sehingga riwayat tidak hilang (D6).
create unique index idx_statistics_current
  on statistics (character_version_id, metric, source_id)
  where status = 'current';
create index idx_statistics_lookup on statistics (character_version_id, metric, status);
create index idx_statistics_scale on statistics (scale_id);
create index idx_statistics_source on statistics (source_id);
create trigger trg_statistics_updated before update on statistics
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. Ability & resistensi
-- ---------------------------------------------------------------------------

create table ability_categories (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  name             text not null,
  description      text,
  is_offensive     boolean not null default false,
  is_defensive     boolean not null default false,
  is_passive       boolean not null default false,
  is_resistible    boolean not null default true,   -- dasar pembuatan resistance_types
  is_negation      boolean not null default false,  -- mis. Existence Erasure, Regeneration Negation
  parent_category_id uuid references ability_categories(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index idx_ability_categories_parent on ability_categories (parent_category_id);
create trigger trg_ability_categories_updated before update on ability_categories
  for each row execute function public.set_updated_at();

create table abilities (
  id                   uuid primary key default gen_random_uuid(),
  slug                 text not null unique,
  name                 text not null,
  category_id          uuid not null references ability_categories(id) on delete restrict,
  description          text,
  default_level        text,
  activation_condition text,
  activation_speed     activation_speed_t not null default 'fast',
  range_scale_id       uuid references stat_scales(id) on delete set null,
  cooldown             text,
  limitations          text,
  counters             text,
  is_offensive         boolean not null default false,
  is_defensive         boolean not null default false,
  is_passive           boolean not null default false,
  is_prep_required     boolean not null default false,  -- dipakai bonus prep_time
  source_id            uuid not null references sources(id) on delete restrict,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index idx_abilities_category on abilities (category_id);
create index idx_abilities_offensive on abilities (is_offensive) where is_offensive;
create trigger trg_abilities_updated before update on abilities
  for each row execute function public.set_updated_at();

alter table equipment
  add constraint equipment_grants_ability_fk
  foreign key (grants_ability_id) references abilities(id) on delete set null;

create table character_abilities (
  id                       uuid primary key default gen_random_uuid(),
  character_version_id     uuid not null references character_versions(id) on delete cascade,
  ability_id               uuid not null references abilities(id) on delete restrict,
  proficiency              proficiency_t not null default 'intermediate',
  level_notes              text,
  activation_notes         text,
  effective_range_scale_id uuid references stat_scales(id) on delete set null,
  evidence_text            text check (length(evidence_text) <= 400),  -- LP-4
  source_id                uuid not null references sources(id) on delete restrict,
  source_url               text,
  verification_status      verification_t not null default 'imported',
  confidence               numeric(3,2) not null default 0.5 check (confidence >= 0 and confidence <= 1),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (character_version_id, ability_id)
);
create index idx_char_abilities_version on character_abilities (character_version_id);
create index idx_char_abilities_ability on character_abilities (ability_id);
create trigger trg_char_abilities_updated before update on character_abilities
  for each row execute function public.set_updated_at();

create table resistance_types (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  category_id uuid not null references ability_categories(id) on delete restrict,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (category_id)
);
create trigger trg_resistance_types_updated before update on resistance_types
  for each row execute function public.set_updated_at();

create table character_resistances (
  id                   uuid primary key default gen_random_uuid(),
  character_version_id uuid not null references character_versions(id) on delete cascade,
  resistance_type_id   uuid not null references resistance_types(id) on delete restrict,
  level                smallint not null check (level between 0 and 4),
  -- Disimpan sebagai kolom biasa (bukan generated column) agar ekspresi
  -- pemetaan level->label tidak bergantung pada jaminan immutability cast enum.
  level_label          resistance_level_t not null,
  description          text,
  evidence_text        text check (length(evidence_text) <= 400),
  source_id            uuid not null references sources(id) on delete restrict,
  source_url           text,
  verification_status  verification_t not null default 'imported',
  confidence           numeric(3,2) not null default 0.5 check (confidence >= 0 and confidence <= 1),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (character_version_id, resistance_type_id),
  -- level_label harus konsisten dengan level
  constraint resist_level_label_consistent check (
    (level = 0 and level_label = 'none')     or
    (level = 1 and level_label = 'limited')  or
    (level = 2 and level_label = 'moderate') or
    (level = 3 and level_label = 'high')     or
    (level = 4 and level_label = 'absolute')
  ),
  -- RS-3: level 'absolute' hanya sah bila buktinya terverifikasi
  constraint resist_absolute_requires_verified
    check (level < 4 or verification_status = 'verified')
);
create index idx_char_resist_version on character_resistances (character_version_id);
create index idx_char_resist_type on character_resistances (resistance_type_id);
create trigger trg_char_resist_updated before update on character_resistances
  for each row execute function public.set_updated_at();

-- Rule engine: ability x resistance -> efektivitas. Semua baris dapat diedit admin.
create table hax_interactions (
  id                        uuid primary key default gen_random_uuid(),
  ability_category_id       uuid not null references ability_categories(id) on delete cascade,
  ability_id                uuid references abilities(id) on delete cascade,
  resistance_type_id        uuid references resistance_types(id) on delete cascade,
  relation                  hax_relation_t not null,
  effectiveness_multiplier  numeric(4,3) not null default 1.0 check (effectiveness_multiplier between 0 and 2),
  requires_source_evidence  boolean not null default false,  -- RS-1
  notes                     text,
  rule_set_version          text not null default '1.0.0',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint hax_interaction_has_target
    check (ability_id is not null or resistance_type_id is not null)
);
-- Unik dengan NULL diperlakukan sama (portable; tidak butuh sintaks NULLS NOT DISTINCT)
create unique index uq_hax_interactions
  on hax_interactions (
    ability_category_id,
    coalesce(ability_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(resistance_type_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
create index idx_hax_lookup on hax_interactions (ability_category_id, resistance_type_id);
create trigger trg_hax_updated before update on hax_interactions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 8. Feats, sumber per karakter, konflik
-- ---------------------------------------------------------------------------

create table feats (
  id                   uuid primary key default gen_random_uuid(),
  character_version_id uuid not null references character_versions(id) on delete cascade,
  feat_type            stat_metric_t not null,
  description          text not null,
  significance         feasibility_t not null default 'supportive',
  evidence_text        text check (length(evidence_text) <= 400),
  source_id            uuid not null references sources(id) on delete restrict,
  source_url           text,
  verification_status  verification_t not null default 'imported',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index idx_feats_version on feats (character_version_id, feat_type);
create index idx_feats_significance on feats (significance);
create trigger trg_feats_updated before update on feats
  for each row execute function public.set_updated_at();

create table character_sources (
  id           uuid primary key default gen_random_uuid(),
  character_id uuid not null references characters(id) on delete cascade,
  source_id    uuid not null references sources(id) on delete restrict,
  source_url   text not null,
  role         source_role_t not null default 'identity',
  notes        text,
  imported_at  timestamptz not null default now(),
  unique (character_id, source_id, role)
);
create index idx_character_sources_char on character_sources (character_id);
create index idx_character_sources_source on character_sources (source_id);

create table character_source_conflicts (
  id                   uuid primary key default gen_random_uuid(),
  character_id         uuid not null references characters(id) on delete cascade,
  character_version_id uuid references character_versions(id) on delete cascade,
  field                text not null,
  value_a              text,
  value_b              text,
  source_a_id          uuid references sources(id) on delete set null,
  source_b_id          uuid references sources(id) on delete set null,
  status               conflict_status_t not null default 'open',
  resolution           text,
  resolved_by          uuid,
  resolved_at          timestamptz,
  detected_at          timestamptz not null default now()
);
create index idx_conflicts_status on character_source_conflicts (status, detected_at desc);
create index idx_conflicts_character on character_source_conflicts (character_id);

create table merge_candidates (
  id               uuid primary key default gen_random_uuid(),
  character_a_id   uuid not null references characters(id) on delete cascade,
  character_b_id   uuid not null references characters(id) on delete cascade,
  similarity_score numeric(4,3) not null check (similarity_score between 0 and 1),
  signals          jsonb not null default '{}'::jsonb,
  status           merge_status_t not null default 'pending',
  resolved_by      uuid,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  constraint merge_candidates_ordered check (character_a_id < character_b_id)
);
create unique index uq_merge_pair on merge_candidates (character_a_id, character_b_id);
create index idx_merge_status on merge_candidates (status, similarity_score desc);

-- Redirect permanen agar URL lama tetap hidup setelah merge/rename (DR-3)
create table slug_redirects (
  old_slug    text primary key,
  entity_type text not null check (entity_type in ('character', 'verse', 'version', 'matchup')),
  new_slug    text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 9. Ingestion: jobs, error, staging
-- ---------------------------------------------------------------------------

create table ingestion_jobs (
  id              uuid primary key default gen_random_uuid(),
  source_id       uuid references sources(id) on delete set null,
  scope           job_scope_t not null,
  target_ref      text,                              -- slug / url / nama file dataset
  status          job_status_t not null default 'pending',
  priority        smallint not null default 5 check (priority between 1 and 9),
  started_at      timestamptz,
  completed_at    timestamptz,
  next_attempt_at timestamptz not null default now(),
  retry_count     smallint not null default 0,
  max_retries     smallint not null default 5,
  http_status     smallint,
  parser_version  text,
  error_type      ingest_error_t,
  error_message   text,
  records_found   integer not null default 0,
  records_created integer not null default 0,
  records_updated integer not null default 0,
  records_failed  integer not null default 0,
  cursor          jsonb not null default '{}'::jsonb,   -- titik resume
  dry_run         boolean not null default false,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ingestion_jobs_completed_consistency
    check (status not in ('completed', 'partial', 'failed', 'skipped') or completed_at is not null)
);
create index idx_jobs_dispatch on ingestion_jobs (status, next_attempt_at)
  where status in ('pending', 'processing');
create index idx_jobs_source on ingestion_jobs (source_id, created_at desc);
create index idx_jobs_status on ingestion_jobs (status, created_at desc);
create trigger trg_jobs_updated before update on ingestion_jobs
  for each row execute function public.set_updated_at();

create table ingestion_errors (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references ingestion_jobs(id) on delete cascade,
  source_url    text,
  error_type    ingest_error_t not null,
  error_message text not null,
  http_status   smallint,
  payload       jsonb,                     -- potongan mentah <= 4 KB agar dapat direproduksi
  retry_count   smallint not null default 0,
  created_at    timestamptz not null default now(),
  constraint ingestion_errors_payload_size
    check (payload is null or pg_column_size(payload) <= 8192)
);
create index idx_ingest_errors_job on ingestion_errors (job_id);
create index idx_ingest_errors_type on ingestion_errors (error_type, created_at desc);

-- Staging: hasil parse disimpan agar re-parse tidak perlu fetch ulang.
-- Retensi 90 hari (purge_expired_staging).
create table ingestion_raw_pages (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid references ingestion_jobs(id) on delete set null,
  source_id      uuid references sources(id) on delete set null,
  source_url     text not null,
  parsed_json    jsonb not null,
  parser_version text not null,
  content_hash   text not null,
  fetched_at     timestamptz not null default now(),
  expires_at     timestamptz not null default (now() + interval '90 days'),
  created_at     timestamptz not null default now()
);
create unique index uq_raw_pages on ingestion_raw_pages (source_url, content_hash, parser_version);
create index idx_raw_pages_expires on ingestion_raw_pages (expires_at);
create index idx_raw_pages_job on ingestion_raw_pages (job_id);

create table source_snapshots (
  id             uuid primary key default gen_random_uuid(),
  source_id      uuid not null references sources(id) on delete cascade,
  source_url     text not null,
  fetched_at     timestamptz not null default now(),
  http_status    smallint,
  etag           text,
  last_modified  text,
  content_hash   text not null,
  parser_version text not null,
  excerpt        text check (length(excerpt) <= 400),   -- IG-5: bukan arsip penuh
  byte_size      integer,
  created_at     timestamptz not null default now()
);
create unique index uq_source_snapshots on source_snapshots (source_id, source_url, content_hash);
create index idx_snapshots_recent on source_snapshots (source_id, fetched_at desc);

-- ---------------------------------------------------------------------------
-- 10. Battle: rule set, kondisi, battles, hasil, narasi
-- ---------------------------------------------------------------------------

create table battle_rule_sets (
  id             uuid primary key default gen_random_uuid(),
  version        text not null unique,
  engine_version text not null default 'battle-engine@1.0.0',
  weights        jsonb not null,
  constants      jsonb not null,
  active         boolean not null default false,
  notes          text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- Σ bobot harus 100 (BC-4)
  constraint battle_rule_sets_weights_sum
    check (public.rule_set_weight_sum(weights) = 100)
);
create unique index uq_rule_set_active on battle_rule_sets (active) where active;
create trigger trg_rule_sets_updated before update on battle_rule_sets
  for each row execute function public.set_updated_at();

create table battle_conditions (
  id                         uuid primary key default gen_random_uuid(),
  mode                       battle_mode_t not null default 'standard',
  speed_equalized            boolean not null default false,
  starting_distance_scale_id uuid references stat_scales(id) on delete set null,
  battlefield                text not null default 'neutral',
  knowledge_level            knowledge_t not null default 'partial',
  prep_time                  prep_time_t not null default 'none',
  win_condition              win_condition_t not null default 'incapacitation',
  conditions_hash            text not null,
  created_at                 timestamptz not null default now(),
  unique (conditions_hash)
);
create index idx_conditions_hash on battle_conditions (conditions_hash);

create table battles (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null,
  side_a_version_id uuid not null references character_versions(id) on delete restrict,
  side_b_version_id uuid not null references character_versions(id) on delete restrict,
  conditions_id   uuid not null references battle_conditions(id) on delete restrict,
  is_public       boolean not null default true,
  share_count     integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint battles_distinct_sides check (side_a_version_id <> side_b_version_id),
  unique (side_a_version_id, side_b_version_id, conditions_id)
);
create index idx_battles_slug on battles (slug);
create index idx_battles_recent on battles (created_at desc);
create trigger trg_battles_updated before update on battles
  for each row execute function public.set_updated_at();

create table battle_results (
  id                   uuid primary key default gen_random_uuid(),
  battle_id            uuid not null references battles(id) on delete cascade,
  winner               winner_t not null,
  win_probability_a    numeric(5,4) not null check (win_probability_a between 0 and 1),
  win_probability_b    numeric(5,4) not null check (win_probability_b between 0 and 1),
  confidence           numeric(4,3) not null check (confidence between 0 and 1),
  difficulty           difficulty_t not null,
  battle_length        battle_length_t not null,
  score_breakdown      jsonb not null default '[]'::jsonb,
  decisive_edges       jsonb not null default '[]'::jsonb,
  primary_reason       text not null,
  secondary_factors    jsonb not null default '[]'::jsonb,
  critical_counter     text,
  potential_scenario   text,
  limitations          jsonb not null default '[]'::jsonb,
  assumptions          jsonb not null default '[]'::jsonb,
  -- Rujukan terstruktur per kalimat reasoning (validator RG-1, AC-34):
  -- { "primary": ["metric:speed", ...], "scenario": [...], ... }
  reasoning_refs       jsonb not null default '{}'::jsonb,
  input_hash           text not null unique,
  engine_version       text not null,
  rule_set_version     text not null references battle_rule_sets(version) on delete restrict,
  rule_set_id          uuid not null references battle_rule_sets(id) on delete restrict,
  computed_at          timestamptz not null default now(),
  cached_until         timestamptz not null default (now() + interval '7 days'),
  constraint battle_results_probabilities_sum
    check (abs(win_probability_a + win_probability_b - 1) < 0.0005)
);
create index idx_battle_results_battle on battle_results (battle_id);
create index idx_battle_results_recent on battle_results (computed_at desc);
create index idx_battle_results_winner on battle_results (winner);
create index idx_battle_results_cache on battle_results (input_hash, cached_until);

-- Output AI dipisahkan dari tabel fakta (§34)
create table battle_narratives (
  id                 uuid primary key default gen_random_uuid(),
  battle_id          uuid not null references battles(id) on delete cascade,
  model              text not null,
  prompt_version     text not null,
  narrative          text not null,
  citation_coverage  numeric(4,3) check (citation_coverage between 0 and 1),
  fact_check_passed  boolean not null default false,
  created_at         timestamptz not null default now()
);
create index idx_narratives_battle on battle_narratives (battle_id);

-- ---------------------------------------------------------------------------
-- 11. User, analytics, audit, laporan
-- ---------------------------------------------------------------------------

create table users (
  id           uuid primary key,
  display_name text,
  locale       text default 'id',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_users_updated before update on users
  for each row execute function public.set_updated_at();

create table user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  role       user_role_t not null,
  granted_by uuid,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
create index idx_user_roles_user on user_roles (user_id);

create table favorites (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references users(id) on delete cascade,
  character_version_id uuid references character_versions(id) on delete cascade,
  battle_id            uuid references battles(id) on delete cascade,
  created_at           timestamptz not null default now(),
  constraint favorites_exactly_one_target
    check ((character_version_id is null) <> (battle_id is null))
);
create unique index uq_favorites_target
  on favorites (
    user_id,
    coalesce(character_version_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(battle_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create table analytics_events (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  props       jsonb not null default '{}'::jsonb,
  actor_hash  text,                      -- SHA-256(ip + tanggal + salt), tanpa PII
  created_at  timestamptz not null default now()
);
create index idx_analytics_name on analytics_events (name, created_at desc);
create index idx_analytics_props on analytics_events using gin (props jsonb_path_ops);

create table audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references users(id) on delete set null,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  ip_hash     text,
  created_at  timestamptz not null default now()
);
create index idx_audit_entity on audit_logs (entity_type, entity_id);
create index idx_audit_actor on audit_logs (actor_id, created_at desc);

create table data_reports (
  id                   uuid primary key default gen_random_uuid(),
  character_id         uuid not null references characters(id) on delete cascade,
  character_version_id uuid references character_versions(id) on delete cascade,
  field                text,
  reason_category      text not null,
  details              text,
  proposed_source_url  text,
  status               report_status_t not null default 'new',
  report_count         integer not null default 1,
  reviewed_by          uuid references users(id) on delete set null,
  reviewed_at          timestamptz,
  created_at           timestamptz not null default now()
);
create index idx_reports_status on data_reports (status, created_at desc);
create index idx_reports_character on data_reports (character_id);

-- ============================================================================
-- 12. Fungsi validasi & trigger integritas
-- ============================================================================

-- Cek role untuk RLS. SECURITY DEFINER agar tidak terjadi rekursi kebijakan.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role in ('admin', 'owner', 'curator')
  )
$$;

create or replace function public.is_curator()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role in ('curator', 'admin', 'owner')
  )
$$;

-- VA-1 / AC-09: tabel fakta tidak boleh menerima baris tanpa source_id.
-- Generik: hanya memeriksa baris yang memang punya kolom source_id.
create or replace function public.guard_fact_source()
returns trigger
language plpgsql
as $$
begin
  if to_jsonb(new) ? 'source_id' and (to_jsonb(new) -> 'source_id') = 'null'::jsonb then
    raise exception
      using errcode = 'not_null_violation',
            message = format('source_id wajib pada tabel %s (traceability, AC-09)', tg_table_name);
  end if;
  return new;
end;
$$;

create trigger trg_guard_source_statistics before insert or update on statistics
  for each row execute function public.guard_fact_source();
create trigger trg_guard_source_abilities before insert or update on character_abilities
  for each row execute function public.guard_fact_source();
create trigger trg_guard_source_resistances before insert or update on character_resistances
  for each row execute function public.guard_fact_source();
create trigger trg_guard_source_feats before insert or update on feats
  for each row execute function public.guard_fact_source();
create trigger trg_guard_source_abilities_catalog before insert or update on abilities
  for each row execute function public.guard_fact_source();
create trigger trg_guard_source_verses before insert or update on verses
  for each row execute function public.guard_fact_source();

-- Idempotensi & jejak atomik untuk tabel fakta:
-- saat nilai baru masuk untuk (form, metrik, sumber) yang sama, baris lama
-- ditandai 'superseded' — TIDAK ditimpa dan tidak dihapus (D6, AC-17).
create or replace function public.supersede_previous_stat()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'current' then
    update statistics
       set status = 'superseded'
     where character_version_id = new.character_version_id
       and metric = new.metric
       and source_id = new.source_id
       and status = 'current'
       and id <> new.id;
  end if;
  return new;
end;
$$;
create trigger trg_statistics_supersede before insert or update on statistics
  for each row execute function public.supersede_previous_stat();

-- Sinkronisasi cache stat di character_versions dari statistics (D7).
-- Sumber kebenaran = statistics; kolom ini hanya cache untuk filter/sort.
create or replace function public.sync_version_stat_cache()
returns trigger
language plpgsql
as $$
declare
  v_metric stat_metric_t;
  v_scale  uuid;
  v_version uuid;
begin
  v_version := coalesce(new.character_version_id, old.character_version_id);
  v_metric  := coalesce(new.metric, old.metric);

  select scale_id into v_scale
    from statistics
   where character_version_id = v_version
     and metric = v_metric
     and status = 'current'
   order by confidence desc, created_at desc
   limit 1;

  -- `tier` tidak memakai stat_scales: tier disimpan di tiers.numerical_rank
  if v_metric = 'tier' then
    update character_versions cv
       set tier_id = (
             select t.id from statistics s
               join tiers t on t.tier_code = s.raw_text  -- mapping via import alias
              where s.character_version_id = v_version and s.metric = 'tier' and s.status = 'current'
              order by s.confidence desc limit 1)
     where cv.id = v_version;
    return coalesce(new, old);
  end if;

  update character_versions set
    attack_potency_scale_id = case when v_metric = 'attack_potency'   then v_scale else attack_potency_scale_id end,
    durability_scale_id     = case when v_metric = 'durability'       then v_scale else durability_scale_id end,
    striking_scale_id       = case when v_metric = 'striking_strength'then v_scale else striking_scale_id end,
    lifting_scale_id        = case when v_metric = 'lifting_strength' then v_scale else lifting_scale_id end,
    speed_scale_id          = case when v_metric = 'speed'            then v_scale else speed_scale_id end,
    reaction_speed_scale_id = case when v_metric = 'reaction_speed'   then v_scale else reaction_speed_scale_id end,
    combat_speed_scale_id   = case when v_metric = 'combat_speed'     then v_scale else combat_speed_scale_id end,
    range_scale_id          = case when v_metric = 'range'            then v_scale else range_scale_id end,
    stamina_scale_id        = case when v_metric = 'stamina'          then v_scale else stamina_scale_id end,
    intelligence_scale_id   = case when v_metric = 'intelligence'     then v_scale else intelligence_scale_id end,
    battle_iq_scale_id      = case when v_metric = 'battle_iq'        then v_scale else battle_iq_scale_id end
  where id = v_version;

  return coalesce(new, old);
end;
$$;
create trigger trg_statistics_sync_cache
  after insert or update or delete on statistics
  for each row execute function public.sync_version_stat_cache();

-- Fingerprint duplikat (§21.2). Dipisahkan dari slug agar dapat dihitung ulang.
create or replace function public.set_character_fingerprint()
returns trigger
language plpgsql
as $$
declare
  v_verse_slug text;
begin
  select slug into v_verse_slug from verses where id = new.verse_id;
  new.fp_key := encode(
    digest(
      public.f_normalize_name(new.name) || '|' || coalesce(v_verse_slug, '-'),
      'sha1'),
    'hex');
  return new;
end;
$$;
create trigger trg_characters_fingerprint before insert or update of name, verse_id on characters
  for each row execute function public.set_character_fingerprint();

-- search_vector: TIDAK dapat dijadikan generated column karena perlu
-- agregasi alias (subquery). Karena itu dikelola trigger.
create or replace function public.refresh_character_search_vector()
returns trigger
language plpgsql
as $$
declare
  v_character_id uuid;
  v_alias_text   text;
  v_verse_name   text;
  v_ability_text text;
begin
  -- NEW tidak terdefinisi pada trigger DELETE, jadi baca kolom sesuai operasi & tabel.
  if tg_table_name = 'characters' then
    v_character_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    v_character_id := case when tg_op = 'DELETE' then old.character_id else new.character_id end;
  end if;

  select string_agg(a.alias, ' ') into v_alias_text
    from character_aliases a where a.character_id = v_character_id;

  select v.name into v_verse_name
    from characters c join verses v on v.id = c.verse_id
   where c.id = v_character_id;

  select string_agg(ab.name, ' ') into v_ability_text
    from character_abilities ca
    join abilities ab on ab.id = ca.ability_id
    join character_versions cv on cv.id = ca.character_version_id
   where cv.character_id = v_character_id;

  update characters c set search_vector =
      setweight(to_tsvector('simple', public.f_unaccent(coalesce(c.name, ''))), 'A') ||
      setweight(to_tsvector('simple', public.f_unaccent(coalesce(c.native_name, ''))), 'A') ||
      setweight(to_tsvector('simple', coalesce(v_alias_text, '')), 'A') ||
      setweight(to_tsvector('simple', public.f_unaccent(coalesce(v_verse_name, ''))), 'B') ||
      setweight(to_tsvector('simple', public.f_unaccent(coalesce(c.classification, ''))), 'C') ||
      setweight(to_tsvector('simple', coalesce(v_ability_text, '')), 'D')
  where c.id = v_character_id;

  return null;  -- trigger AFTER
end;
$$;

-- ============================================================================
-- 13. Kolom search_vector + index (setelah tabel & fungsi ada)
-- ============================================================================
alter table characters add column search_vector tsvector;
create index idx_characters_search on characters using gin (search_vector);

create trigger trg_characters_search_vector
  after insert or update of name, native_name, classification, verse_id on characters
  for each row execute function public.refresh_character_search_vector();

create trigger trg_aliases_search_vector
  after insert or update or delete on character_aliases
  for each row execute function public.refresh_character_search_vector();

-- ============================================================================
-- 14. Materialized views
-- ============================================================================

-- Distribusi tier per verse (halaman verse + homepage)
create materialized view mv_verse_tier_distribution as
select c.verse_id,
       cv.tier_id,
       t.tier_code,
       t.numerical_rank,
       count(distinct c.id) as character_count,
       count(cv.id)         as form_count
  from character_versions cv
  join characters c on c.id = cv.character_id
  join tiers t on t.id = cv.tier_id
 where cv.deleted_at is null
 group by c.verse_id, cv.tier_id, t.tier_code, t.numerical_rank;
create unique index uq_mv_verse_tier on mv_verse_tier_distribution (verse_id, tier_id);
create index idx_mv_verse_tier_rank on mv_verse_tier_distribution (verse_id, numerical_rank desc);

-- Matchup populer (Popular Battles) — agregat anonim, bukan daftar hardcode
create materialized view mv_battle_popularity as
select b.slug                          as matchup_key,
       b.side_a_version_id,
       b.side_b_version_id,
       count(br.id)                    as simulations,
       coalesce(sum(b.share_count), 0) as share_count,
       max(br.computed_at)             as last_simulated_at,
       count(distinct br.winner)       as distinct_winners
  from battles b
  join battle_results br on br.battle_id = b.id
 group by b.slug, b.side_a_version_id, b.side_b_version_id;
create unique index uq_mv_battle_popularity on mv_battle_popularity (matchup_key);
create index idx_mv_battle_popularity_sims on mv_battle_popularity (simulations desc);

-- MV pencarian untuk skala besar (> 100k). Dipakai bila search in-table melambat.
create materialized view mv_character_search as
select c.id,
       c.slug,
       c.name,
       c.native_name,
       c.popularity_score,
       c.data_completeness,
       v.slug as verse_slug,
       v.name as verse_name,
       (select string_agg(a.alias, ' ') from character_aliases a where a.character_id = c.id) as aliases,
       (select max(t.numerical_rank)
          from character_versions cv join tiers t on t.id = cv.tier_id
         where cv.character_id = c.id and cv.deleted_at is null) as max_tier_rank
  from characters c
  join verses v on v.id = c.verse_id;
create unique index uq_mv_character_search on mv_character_search (id);
create index idx_mv_character_search_trgm on mv_character_search using gin (public.f_normalize_name(name) gin_trgm_ops);

-- REFRESH ... CONCURRENTLY tidak dapat dijalankan di dalam transaksi, sedangkan
-- setiap fungsi di PostgREST/RPC berjalan dalam transaksi. Karena itu fungsi ini
-- memakai refresh non-concurrent (mengunci baca singkat). Untuk refresh tanpa
-- downtime, jalankan `scripts/refresh-mv.sql` lewat cron/psql di luar transaksi
-- (versi CONCURRENTLY memerlukan unique index — sudah disediakan di atas).
create or replace function public.refresh_materialized_views()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view mv_verse_tier_distribution;
  refresh materialized view mv_battle_popularity;
  refresh materialized view mv_character_search;
end;
$$;

-- ============================================================================
-- 15. RPC: pencarian hybrid, dataset battle, cache battle
-- ============================================================================

-- Search hybrid: FTS + trigram + alias + boost popularitas (§26.1).
-- Input tidak pernah dirangkai menjadi SQL; hanya parameter.
create or replace function public.search_characters(
  q text,
  lim integer default 20,
  only_public boolean default true
)
returns table (
  id uuid,
  slug text,
  name text,
  verse_name text,
  tier_code text,
  score real
)
language sql
stable
as $$
  with needle as (
    select public.f_unaccent(coalesce(q, '')) as raw,
           plainto_tsquery('simple', public.f_unaccent(coalesce(q, ''))) as ts
  )
  select c.id,
         c.slug,
         c.name,
         v.name as verse_name,
         (select t.tier_code
            from character_versions cv join tiers t on t.id = cv.tier_id
           where cv.character_id = c.id and cv.is_default and cv.deleted_at is null
           limit 1) as tier_code,
         (
           0.60 * ts_rank_cd(c.search_vector, n.ts)
         + 0.25 * greatest(
             similarity(public.f_normalize_name(c.name), n.raw),
             coalesce((select max(similarity(a.alias_norm, n.raw))
                         from character_aliases a where a.character_id = c.id), 0))
         + 0.10 * (case when public.f_normalize_name(c.name) like n.raw || '%' then 1 else 0 end)
         + 0.05 * least(c.popularity_score::real / 1000.0, 1.0)
         )::real as score
    from characters c
    join verses v on v.id = c.verse_id
    cross join needle n
   where (not only_public or c.verification_status in ('verified', 'imported', 'partially_verified'))
     and (
          c.search_vector @@ n.ts
       or public.f_normalize_name(c.name) % n.raw                       -- pg_trgm similarity
       or exists (select 1 from character_aliases a
                   where a.character_id = c.id and a.alias_norm % n.raw)
     )
   order by score desc, c.popularity_score desc
   limit least(coalesce(lim, 20), 200)
$$;

-- Dataset agregat untuk battle engine dalam SATU round-trip (menghindari N+1).
--
-- Bentuk keluaran harus cocok dengan tipe `SideData` di src/services/battle/types.ts.
-- Khususnya: setiap ability membawa `category_slug` + `category_is_negation`, dan
-- setiap resistensi membawa `category_slug` (kategori ability yang ditahan) karena
-- rule engine mencocokkan aturan berdasarkan pasangan SLUG KATEGORI, bukan id.
create or replace function public.battle_dataset(version_ids uuid[])
returns jsonb
language sql
stable
as $$
  select jsonb_agg(entry order by entry ->> 'version_id')
  from (
    select jsonb_build_object(
      'version_id', cv.id,
      'character', jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name),
      'verse', jsonb_build_object('id', v.id, 'slug', v.slug, 'name', v.name),
      'form', jsonb_build_object(
        'id', cv.id, 'slug', cv.slug, 'name', cv.name, 'era', cv.era,
        'is_variant', cv.is_variant, 'media_type', cv.media_type,
        'experience_years', cv.experience_years,
        'data_completeness', cv.data_completeness
      ),
      'tier', jsonb_build_object('code', t.tier_code, 'rank', t.numerical_rank, 'rankable', t.is_rankable),
      'metrics', jsonb_build_object(
        'tier', t.numerical_rank,
        'attack_potency', ap.rank, 'durability', du.rank, 'striking_strength', st.rank,
        'lifting_strength', li.rank, 'speed', sp.rank, 'reaction_speed', rs.rank,
        'combat_speed', cs.rank, 'range', rg.rank, 'stamina', sa.rank,
        'intelligence', it.rank, 'battle_iq', bi.rank,
        'attack_potency_physical', ap.is_physical, 'speed_physical', sp.is_physical
      ),
      'statistics', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'metric', s.metric, 'raw_text', s.raw_text, 'qualifier', s.qualifier,
                 'scale_rank', sc.rank, 'confidence', s.confidence,
                 'source_id', s.source_id, 'status', s.status))
          from statistics s left join stat_scales sc on sc.id = s.scale_id
         where s.character_version_id = cv.id
      ), '[]'::jsonb),
      'abilities', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', ab.id, 'name', ab.name, 'category_id', ab.category_id,
                 'category_slug', ac.slug,
                 'category_is_negation', ac.is_negation,
                 'activation_speed', ab.activation_speed,
                 'is_offensive', ab.is_offensive, 'is_passive', ab.is_passive,
                 'is_prep_required', ab.is_prep_required,
                 'proficiency', ca.proficiency, 'confidence', ca.confidence,
                 'effective_range_rank', rs.rank))
          from character_abilities ca
          join abilities ab on ab.id = ca.ability_id
          join ability_categories ac on ac.id = ab.category_id
          left join stat_scales rs on rs.id = ca.effective_range_scale_id
         where ca.character_version_id = cv.id
      ), '[]'::jsonb),
      'resistances', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'resistance_type_id', cr.resistance_type_id,
                 'resistance_type_slug', rt.slug,
                 'category_id', rt.category_id,
                 'category_slug', ac.slug,
                 'level', cr.level,
                 'level_label', cr.level_label,
                 'verification_status', cr.verification_status,
                 'confidence', cr.confidence))
          from character_resistances cr
          join resistance_types rt on rt.id = cr.resistance_type_id
          join ability_categories ac on ac.id = rt.category_id
         where cr.character_version_id = cv.id
      ), '[]'::jsonb),
      'traits', coalesce((
        select jsonb_agg(ct.trait) from character_traits ct
         where ct.character_version_id = cv.id
      ), '[]'::jsonb)
    ) as entry
    from character_versions cv
    join characters c on c.id = cv.character_id
    join verses v on v.id = c.verse_id
    left join tiers t on t.id = cv.tier_id
    left join stat_scales ap on ap.id = cv.attack_potency_scale_id
    left join stat_scales du on du.id = cv.durability_scale_id
    left join stat_scales st on st.id = cv.striking_scale_id
    left join stat_scales li on li.id = cv.lifting_scale_id
    left join stat_scales sp on sp.id = cv.speed_scale_id
    left join stat_scales rs on rs.id = cv.reaction_speed_scale_id
    left join stat_scales cs on cs.id = cv.combat_speed_scale_id
    left join stat_scales rg on rg.id = cv.range_scale_id
    left join stat_scales sa on sa.id = cv.stamina_scale_id
    left join stat_scales it on it.id = cv.intelligence_scale_id
    left join stat_scales bi on bi.id = cv.battle_iq_scale_id
   where cv.id = any(version_ids) and cv.deleted_at is null
  ) sub;
$$;

-- Cache battle: cari hasil valid berdasarkan input_hash
create or replace function public.battle_cache_get(p_hash text)
returns setof battle_results
language sql
stable
as $$
  select * from battle_results
   where input_hash = p_hash
     and cached_until > now()
   limit 1
$$;

-- ============================================================================
-- 16. Row Level Security
-- ============================================================================
alter table sources                     enable row level security;
alter table stat_scale_metrics          enable row level security;
alter table stat_scales                 enable row level security;
alter table tiers                       enable row level security;
alter table verses                      enable row level security;
alter table characters                  enable row level security;
alter table character_aliases           enable row level security;
alter table character_versions          enable row level security;
alter table character_traits            enable row level security;
alter table equipment                   enable row level security;
alter table statistics                  enable row level security;
alter table ability_categories          enable row level security;
alter table abilities                   enable row level security;
alter table character_abilities         enable row level security;
alter table resistance_types            enable row level security;
alter table character_resistances       enable row level security;
alter table hax_interactions            enable row level security;
alter table feats                       enable row level security;
alter table character_sources           enable row level security;
alter table character_source_conflicts  enable row level security;
alter table merge_candidates            enable row level security;
alter table slug_redirects              enable row level security;
alter table ingestion_jobs              enable row level security;
alter table ingestion_errors            enable row level security;
alter table ingestion_raw_pages         enable row level security;
alter table source_snapshots            enable row level security;
alter table battle_rule_sets            enable row level security;
alter table battle_conditions           enable row level security;
alter table battles                     enable row level security;
alter table battle_results              enable row level security;
alter table battle_narratives           enable row level security;
alter table users                       enable row level security;
alter table user_roles                  enable row level security;
alter table favorites                   enable row level security;
alter table analytics_events            enable row level security;
alter table audit_logs                  enable row level security;
alter table data_reports                enable row level security;

-- Data publik: dapat dibaca anon (halaman situs). Mutasi hanya via service role/admin.
do $$
declare
  t text;
  public_tables text[] := array[
    'verses','characters','character_aliases','character_versions','character_traits',
    'equipment','statistics','ability_categories','abilities','character_abilities',
    'resistance_types','character_resistances','hax_interactions','feats',
    'tiers','stat_scales','stat_scale_metrics','slug_redirects',
    'battles','battle_results','battle_conditions','battle_rule_sets'
  ];
begin
  foreach t in array public_tables loop
    execute format(
      'create policy %I on %I for select to anon, authenticated using (true)',
      'pol_' || t || '_read', t);
    execute format(
      'create policy %I on %I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      'pol_' || t || '_admin', t);
  end loop;
end $$;

-- Tabel sensitif: hanya admin/curator
do $$
declare
  t text;
  admin_only text[] := array[
    'sources','character_sources','character_source_conflicts','merge_candidates',
    'ingestion_jobs','ingestion_errors','ingestion_raw_pages','source_snapshots',
    'audit_logs','user_roles'
  ];
  curator_tables text[] := array['character_source_conflicts','merge_candidates','data_reports'];
begin
  foreach t in array admin_only loop
    execute format(
      'create policy %I on %I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      'pol_' || t || '_admin', t);
  end loop;
  foreach t in array curator_tables loop
    execute format(
      'create policy %I on %I for select to authenticated using (public.is_curator())',
      'pol_' || t || '_curator_read', t);
  end loop;
end $$;

-- Battle narasi (AI) dapat dibaca publik, hanya admin yang menulis
create policy pol_battle_narratives_read on battle_narratives
  for select to anon, authenticated using (true);
create policy pol_battle_narratives_admin on battle_narratives
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Analytics & laporan: insert publik dibatasi (lebih ketat lagi di route handler),
-- baca hanya admin
create policy pol_analytics_insert on analytics_events
  for insert to anon, authenticated with check (true);
create policy pol_analytics_admin on analytics_events
  for select to authenticated using (public.is_admin());

create policy pol_reports_insert on data_reports
  for insert to anon, authenticated with check (true);
create policy pol_reports_admin on data_reports
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Users: hanya dirinya sendiri (atau admin)
create policy pol_users_self on users
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy pol_users_update_self on users
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Favorites: milik sendiri
create policy pol_favorites_own on favorites
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Slug redirect perlu dibaca publik untuk redirect 301
-- (sudah tercakup pada daftar public_tables di atas)

-- ============================================================================
-- 17. Job pemeliharaan (dipanggil cron)
-- ============================================================================

-- Rekonsiliasi cache stat vs sumber kebenaran; laporkan drift.
create or replace function public.reconcile_stat_cache()
returns table (character_version_id uuid, metric stat_metric_t, cache_scale_id uuid, truth_scale_id uuid)
language sql
security definer
set search_path = public
as $$
  with truth as (          -- nilai "menang" per (form, metrik) menurut confidence
    select distinct on (s.character_version_id, s.metric)
           s.character_version_id, s.metric, s.scale_id
      from statistics s
     where s.status = 'current'
       and s.metric in ('attack_potency', 'durability', 'speed', 'range')
     order by s.character_version_id, s.metric, s.confidence desc, s.created_at desc
  ),
  resolved as (
    select t.character_version_id,
           t.metric,
           t.scale_id as truth_scale_id,
           case t.metric
             when 'attack_potency' then cv.attack_potency_scale_id
             when 'durability'     then cv.durability_scale_id
             when 'speed'          then cv.speed_scale_id
             when 'range'          then cv.range_scale_id
           end as cache_scale_id
      from truth t
      join character_versions cv on cv.id = t.character_version_id
  )
  select r.character_version_id, r.metric, r.cache_scale_id, r.truth_scale_id
    from resolved r
   where r.cache_scale_id is distinct from r.truth_scale_id
$$;

-- Hitung data_completeness untuk karakter & form (thin content -> noindex)
create or replace function public.recompute_completeness()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with counts as (
    select cv.id,
           count(*) filter (where s.metric in ('tier','attack_potency','durability','speed')
                              and s.status = 'current') as core_metrics,
           count(distinct s.metric) as any_metrics
      from character_versions cv
      left join statistics s on s.character_version_id = cv.id
     group by cv.id
  )
  update character_versions cv
     set data_completeness = case
           when c.core_metrics >= 4 and c.any_metrics >= 8 then 'complete'::completeness_t
           when c.core_metrics >= 2 then 'partial'::completeness_t
           else 'minimal'::completeness_t
         end
    from counts c
   where cv.id = c.id;

  with agg as (
    select c.id,
           max(cv.data_completeness::text) as best
      from characters c
      left join character_versions cv on cv.character_id = c.id and cv.deleted_at is null
     group by c.id
  )
  update characters c
     set data_completeness = case
           when a.best = 'complete' then 'complete'::completeness_t
           when a.best = 'partial'  then 'partial'::completeness_t
           else 'minimal'::completeness_t
         end
    from agg a
   where c.id = a.id;
end;
$$;

-- Pembersihan staging & event lama (privasi + ukuran)
create or replace function public.purge_expired_staging()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from ingestion_raw_pages where expires_at < now();
  delete from analytics_events where created_at < now() - interval '400 days';
  delete from battle_results br
   using battles b
   where br.battle_id = b.id
     and b.share_count = 0
     and br.computed_at < now() - interval '365 days';
end;
$$;

commit;

-- ============================================================================
-- Catatan penerapan (jalankan terpisah, BUKAN di dalam transaksi migrasi):
--   refresh materialized view mv_verse_tier_distribution;
--   refresh materialized view mv_battle_popularity;
--   refresh materialized view mv_character_search;
-- Lalu jalankan docs/seed.sql.
-- ============================================================================
