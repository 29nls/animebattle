/**
 * Kontrak tipe engine pertarungan.
 *
 * Sumber kebenaran istilah & aturan: docs/PRD.md §13 (stat), §15 (resistensi),
 * §16 (engine berlapis), §17 (perhitungan), serta docs/APPENDICES.md lampiran D.
 *
 * Aturan modul ini: hanya tipe, tanpa nilai runtime. Semua impor tipe WAJIB
 * memakai `import type` karena Node menjalankan TypeScript dengan type stripping
 * (bukan transform), dan `verbatimModuleSyntax` menegakkannya.
 */

/** Sisi pertarungan. Dipakai untuk menamai suasana dalam hasil. */
export type Side = 'a' | 'b';

/** Metrik stat kanonik, sejajar `stat_scale_metrics.metric` di database. */
export type StatMetric =
  | 'tier'
  | 'attack_potency'
  | 'durability'
  | 'striking_strength'
  | 'lifting_strength'
  | 'speed'
  | 'reaction_speed'
  | 'combat_speed'
  | 'range'
  | 'stamina'
  | 'intelligence'
  | 'battle_iq'
  | 'experience';

/**
 * Metrik ordinal ber-rank: dibandingkan lewat skala (bukan angka mentah).
 *
 * Catatan: `striking_strength` dan `lifting_strength` termasuk metrik ber-rank
 * (punya skala), tetapi TIDAK diberi bobot pada rule set default — keduanya
 * informatif dan dipakai pada halaman perbandingan, bukan penentu hasil.
 */
export type RankMetric =
  | 'tier'
  | 'attack_potency'
  | 'durability'
  | 'striking_strength'
  | 'lifting_strength'
  | 'speed'
  | 'reaction_speed'
  | 'combat_speed'
  | 'range'
  | 'stamina'
  | 'intelligence'
  | 'battle_iq';

export const RANK_METRICS = [
  'tier',
  'attack_potency',
  'durability',
  'striking_strength',
  'lifting_strength',
  'speed',
  'reaction_speed',
  'combat_speed',
  'range',
  'stamina',
  'intelligence',
  'battle_iq',
] as const satisfies readonly RankMetric[];

/** Kunci yang memerlukan span normalisasi (semua metrik ber-rank + pengalaman). */
export type SpanKey = RankMetric | 'experience';

/** Metrik yang wajib ada agar pertarungan dapat dihitung (Layer 0). */
export const REQUIRED_METRICS = [
  'tier',
  'attack_potency',
  'durability',
  'speed',
] as const satisfies readonly StatMetric[];

/** Bobot engine, sejajar kunci `battle_rule_sets.weights`. */
export type WeightKey =
  | 'tier'
  | 'attack_potency'
  | 'durability'
  | 'speed'
  | 'reaction_speed'
  | 'combat_speed'
  | 'range'
  | 'stamina'
  | 'intelligence'
  | 'battle_iq'
  | 'experience'
  | 'abilities'
  | 'hax'
  | 'resistances';

/** Kualifikasi klaim (§12.3). Mempengaruhi bobot & kepercayaan. */
export type Qualifier =
  | 'exact'
  | 'at_least'
  | 'at_most'
  | 'possibly'
  | 'likely'
  | 'up_to'
  | 'higher_with'
  | 'far_higher_with'
  | 'varies'
  | 'unknown';

export type ActivationSpeed = 'instant' | 'fast' | 'moderate' | 'slow' | 'triggered';
export type Proficiency = 'novice' | 'intermediate' | 'advanced' | 'master' | 'godlike';
export type ResistanceLevelLabel = 'none' | 'limited' | 'moderate' | 'high' | 'absolute';
export type VerificationStatus =
  | 'verified'
  | 'imported'
  | 'partially_verified'
  | 'conflicting'
  | 'unknown';
export type DataCompleteness = 'complete' | 'partial' | 'minimal';
export type MediaType = 'manga' | 'anime' | 'game' | 'novel' | 'comic' | 'movie' | 'mixed' | 'other';
export type CharacterTrait =
  | 'aggressive'
  | 'holds_back'
  | 'tactical'
  | 'reckless'
  | 'talkative'
  | 'measured';

/** Nilai metrik per form. `null` = tidak didokumentasikan (bukan nol). */
export type MetricValues = Record<StatMetric, number | null>;

export interface SideStatistics {
  metric: StatMetric;
  /** Teks asli dari sumber; dipertahankan tanpa normalisasi (aturan SR-1). */
  raw_text: string;
  qualifier: Qualifier;
  scale_rank: number | null;
  confidence: number;
  source_id: string | null;
  status: 'current' | 'superseded' | 'conflicting';
}

export interface SideAbility {
  id: string;
  name: string;
  /** Slug kategori katalog ability (kunci pencocokan rule engine). */
  category_slug: string;
  /** Kategori bersifat negasi (mis. Existence Erasure) → attack level 'absolute'. */
  category_is_negation: boolean;
  activation_speed: ActivationSpeed;
  is_offensive: boolean;
  is_passive: boolean;
  is_prep_required: boolean;
  proficiency: Proficiency;
  confidence: number;
  /** Jangkauan efektif ability pada skala range; null = mengikuti range form. */
  effective_range_rank?: number | null;
}

export interface SideResistance {
  resistance_type_id: string;
  /** Kategori ability yang ditahan (kunci pencocokan rule engine). */
  category_slug: string;
  level: 0 | 1 | 2 | 3 | 4;
  level_label: ResistanceLevelLabel;
  verification_status: VerificationStatus;
  confidence: number;
}

/** Satu sisi pertarungan: bentuk yang dihasilkan RPC `battle_dataset`. */
export interface SideData {
  version_id: string;
  character: { id: string; slug: string; name: string };
  verse: { id: string; slug: string; name: string };
  form: {
    id: string;
    slug: string;
    name: string;
    era: string | null;
    data_completeness: DataCompleteness;
    media_type: MediaType;
  };
  tier: { code: string | null; rank: number | null; rankable: boolean };
  metrics: MetricValues;
  /** Metrik yang berada di rezim non-fisik (mis. FTL) → tidak dibandingkan secara energi. */
  nonphysical_metrics: StatMetric[];
  statistics: SideStatistics[];
  abilities: SideAbility[];
  resistances: SideResistance[];
  traits: CharacterTrait[];
}

export type BattleMode =
  | 'standard'
  | 'equal_speed'
  | 'in_character'
  | 'bloodlusted'
  | 'random_encounter';
export type KnowledgeLevel = 'none' | 'partial' | 'full';
export type PrepTime = 'none' | 'short' | 'extended';
export type WinCondition = 'ko' | 'death' | 'incapacitation' | 'bfr' | 'submission' | 'any';
export type Battlefield = 'neutral' | 'open' | 'enclosed' | 'urban' | 'void';

export interface BattleConditions {
  mode: BattleMode;
  speed_equalized: boolean;
  /** Rank pada skala range; bila diisi, ability di luar jangkauan menjadi tidak aktif. */
  starting_distance_rank: number | null;
  battlefield: Battlefield;
  knowledge_level: KnowledgeLevel;
  prep_time: PrepTime;
  win_condition: WinCondition;
}

/** Aturan interaksi hax; cermin dari tabel `hax_interactions`. */
export interface HaxRule {
  ability_category_slug: string;
  resistance_category_slug: string;
  relation: 'effective' | 'reduced' | 'blocked' | 'negated' | 'bypasses';
  effectiveness_multiplier: number;
  requires_source_evidence: boolean;
  notes?: string;
}

export interface RuleSetConstants {
  logistic_k: number;
  /** Span normalisasi per metrik ber-rank (PRD §17.1). */
  normalization_spans: Record<SpanKey, number>;
  dominance_gate: {
    enabled: boolean;
    tier_delta: number;
    durability_delta: number;
    speed_delta: number;
    min_probability: number;
    requires_no_relevant_resistance: boolean;
  };
  decisive_edge: {
    enabled: boolean;
    min_effectiveness: number;
    single_edge_probability_floor: number;
    mutual_edge_probability_clamp: [number, number];
  };
  qualifier_penalty: Record<Qualifier, number>;
  confidence: {
    base: number;
    per_missing_metric: number;
    per_missing_ability_data: number;
    qualifier_heavy_threshold: number;
    qualifier_heavy_penalty: number;
    per_unresolved_conflict: number;
    floor: number;
    low_confidence_banner_threshold: number;
  };
  difficulty_thresholds: { low: number; mid: number; high: number };
  condition_modifiers: {
    equal_speed_zeroes_speed_metric: boolean;
    in_character_activation_penalty: number;
    bloodlusted_hax_multiplier: number;
    random_encounter_battle_iq_multiplier: number;
    knowledge_full_counter_multiplier: number;
    knowledge_none_counter_multiplier: number;
    prep_time_extended_bonus: number;
  };
  /**
   * Pemetaan kategori ability → win condition yang dapat dipenuhinya.
   * `_default` dipakai untuk kategori yang tidak disebut (jadi admin cukup
   * menuliskan pengecualian, bukan seluruh katalog).
   */
  win_condition_map: Record<string, WinCondition[]>;
}

export interface RuleSet {
  version: string;
  engine_version: string;
  weights: Record<WeightKey, number>;
  constants: RuleSetConstants;
  hax_rules: HaxRule[];
}

export interface BattleInput {
  side_a: SideData;
  side_b: SideData;
  conditions: BattleConditions;
  rule_set_version?: string;
}

/** Kontribusi satu metrik pada skor terbobot (dapat diaudit). */
export interface ScoreContribution {
  metric: WeightKey;
  /** Nilai ternormalisasi untuk sisi A pada rentang [-1, 1]. */
  a_value: number;
  weight: number;
  contribution: number;
  /** Alasan nilai di-nolkan/diredam (mis. metrik tidak terdokumentasi). */
  note: string | null;
}

export interface DecisiveEdge {
  id: string;
  side: Side;
  ability_id: string;
  ability_name: string;
  category_slug: string;
  status: 'effective' | 'reduced' | 'blocked' | 'negated' | 'bypasses' | 'inactive';
  effectiveness: number;
  /** Alasan bila tidak aktif (mis. di luar jangkauan). */
  inactive_reason: string | null;
  /** Resistensi lawan yang menahan ability ini, bila ada. */
  blocked_by: { resistance_type_id: string; level_label: ResistanceLevelLabel } | null;
  /** Win condition yang terpenuhi, bila ada. */
  satisfies_win_condition: boolean;
  decisive: boolean;
  delta_ranks: number;
}

export interface AbilityOutcome {
  side: Side;
  ability_id: string;
  ability_name: string;
  category_slug: string;
  attack_level: 'weak' | 'medium' | 'strong' | 'absolute';
  status: DecisiveEdge['status'];
  effectiveness: number;
  inactive_reason: string | null;
  resistance_level_label: ResistanceLevelLabel | null;
  resistance_sourced: boolean;
  satisfies_win_condition: boolean;
  decisive: boolean;
  rule_applied: HaxRule | null;
  notes: string[];
}

export interface ReasoningItem {
  text: string;
  /** Rujukan terstruktur untuk validator RG-1 (metric:*, edge:*, limitation:*, assumption:*, condition:*). */
  refs: string[];
}

/**
 * Reasoning dalam bentuk yang disimpan/ditampilkan. Nama kunci mengikuti kolom
 * database (`critical_counter`), sehingga hasil engine dapat dipetakan tanpa
 * penerjemahan nama di lapisan API.
 */
export interface BattleReasoning {
  primary: ReasoningItem;
  secondary: ReasoningItem[];
  critical_counter: ReasoningItem;
  scenario: ReasoningItem;
}

export interface BattleResult {
  // Keluaran wajib (§16.5)
  battle_id: string;
  input_hash: string;
  engine_version: string;
  rule_set_version: string;
  winner: 'a' | 'b' | 'draw' | 'insufficient_data';
  win_probability: { a: number; b: number };
  confidence: number;
  low_confidence: boolean;
  difficulty: 'low' | 'mid' | 'high' | 'extreme';
  battle_length: 'short' | 'medium' | 'long';
  // Analisis
  decisive_edges: DecisiveEdge[];
  ability_outcomes: AbilityOutcome[];
  score_breakdown: ScoreContribution[];
  /** S = Σ w_i·a_i / 100 sebelum transformasi logistik. */
  weighted_score: number;
  /** Hasil Layer 1 beserta alasan bila tidak diterapkan (untuk audit). */
  dominance: {
    applies: boolean;
    dominant_side: Side | null;
    tier_delta: number;
    durability_delta: number;
    speed_delta: number;
    blocked_by: string | null;
  };
  /** Rasio cakupan resistensi terhadap kemampuan ofensif lawan. */
  coverage: { a: number; b: number };
  // Narasi deterministik + rujukan yang dapat diverifikasi
  primary_reason: string;
  secondary_factors: string[];
  critical_counter: string;
  potential_scenario: string;
  /** Bentuk tersimpan; validasi RG-1 memakai struktur ini. */
  reasoning: BattleReasoning;
  limitations: string[];
  assumptions: string[];
  disclaimer: string;
}

export const DISCLAIMER =
  'Battle outcomes are calculated from available statistics, abilities, resistances, assumptions, and selected conditions. Hasil bersifat simulasi/analitis, bukan hasil resmi dan bukan klaim kanon.';
