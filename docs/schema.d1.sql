-- ============================================================================
-- Anime VS Battle — SQLite / Cloudflare D1 Schema
-- Disesuaikan dari docs/schema.sql untuk SQLite D1.
-- Menggantikan enum PostgreSQL dengan TEXT + CHECK constraints.
-- Menggantikan Materialized Views dengan SQLite Standard Views.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Registry sumber data
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sources (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  slug                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  base_url              TEXT NOT NULL,
  source_type           TEXT NOT NULL CHECK (source_type IN ('wiki', 'api', 'dataset', 'manual_url', 'official')),
  priority              INTEGER NOT NULL DEFAULT 4 CHECK (priority BETWEEN 1 AND 5),
  legal_status          TEXT NOT NULL DEFAULT 'restricted' CHECK (legal_status IN ('allowed', 'restricted', 'disabled')),
  legal_reviewed_by     TEXT,
  legal_reviewed_at     TEXT,
  legal_notes           TEXT,
  respect_robots        INTEGER NOT NULL DEFAULT 1,
  rate_limit_rps        REAL NOT NULL DEFAULT 1.0 CHECK (rate_limit_rps > 0),
  concurrency_limit     INTEGER NOT NULL DEFAULT 2 CHECK (concurrency_limit BETWEEN 1 AND 8),
  max_fetches_per_day   INTEGER NOT NULL DEFAULT 2000 CHECK (max_fetches_per_day > 0),
  license               TEXT,
  license_url           TEXT,
  attribution_text      TEXT,
  is_active             INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (NOT is_active OR (legal_reviewed_at IS NOT NULL)),
  CHECK (legal_status <> 'allowed' OR license IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_sources_legal ON sources (legal_status) WHERE is_active = 1;

-- ---------------------------------------------------------------------------
-- 2. Ladder nilai: metrik, skala, tier
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stat_scale_metrics (
  id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  metric             TEXT NOT NULL UNIQUE,
  label              TEXT NOT NULL,
  unit               TEXT NOT NULL,
  higher_is_better   INTEGER NOT NULL DEFAULT 1,
  normalization_span REAL NOT NULL CHECK (normalization_span > 0),
  description        TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS stat_scales (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  metric_id     TEXT NOT NULL REFERENCES stat_scale_metrics(id) ON DELETE RESTRICT,
  scale_code    TEXT NOT NULL,
  label         TEXT NOT NULL,
  rank          INTEGER NOT NULL CHECK (rank > 0),
  log_value     REAL,
  band          TEXT NOT NULL DEFAULT 'none' CHECK (band IN ('low', 'mid', 'high', 'peak', 'none')),
  is_rankable   INTEGER NOT NULL DEFAULT 1,
  is_physical   INTEGER NOT NULL DEFAULT 1,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (metric_id, scale_code),
  UNIQUE (metric_id, rank),
  CHECK (NOT is_rankable OR log_value IS NOT NULL OR NOT is_physical)
);

CREATE INDEX IF NOT EXISTS idx_stat_scales_metric_rank ON stat_scales (metric_id, rank);

CREATE TABLE IF NOT EXISTS tiers (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  tier_code       TEXT NOT NULL UNIQUE,
  tier_name       TEXT NOT NULL,
  band            TEXT NOT NULL CHECK (band IN ('low', 'mid', 'high', 'peak', 'none')),
  display_order   INTEGER NOT NULL UNIQUE,
  numerical_rank  INTEGER UNIQUE,
  parent_tier_id  TEXT REFERENCES tiers(id) ON DELETE SET NULL,
  is_rankable     INTEGER NOT NULL DEFAULT 1,
  description     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (is_rankable = (numerical_rank IS NOT NULL))
);

-- ---------------------------------------------------------------------------
-- 3. Domain: verse, karakter, alias, form
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS verses (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  slug              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  description       TEXT,
  origin_media      TEXT NOT NULL DEFAULT 'other' CHECK (origin_media IN ('manga', 'anime', 'game', 'novel', 'comic', 'movie', 'mixed', 'other')),
  popularity_score  INTEGER NOT NULL DEFAULT 0,
  data_completeness TEXT NOT NULL DEFAULT 'minimal' CHECK (data_completeness IN ('complete', 'partial', 'minimal')),
  source_id         TEXT REFERENCES sources(id) ON DELETE RESTRICT,
  source_url        TEXT,
  imported_at       TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_verses_popularity ON verses (popularity_score DESC);
CREATE INDEX IF NOT EXISTS idx_verses_media ON verses (origin_media);

CREATE TABLE IF NOT EXISTS characters (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  slug                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  native_name           TEXT,
  name_norm             TEXT GENERATED ALWAYS AS (lower(trim(name))) STORED,
  native_norm           TEXT GENERATED ALWAYS AS (lower(trim(coalesce(native_name, '')))) STORED,
  description           TEXT,
  origin                TEXT,
  verse_id              TEXT NOT NULL REFERENCES verses(id) ON DELETE RESTRICT,
  gender                TEXT,
  age                   TEXT,
  classification        TEXT,
  media_type            TEXT NOT NULL DEFAULT 'other' CHECK (media_type IN ('manga', 'anime', 'game', 'novel', 'comic', 'movie', 'mixed', 'other')),
  image_url             TEXT,
  image_source          TEXT,
  image_license         TEXT,
  image_attribution     TEXT,
  image_license_url     TEXT,
  popularity_score      INTEGER NOT NULL DEFAULT 0,
  data_completeness     TEXT NOT NULL DEFAULT 'minimal' CHECK (data_completeness IN ('complete', 'partial', 'minimal')),
  verification_status   TEXT NOT NULL DEFAULT 'unknown' CHECK (verification_status IN ('verified', 'imported', 'partially_verified', 'conflicting', 'unknown')),
  source_id             TEXT REFERENCES sources(id) ON DELETE RESTRICT,
  source_url            TEXT,
  source_name           TEXT,
  source_last_updated   TEXT,
  imported_at           TEXT,
  fp_key                TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (image_url IS NULL OR (image_license IS NOT NULL AND image_source IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_characters_verse ON characters (verse_id);
CREATE INDEX IF NOT EXISTS idx_characters_name_norm ON characters (name_norm);
CREATE INDEX IF NOT EXISTS idx_characters_native_norm ON characters (native_norm);
CREATE INDEX IF NOT EXISTS idx_characters_popularity ON characters (popularity_score DESC);
CREATE INDEX IF NOT EXISTS idx_characters_updated ON characters (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_characters_imported ON characters (imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_characters_completeness ON characters (data_completeness);

CREATE TABLE IF NOT EXISTS character_aliases (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  character_id  TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  alias         TEXT NOT NULL,
  alias_norm    TEXT GENERATED ALWAYS AS (lower(trim(alias))) STORED,
  script        TEXT NOT NULL DEFAULT 'latin' CHECK (script IN ('latin', 'kanji', 'kana', 'hangul', 'cyrillic', 'other')),
  is_primary    INTEGER NOT NULL DEFAULT 0,
  source_id     TEXT REFERENCES sources(id) ON DELETE RESTRICT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (character_id, alias)
);

CREATE INDEX IF NOT EXISTS idx_aliases_norm ON character_aliases (alias_norm);
CREATE INDEX IF NOT EXISTS idx_aliases_character ON character_aliases (character_id);

CREATE TABLE IF NOT EXISTS character_versions (
  id                        TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  character_id              TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  slug                      TEXT NOT NULL,
  name                      TEXT NOT NULL,
  description               TEXT,
  era                       TEXT,
  age_range                 TEXT,
  form_order                INTEGER NOT NULL DEFAULT 0,
  is_default                INTEGER NOT NULL DEFAULT 0,
  is_variant                INTEGER NOT NULL DEFAULT 0,
  variant_of                TEXT REFERENCES character_versions(id) ON DELETE SET NULL,
  media_type                TEXT NOT NULL DEFAULT 'other' CHECK (media_type IN ('manga', 'anime', 'game', 'novel', 'comic', 'movie', 'mixed', 'other')),
  tier_id                   TEXT REFERENCES tiers(id) ON DELETE RESTRICT,
  attack_potency_scale_id   TEXT REFERENCES stat_scales(id) ON DELETE SET NULL,
  durability_scale_id       TEXT REFERENCES stat_scales(id) ON DELETE SET NULL,
  striking_scale_id         TEXT REFERENCES stat_scales(id) ON DELETE SET NULL,
  lifting_scale_id          TEXT REFERENCES stat_scales(id) ON DELETE SET NULL,
  speed_scale_id            TEXT REFERENCES stat_scales(id) ON DELETE SET NULL,
  reaction_speed_scale_id   TEXT REFERENCES stat_scales(id) ON DELETE SET NULL,
  combat_speed_scale_id     TEXT REFERENCES stat_scales(id) ON DELETE SET NULL,
  range_scale_id            TEXT REFERENCES stat_scales(id) ON DELETE SET NULL,
  stamina_scale_id          TEXT REFERENCES stat_scales(id) ON DELETE SET NULL,
  intelligence_scale_id     TEXT REFERENCES stat_scales(id) ON DELETE SET NULL,
  battle_iq_scale_id        TEXT REFERENCES stat_scales(id) ON DELETE SET NULL,
  experience_years          REAL,
  data_completeness         TEXT NOT NULL DEFAULT 'minimal' CHECK (data_completeness IN ('complete', 'partial', 'minimal')),
  verification_status       TEXT NOT NULL DEFAULT 'unknown' CHECK (verification_status IN ('verified', 'imported', 'partially_verified', 'conflicting', 'unknown')),
  deleted_at                TEXT,
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (character_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_versions_character ON character_versions (character_id, form_order);
CREATE INDEX IF NOT EXISTS idx_versions_tier ON character_versions (tier_id);
CREATE INDEX IF NOT EXISTS idx_versions_speed ON character_versions (speed_scale_id);
CREATE INDEX IF NOT EXISTS idx_versions_ap ON character_versions (attack_potency_scale_id);

-- FR-1: tepat satu form default aktif per karakter. Indeks parsial Postgres
-- diporting sebagai indeks parsial SQLite (didukung sejak 3.8.0).
CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_single_default
  ON character_versions (character_id)
  WHERE is_default = 1 AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS character_traits (
  id                   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  character_version_id TEXT NOT NULL REFERENCES character_versions(id) ON DELETE CASCADE,
  trait                TEXT NOT NULL CHECK (trait IN ('aggressive', 'holds_back', 'tactical', 'reckless', 'talkative', 'measured')),
  notes                TEXT,
  source_id            TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (character_version_id, trait)
);

CREATE INDEX IF NOT EXISTS idx_traits_version ON character_traits (character_version_id);

CREATE TABLE IF NOT EXISTS equipment (
  id                   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  character_version_id TEXT NOT NULL REFERENCES character_versions(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  description          TEXT,
  grants_ability_id    TEXT,
  source_id            TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_equipment_version ON equipment (character_version_id);

-- ---------------------------------------------------------------------------
-- 4. Statistik form
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS statistics (
  id                   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  character_version_id TEXT NOT NULL REFERENCES character_versions(id) ON DELETE CASCADE,
  metric               TEXT NOT NULL,
  scale_id             TEXT REFERENCES stat_scales(id) ON DELETE RESTRICT,
  raw_text             TEXT NOT NULL CHECK (length(raw_text) <= 400),
  qualifier            TEXT NOT NULL DEFAULT 'exact' CHECK (qualifier IN ('exact', 'at_least', 'at_most', 'possibly', 'likely', 'up_to', 'higher_with', 'far_higher_with', 'varies', 'unknown')),
  min_scale_id         TEXT REFERENCES stat_scales(id) ON DELETE RESTRICT,
  max_scale_id         TEXT REFERENCES stat_scales(id) ON DELETE RESTRICT,
  exact_value          REAL,
  confidence           REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  source_id            TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  source_url           TEXT,
  status               TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current', 'superseded', 'conflicting')),
  notes                TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_statistics_lookup ON statistics (character_version_id, metric, status);
CREATE INDEX IF NOT EXISTS idx_statistics_scale ON statistics (scale_id);

-- Satu nilai "current" per (form, metrik, sumber); versi lama tetap tersimpan
-- sebagai status='superseded' sehingga riwayat tidak hilang (D6).
CREATE UNIQUE INDEX IF NOT EXISTS idx_statistics_current
  ON statistics (character_version_id, metric, source_id)
  WHERE status = 'current';

-- ---------------------------------------------------------------------------
-- 5. Abilities & Resistances
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ability_categories (
  id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  slug               TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  description        TEXT,
  is_offensive       INTEGER NOT NULL DEFAULT 0,
  is_defensive       INTEGER NOT NULL DEFAULT 0,
  is_passive         INTEGER NOT NULL DEFAULT 0,
  is_resistible      INTEGER NOT NULL DEFAULT 1,
  is_negation        INTEGER NOT NULL DEFAULT 0,
  parent_category_id TEXT REFERENCES ability_categories(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS abilities (
  id                   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  slug                 TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  category_id          TEXT NOT NULL REFERENCES ability_categories(id) ON DELETE RESTRICT,
  description          TEXT,
  default_level        TEXT,
  activation_condition TEXT,
  activation_speed     TEXT NOT NULL DEFAULT 'fast' CHECK (activation_speed IN ('instant', 'fast', 'moderate', 'slow', 'triggered')),
  range_scale_id       TEXT REFERENCES stat_scales(id) ON DELETE SET NULL,
  cooldown             TEXT,
  limitations          TEXT,
  counters             TEXT,
  is_offensive         INTEGER NOT NULL DEFAULT 0,
  is_defensive         INTEGER NOT NULL DEFAULT 0,
  is_passive           INTEGER NOT NULL DEFAULT 0,
  is_prep_required     INTEGER NOT NULL DEFAULT 0,
  source_id            TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_abilities_category ON abilities (category_id);

CREATE TABLE IF NOT EXISTS character_abilities (
  id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  character_version_id     TEXT NOT NULL REFERENCES character_versions(id) ON DELETE CASCADE,
  ability_id               TEXT NOT NULL REFERENCES abilities(id) ON DELETE RESTRICT,
  proficiency              TEXT NOT NULL DEFAULT 'intermediate' CHECK (proficiency IN ('novice', 'intermediate', 'advanced', 'master', 'godlike')),
  level_notes              TEXT,
  activation_notes         TEXT,
  effective_range_scale_id TEXT REFERENCES stat_scales(id) ON DELETE SET NULL,
  evidence_text            TEXT CHECK (length(evidence_text) <= 400),
  source_id                TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  source_url               TEXT,
  verification_status      TEXT NOT NULL DEFAULT 'imported' CHECK (verification_status IN ('verified', 'imported', 'partially_verified', 'conflicting', 'unknown')),
  confidence               REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (character_version_id, ability_id)
);

CREATE INDEX IF NOT EXISTS idx_char_abilities_version ON character_abilities (character_version_id);
CREATE INDEX IF NOT EXISTS idx_char_abilities_ability ON character_abilities (ability_id);

CREATE TABLE IF NOT EXISTS resistance_types (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  category_id TEXT NOT NULL UNIQUE REFERENCES ability_categories(id) ON DELETE RESTRICT,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS character_resistances (
  id                   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  character_version_id TEXT NOT NULL REFERENCES character_versions(id) ON DELETE CASCADE,
  resistance_type_id   TEXT NOT NULL REFERENCES resistance_types(id) ON DELETE RESTRICT,
  level                INTEGER NOT NULL CHECK (level BETWEEN 0 AND 4),
  level_label          TEXT NOT NULL CHECK (level_label IN ('none', 'limited', 'moderate', 'high', 'absolute')),
  description          TEXT,
  evidence_text        TEXT CHECK (length(evidence_text) <= 400),
  source_id            TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  source_url           TEXT,
  verification_status  TEXT NOT NULL DEFAULT 'imported' CHECK (verification_status IN ('verified', 'imported', 'partially_verified', 'conflicting', 'unknown')),
  confidence           REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (character_version_id, resistance_type_id)
);

CREATE INDEX IF NOT EXISTS idx_char_resist_version ON character_resistances (character_version_id);
CREATE INDEX IF NOT EXISTS idx_char_resist_type ON character_resistances (resistance_type_id);

CREATE TABLE IF NOT EXISTS hax_interactions (
  id                        TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  ability_category_id       TEXT NOT NULL REFERENCES ability_categories(id) ON DELETE CASCADE,
  ability_id                TEXT REFERENCES abilities(id) ON DELETE CASCADE,
  resistance_type_id        TEXT REFERENCES resistance_types(id) ON DELETE CASCADE,
  relation                  TEXT NOT NULL CHECK (relation IN ('effective', 'reduced', 'blocked', 'negated', 'bypasses')),
  effectiveness_multiplier  REAL NOT NULL DEFAULT 1.0 CHECK (effectiveness_multiplier BETWEEN 0 AND 2),
  requires_source_evidence  INTEGER NOT NULL DEFAULT 0,
  notes                     TEXT,
  rule_set_version          TEXT NOT NULL DEFAULT '1.0.0',
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_hax_lookup ON hax_interactions (ability_category_id, resistance_type_id);

-- Padanan `uq_hax_interactions` Postgres: NULL diperlakukan sama lewat
-- coalesce ke UUID nol, sehingga seed ulang tidak menggandakan aturan hax.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hax_interactions
  ON hax_interactions (
    ability_category_id,
    coalesce(ability_id, '00000000-0000-0000-0000-000000000000'),
    coalesce(resistance_type_id, '00000000-0000-0000-0000-000000000000')
  );

-- ---------------------------------------------------------------------------
-- 6. Feats, sumber, konflik, slug redirects
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feats (
  id                   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  character_version_id TEXT NOT NULL REFERENCES character_versions(id) ON DELETE CASCADE,
  feat_type            TEXT NOT NULL,
  description          TEXT NOT NULL,
  significance         TEXT NOT NULL DEFAULT 'supportive' CHECK (significance IN ('minor', 'supportive', 'major', 'decisive')),
  evidence_text        TEXT CHECK (length(evidence_text) <= 400),
  source_id            TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  source_url           TEXT,
  verification_status  TEXT NOT NULL DEFAULT 'imported' CHECK (verification_status IN ('verified', 'imported', 'partially_verified', 'conflicting', 'unknown')),
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS character_sources (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  source_id    TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  source_url   TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'identity' CHECK (role IN ('identity', 'stats', 'abilities', 'resistances', 'feats', 'image')),
  notes        TEXT,
  license      TEXT,
  license_url  TEXT,
  attribution_text TEXT,
  imported_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (character_id, source_id, role)
);

CREATE INDEX IF NOT EXISTS idx_character_sources_char ON character_sources (character_id);
CREATE INDEX IF NOT EXISTS idx_character_sources_source ON character_sources (source_id);

CREATE TABLE IF NOT EXISTS character_source_conflicts (
  id                   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  character_id         TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  character_version_id TEXT REFERENCES character_versions(id) ON DELETE CASCADE,
  field                TEXT NOT NULL,
  value_a              TEXT,
  value_b              TEXT,
  source_a_id          TEXT REFERENCES sources(id) ON DELETE SET NULL,
  source_b_id          TEXT REFERENCES sources(id) ON DELETE SET NULL,
  status               TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'ignored')),
  resolution           TEXT,
  resolved_by          TEXT,
  resolved_at          TEXT,
  detected_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_conflicts_status ON character_source_conflicts (status, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_conflicts_character ON character_source_conflicts (character_id);

CREATE TABLE IF NOT EXISTS merge_candidates (
  id                     TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  character_a_id         TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  character_b_id         TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  similarity_score       REAL NOT NULL CHECK (similarity_score BETWEEN 0 AND 1),
  signals                TEXT NOT NULL DEFAULT '{}',
  status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'merged', 'rejected')),
  resolved_by            TEXT,
  resolved_at            TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (character_a_id, character_b_id),
  CHECK (character_a_id < character_b_id)
);

CREATE TABLE IF NOT EXISTS slug_redirects (
  old_slug      TEXT PRIMARY KEY,
  new_slug      TEXT NOT NULL,
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('character', 'verse', 'version', 'matchup')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (old_slug <> new_slug)
);

-- ---------------------------------------------------------------------------
-- 7. Ingestion
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  source_id       TEXT REFERENCES sources(id) ON DELETE SET NULL,
  scope           TEXT NOT NULL CHECK (scope IN ('incremental', 'scheduled_full', 'manual_run', 'single_character', 'single_verse', 'reparse', 'import_url', 'import_dataset')),
  target_ref      TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'partial', 'failed', 'skipped')),
  priority        INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 9),
  started_at      TEXT,
  completed_at    TEXT,
  next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  retry_count     INTEGER NOT NULL DEFAULT 0,
  max_retries     INTEGER NOT NULL DEFAULT 5,
  http_status     INTEGER,
  parser_version  TEXT,
  error_type      TEXT CHECK (error_type IN ('ParserError', 'SourceUnavailable', 'RateLimited', 'InvalidData', 'DuplicateCharacter', 'MissingRequiredField', 'ImageUnavailable', 'PolicyBlocked')),
  error_message   TEXT,
  records_found   INTEGER NOT NULL DEFAULT 0,
  records_created INTEGER NOT NULL DEFAULT 0,
  records_updated INTEGER NOT NULL DEFAULT 0,
  records_failed  INTEGER NOT NULL DEFAULT 0,
  cursor          TEXT NOT NULL DEFAULT '{}',
  dry_run         INTEGER NOT NULL DEFAULT 0,
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (status NOT IN ('completed', 'partial', 'failed', 'skipped') OR completed_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS ingestion_errors (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  job_id        TEXT NOT NULL REFERENCES ingestion_jobs(id) ON DELETE CASCADE,
  source_url    TEXT,
  error_type    TEXT NOT NULL,
  error_message TEXT NOT NULL,
  http_status   INTEGER,
  payload       TEXT,
  retry_count   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS ingestion_raw_pages (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  job_id         TEXT REFERENCES ingestion_jobs(id) ON DELETE SET NULL,
  source_id      TEXT REFERENCES sources(id) ON DELETE SET NULL,
  source_url     TEXT NOT NULL,
  parsed_json    TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  content_hash   TEXT NOT NULL,
  fetched_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (source_url, content_hash, parser_version)
);

CREATE TABLE IF NOT EXISTS source_snapshots (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  source_id      TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  source_url     TEXT NOT NULL,
  fetched_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  http_status    INTEGER,
  etag           TEXT,
  last_modified  TEXT,
  content_hash   TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  excerpt        TEXT CHECK (length(excerpt) <= 400),
  byte_size      INTEGER,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (source_id, source_url, content_hash)
);

-- ---------------------------------------------------------------------------
-- 8. Battle: Rule Sets, Conditions, Battles, Results, Narratives
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS battle_rule_sets (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  version        TEXT NOT NULL UNIQUE,
  engine_version TEXT NOT NULL DEFAULT 'battle-engine@1.0.0',
  weights        TEXT NOT NULL,
  constants      TEXT NOT NULL,
  active         INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  created_by     TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS battle_conditions (
  id                         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  mode                       TEXT NOT NULL DEFAULT 'standard' CHECK (mode IN ('standard', 'equal_speed', 'in_character', 'bloodlusted', 'random_encounter')),
  speed_equalized            INTEGER NOT NULL DEFAULT 0,
  starting_distance_scale_id TEXT REFERENCES stat_scales(id) ON DELETE SET NULL,
  battlefield                TEXT NOT NULL DEFAULT 'neutral',
  knowledge_level            TEXT NOT NULL DEFAULT 'partial' CHECK (knowledge_level IN ('none', 'partial', 'full')),
  prep_time                  TEXT NOT NULL DEFAULT 'none' CHECK (prep_time IN ('none', 'short', 'extended')),
  win_condition              TEXT NOT NULL DEFAULT 'incapacitation' CHECK (win_condition IN ('ko', 'death', 'incapacitation', 'bfr', 'submission', 'any')),
  conditions_hash            TEXT NOT NULL UNIQUE,
  created_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS battles (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  slug              TEXT NOT NULL,
  side_a_version_id TEXT NOT NULL REFERENCES character_versions(id) ON DELETE RESTRICT,
  side_b_version_id TEXT NOT NULL REFERENCES character_versions(id) ON DELETE RESTRICT,
  conditions_id     TEXT NOT NULL REFERENCES battle_conditions(id) ON DELETE RESTRICT,
  is_public         INTEGER NOT NULL DEFAULT 1,
  share_count       INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (side_a_version_id <> side_b_version_id),
  UNIQUE (side_a_version_id, side_b_version_id, conditions_id)
);

CREATE INDEX IF NOT EXISTS idx_battles_slug ON battles (slug);
CREATE INDEX IF NOT EXISTS idx_battles_recent ON battles (created_at DESC);

CREATE TABLE IF NOT EXISTS battle_results (
  id                   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  battle_id            TEXT NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  winner               TEXT NOT NULL CHECK (winner IN ('a', 'b', 'draw', 'insufficient_data')),
  win_probability_a    REAL NOT NULL CHECK (win_probability_a BETWEEN 0 AND 1),
  win_probability_b    REAL NOT NULL CHECK (win_probability_b BETWEEN 0 AND 1),
  confidence           REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  difficulty           TEXT NOT NULL CHECK (difficulty IN ('low', 'mid', 'high', 'extreme')),
  battle_length        TEXT NOT NULL CHECK (battle_length IN ('short', 'medium', 'long')),
  score_breakdown      TEXT NOT NULL DEFAULT '[]',
  decisive_edges       TEXT NOT NULL DEFAULT '[]',
  primary_reason       TEXT NOT NULL,
  secondary_factors    TEXT NOT NULL DEFAULT '[]',
  critical_counter     TEXT,
  potential_scenario   TEXT,
  limitations          TEXT NOT NULL DEFAULT '[]',
  assumptions          TEXT NOT NULL DEFAULT '[]',
  reasoning_refs       TEXT NOT NULL DEFAULT '{}',
  input_hash           TEXT NOT NULL UNIQUE,
  engine_version       TEXT NOT NULL,
  rule_set_version     TEXT NOT NULL REFERENCES battle_rule_sets(version) ON DELETE RESTRICT,
  rule_set_id          TEXT NOT NULL REFERENCES battle_rule_sets(id) ON DELETE RESTRICT,
  computed_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  cached_until         TEXT NOT NULL,
  result_payload       TEXT
);

CREATE INDEX IF NOT EXISTS idx_battle_results_battle ON battle_results (battle_id);
CREATE INDEX IF NOT EXISTS idx_battle_results_recent ON battle_results (computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_battle_results_cache ON battle_results (input_hash, cached_until);

CREATE TABLE IF NOT EXISTS battle_narratives (
  id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  battle_id          TEXT NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  model              TEXT NOT NULL,
  prompt_version     TEXT NOT NULL,
  narrative          TEXT NOT NULL,
  citation_coverage  REAL CHECK (citation_coverage BETWEEN 0 AND 1),
  fact_check_passed  INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------------
-- 9. Users, Roles, Favorites, Analytics, Audit, Laporan
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  display_name TEXT,
  locale       TEXT DEFAULT 'id',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS user_roles (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('viewer', 'curator', 'admin', 'owner', 'editor')),
  granted_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, role)
);

CREATE TABLE IF NOT EXISTS favorites (
  id                   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_version_id TEXT REFERENCES character_versions(id) ON DELETE CASCADE,
  battle_id            TEXT REFERENCES battles(id) ON DELETE CASCADE,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((character_version_id IS NULL) <> (battle_id IS NULL))
);

-- Satu favorit per (user, target); target bisa form atau battle, jadi kolom
-- yang tidak dipakai dinormalkan ke UUID nol seperti versi Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS uq_favorites_target
  ON favorites (
    user_id,
    coalesce(character_version_id, '00000000-0000-0000-0000-000000000000'),
    coalesce(battle_id, '00000000-0000-0000-0000-000000000000')
  );

-- Hanya boleh ada satu rule set aktif pada satu waktu.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rule_set_active
  ON battle_rule_sets (active)
  WHERE active = 1;

CREATE TABLE IF NOT EXISTS analytics_events (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  name        TEXT NOT NULL,
  props       TEXT NOT NULL DEFAULT '{}',
  actor_hash  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  actor_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  before      TEXT,
  after       TEXT,
  ip_hash     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS data_reports (
  id                   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  character_id         TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  character_version_id TEXT REFERENCES character_versions(id) ON DELETE CASCADE,
  field                TEXT,
  reason_category      TEXT NOT NULL,
  details              TEXT,
  proposed_source_url  TEXT,
  status               TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'accepted', 'rejected')),
  report_count         INTEGER NOT NULL DEFAULT 1,
  reviewed_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at          TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS legal_reports (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  ticket_code    TEXT NOT NULL UNIQUE,
  kind           TEXT NOT NULL DEFAULT 'takedown' CHECK (kind IN ('takedown', 'privacy', 'other')),
  reporter_name  TEXT NOT NULL CHECK (length(reporter_name) BETWEEN 2 AND 120),
  reporter_email TEXT NOT NULL,
  reported_url   TEXT NOT NULL CHECK (length(reported_url) <= 2048),
  description    TEXT NOT NULL CHECK (length(description) BETWEEN 20 AND 5000),
  good_faith     INTEGER NOT NULL CHECK (good_faith = 1),
  status         TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'accepted', 'rejected')),
  reviewed_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at    TEXT,
  resolution_note TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------------
-- 10. Rate limiting terdistribusi
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limit_windows (
  bucket       TEXT NOT NULL,
  window_start TEXT NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 0 CHECK (hits >= 0),
  PRIMARY KEY (bucket, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_windows_start ON rate_limit_windows (window_start);

-- ---------------------------------------------------------------------------
-- 11. SQLite Standard Views (Pengganti Materialized Views PostgreSQL)
-- ---------------------------------------------------------------------------

-- Distribusi tier per verse (halaman verse + homepage)
DROP VIEW IF EXISTS mv_verse_tier_distribution;
CREATE VIEW mv_verse_tier_distribution AS
SELECT c.verse_id,
       cv.tier_id,
       t.tier_code,
       t.numerical_rank,
       count(distinct c.id) AS character_count,
       count(cv.id)         AS form_count
  FROM character_versions cv
  JOIN characters c ON c.id = cv.character_id
  JOIN tiers t ON t.id = cv.tier_id
 WHERE cv.deleted_at IS NULL
 GROUP BY c.verse_id, cv.tier_id, t.tier_code, t.numerical_rank;

-- Matchup populer (Popular Battles)
DROP VIEW IF EXISTS mv_battle_popularity;
CREATE VIEW mv_battle_popularity AS
SELECT b.slug                          AS matchup_key,
       b.side_a_version_id,
       b.side_b_version_id,
       count(br.id)                    AS simulations,
       coalesce(sum(b.share_count), 0) AS share_count,
       max(br.computed_at)             AS last_simulated_at,
       count(distinct br.winner)       AS distinct_winners
  FROM battles b
  JOIN battle_results br ON br.battle_id = b.id
 GROUP BY b.slug, b.side_a_version_id, b.side_b_version_id;

-- Pencarian karakter agregat
DROP VIEW IF EXISTS mv_character_search;
CREATE VIEW mv_character_search AS
SELECT c.id,
       c.slug,
       c.name,
       c.native_name,
       c.popularity_score,
       c.data_completeness,
       v.slug AS verse_slug,
       v.name AS verse_name,
       (SELECT group_concat(a.alias, ' ') FROM character_aliases a WHERE a.character_id = c.id) AS aliases,
       (SELECT max(t.numerical_rank)
          FROM character_versions cv JOIN tiers t ON t.id = cv.tier_id
         WHERE cv.character_id = c.id AND cv.deleted_at IS NULL) AS max_tier_rank
  FROM characters c
  JOIN verses v ON v.id = c.verse_id;

-- ---------------------------------------------------------------------------
-- 12. Trigger (padanan docs/schema.sql)
--
-- SQLite tidak punya fungsi yang dapat didefinisikan pengguna, jadi setiap
-- trigger Postgres ditulis ulang sebagai trigger per tabel. Semantiknya sama:
-- updated_at otomatis, statistik lama di-supersede, cache kolom stat di
-- character_versions disinkronkan, cache battle dikedaluwarsakan, dan
-- fingerprint duplikat karakter dihitung.
-- ---------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS trg_sources_updated AFTER UPDATE ON sources
  FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE sources SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_stat_scale_metrics_updated AFTER UPDATE ON stat_scale_metrics
  FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE stat_scale_metrics SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_stat_scales_updated AFTER UPDATE ON stat_scales
  FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE stat_scales SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_tiers_updated AFTER UPDATE ON tiers
  FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE tiers SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_verses_updated AFTER UPDATE ON verses
  FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE verses SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_characters_updated AFTER UPDATE ON characters
  FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE characters SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_character_versions_updated AFTER UPDATE ON character_versions
  FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE character_versions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_equipment_updated AFTER UPDATE ON equipment
  FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE equipment SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_statistics_updated AFTER UPDATE ON statistics
  FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE statistics SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_ability_categories_updated AFTER UPDATE ON ability_categories
  FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE ability_categories SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_abilities_updated AFTER UPDATE ON abilities
  FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE abilities SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_character_abilities_updated AFTER UPDATE ON character_abilities
  FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE character_abilities SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_resistance_types_updated AFTER UPDATE ON resistance_types
  FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE resistance_types SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_character_resistances_updated AFTER UPDATE ON character_resistances
  FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE character_resistances SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_hax_interactions_updated AFTER UPDATE ON hax_interactions
  FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE hax_interactions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_feats_updated AFTER UPDATE ON feats
  FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE feats SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_ingestion_jobs_updated AFTER UPDATE ON ingestion_jobs
  FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE ingestion_jobs SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_battle_rule_sets_updated AFTER UPDATE ON battle_rule_sets
  FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE battle_rule_sets SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_battles_updated AFTER UPDATE ON battles
  FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE battles SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_users_updated AFTER UPDATE ON users
  FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

-- Statistik baru untuk (form, metrik, sumber) yang sama menandai baris lama
-- 'superseded' — tidak menimpa, tidak menghapus (D6, AC-17).
CREATE TRIGGER IF NOT EXISTS trg_statistics_supersede
  AFTER INSERT ON statistics
  FOR EACH ROW WHEN NEW.status = 'current'
BEGIN
  UPDATE statistics
     SET status = 'superseded',
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE character_version_id = NEW.character_version_id
     AND metric = NEW.metric
     AND source_id = NEW.source_id
     AND status = 'current'
     AND id <> NEW.id;
END;

-- Cache kolom stat di character_versions (D7). Sumber kebenaran tetap
-- `statistics`; kolom ini hanya untuk filter/sort.
CREATE TRIGGER IF NOT EXISTS trg_statistics_sync_cache
  AFTER INSERT ON statistics
  FOR EACH ROW
BEGIN
  UPDATE character_versions SET
    tier_id = CASE WHEN NEW.metric = 'tier' THEN (
      SELECT t.id FROM statistics s JOIN tiers t ON t.tier_code = s.raw_text
       WHERE s.character_version_id = NEW.character_version_id
         AND s.metric = 'tier' AND s.status = 'current'
       ORDER BY s.confidence DESC, s.created_at DESC LIMIT 1)
      ELSE tier_id END,
    attack_potency_scale_id = CASE WHEN NEW.metric = 'attack_potency' THEN NEW.scale_id ELSE attack_potency_scale_id END,
    durability_scale_id     = CASE WHEN NEW.metric = 'durability' THEN NEW.scale_id ELSE durability_scale_id END,
    striking_scale_id       = CASE WHEN NEW.metric = 'striking_strength' THEN NEW.scale_id ELSE striking_scale_id END,
    lifting_scale_id        = CASE WHEN NEW.metric = 'lifting_strength' THEN NEW.scale_id ELSE lifting_scale_id END,
    speed_scale_id          = CASE WHEN NEW.metric = 'speed' THEN NEW.scale_id ELSE speed_scale_id END,
    reaction_speed_scale_id = CASE WHEN NEW.metric = 'reaction_speed' THEN NEW.scale_id ELSE reaction_speed_scale_id END,
    combat_speed_scale_id   = CASE WHEN NEW.metric = 'combat_speed' THEN NEW.scale_id ELSE combat_speed_scale_id END,
    range_scale_id          = CASE WHEN NEW.metric = 'range' THEN NEW.scale_id ELSE range_scale_id END,
    stamina_scale_id        = CASE WHEN NEW.metric = 'stamina' THEN NEW.scale_id ELSE stamina_scale_id END,
    intelligence_scale_id   = CASE WHEN NEW.metric = 'intelligence' THEN NEW.scale_id ELSE intelligence_scale_id END,
    battle_iq_scale_id      = CASE WHEN NEW.metric = 'battle_iq' THEN NEW.scale_id ELSE battle_iq_scale_id END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE id = NEW.character_version_id;
END;

-- Fingerprint duplikat (PRD §21.2). SQLite tidak punya sha1(), jadi nilai
-- disimpan sebagai kunci ternormalisasi deterministik — tujuan kolom ini
-- (mendeteksi nama+verse yang sama) tetap tercapai dan dapat dihitung ulang.
CREATE TRIGGER IF NOT EXISTS trg_characters_fingerprint
  AFTER INSERT ON characters
  FOR EACH ROW
BEGIN
  UPDATE characters
     SET fp_key = lower(trim(NEW.name)) || '|' || coalesce((SELECT slug FROM verses WHERE id = NEW.verse_id), '-')
   WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_characters_fingerprint_update
  AFTER UPDATE OF name, verse_id ON characters
  FOR EACH ROW
BEGIN
  UPDATE characters
     SET fp_key = lower(trim(NEW.name)) || '|' || coalesce((SELECT slug FROM verses WHERE id = NEW.verse_id), '-')
   WHERE id = NEW.id;
END;

-- Koreksi statistik/ability/resistance/trait/form harus terlihat sebelum TTL
-- cache 7 hari habis: baris lama ditandai kedaluwarsa, bukan dihapus (audit).
CREATE TRIGGER IF NOT EXISTS trg_statistics_invalidate_cache
  AFTER INSERT ON statistics
  FOR EACH ROW
BEGIN
  UPDATE battle_results SET cached_until = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE cached_until > strftime('%Y-%m-%dT%H:%M:%fZ','now')
     AND EXISTS (SELECT 1 FROM battles b WHERE b.id = battle_results.battle_id
                  AND (b.side_a_version_id = NEW.character_version_id
                       OR b.side_b_version_id = NEW.character_version_id));
END;

CREATE TRIGGER IF NOT EXISTS trg_char_abilities_invalidate_cache
  AFTER INSERT ON character_abilities
  FOR EACH ROW
BEGIN
  UPDATE battle_results SET cached_until = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE cached_until > strftime('%Y-%m-%dT%H:%M:%fZ','now')
     AND EXISTS (SELECT 1 FROM battles b WHERE b.id = battle_results.battle_id
                  AND (b.side_a_version_id = NEW.character_version_id
                       OR b.side_b_version_id = NEW.character_version_id));
END;

CREATE TRIGGER IF NOT EXISTS trg_char_resist_invalidate_cache
  AFTER INSERT ON character_resistances
  FOR EACH ROW
BEGIN
  UPDATE battle_results SET cached_until = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE cached_until > strftime('%Y-%m-%dT%H:%M:%fZ','now')
     AND EXISTS (SELECT 1 FROM battles b WHERE b.id = battle_results.battle_id
                  AND (b.side_a_version_id = NEW.character_version_id
                       OR b.side_b_version_id = NEW.character_version_id));
END;

CREATE TRIGGER IF NOT EXISTS trg_char_traits_invalidate_cache
  AFTER INSERT ON character_traits
  FOR EACH ROW
BEGIN
  UPDATE battle_results SET cached_until = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE cached_until > strftime('%Y-%m-%dT%H:%M:%fZ','now')
     AND EXISTS (SELECT 1 FROM battles b WHERE b.id = battle_results.battle_id
                  AND (b.side_a_version_id = NEW.character_version_id
                       OR b.side_b_version_id = NEW.character_version_id));
END;

CREATE TRIGGER IF NOT EXISTS trg_versions_invalidate_cache
  AFTER UPDATE ON character_versions
  FOR EACH ROW
BEGIN
  UPDATE battle_results SET cached_until = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE cached_until > strftime('%Y-%m-%dT%H:%M:%fZ','now')
     AND EXISTS (SELECT 1 FROM battles b WHERE b.id = battle_results.battle_id
                  AND (b.side_a_version_id = NEW.id OR b.side_b_version_id = NEW.id));
END;
