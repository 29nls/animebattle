/**
 * Fixture bertipe untuk unit test engine.
 *
 * Kenapa factory TypeScript, bukan JSON seperti case library: `SideData` adalah
 * kontrak keluaran RPC `battle_dataset`. Dengan menyusun fixture lewat tipe itu,
 * `npm run typecheck` menangkap fixture yang tidak sah (nama enum salah, field
 * hilang, satuan tertukar) sebelum satu test pun berjalan — sesuatu yang tidak
 * dapat dilakukan berkas JSON pada case library.
 *
 * Default sengaja lengkap dan seimbang supaya setiap test hanya menyebut field
 * yang benar-benar sedang diujinya; kegagalan karenanya menunjuk tepat ke
 * perilaku yang diperiksa, bukan ke fixture yang kebetulan kurang.
 *
 * Pembatasan I/O: hanya satu tempat di file ini yang menyentuh disk, yaitu
 * `defaultRuleSet`. Seluruh factory (side, ability, dsb.) murni dan tidak boleh
 * melakukan I/O.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateRuleSet } from '../../src/services/battle/rule-set.ts';
import type {
  AbilityOutcome,
  BattleConditions,
  BattleInput,
  CharacterTrait,
  DecisiveEdge,
  MetricValues,
  RuleSet,
  RuleSetConstants,
  SideAbility,
  SideData,
  SideResistance,
  SideStatistics,
  StatMetric,
} from '../../src/services/battle/types.ts';

const RULE_SET_PATH = fileURLToPath(
  new URL('../../src/services/battle/fixtures/rule-set.default.json', import.meta.url),
);

/**
 * Rule set default, dimuat dari fixture yang sama dengan case library.
 *
 * Cast `as RuleSet` dipakai karena TypeScript tidak dapat membuktikan bentuk
 * berkas JSON. Gantinya fixture dilewatkan validator engine sendiri, sehingga
 * berkas yang rusak menggagalkan seluruh suite dengan pesan yang jelas alih-alih
 * menghasilkan test yang tampak lulus.
 *
 * Dipanggil sekali di level modul. Ini satu-satunya I/O di file ini.
 */
export const defaultRuleSet: RuleSet = (() => {
  const parsed: unknown = JSON.parse(readFileSync(RULE_SET_PATH, 'utf8'));
  const candidate = parsed as RuleSet;
  const problems = validateRuleSet(candidate);
  if (problems.length > 0) {
    throw new Error(`rule-set.default.json tidak sah: ${problems.join('; ')}`);
  }
  return candidate;
})();

/** Salinan dangkal rule set, supaya test tidak mengubah fixture bersama. */
export function ruleSetWith(overrides: Partial<RuleSet> = {}): RuleSet {
  return { ...defaultRuleSet, ...overrides };
}

/** Salinan rule set dengan sebagian konstanta ditimpa. */
export function ruleSetWithConstants(overrides: Partial<RuleSetConstants>): RuleSet {
  return {
    ...defaultRuleSet,
    constants: { ...defaultRuleSet.constants, ...overrides },
  };
}

const DEFAULT_RANK = 20;
const DEFAULT_EXPERIENCE_YEARS = 10;

export function metrics(overrides: Partial<MetricValues> = {}): MetricValues {
  return {
    tier: DEFAULT_RANK,
    attack_potency: DEFAULT_RANK,
    durability: DEFAULT_RANK,
    striking_strength: DEFAULT_RANK,
    lifting_strength: DEFAULT_RANK,
    speed: DEFAULT_RANK,
    reaction_speed: DEFAULT_RANK,
    combat_speed: DEFAULT_RANK,
    range: DEFAULT_RANK,
    stamina: DEFAULT_RANK,
    intelligence: DEFAULT_RANK,
    battle_iq: DEFAULT_RANK,
    experience: DEFAULT_EXPERIENCE_YEARS,
    ...overrides,
  };
}

export interface SideOptions {
  version_id?: string;
  name?: string;
  /** `null` = tier tidak terdokumentasi; `rankable: false` = tier bukan skala. */
  tierRank?: number | null;
  rankable?: boolean;
  metrics?: Partial<MetricValues>;
  statistics?: SideStatistics[];
  abilities?: SideAbility[];
  resistances?: SideResistance[];
  traits?: CharacterTrait[];
  nonphysical_metrics?: StatMetric[];
}

export function side(options: SideOptions = {}): SideData {
  const versionId = options.version_id ?? 'ver_test_a';
  const name = options.name ?? 'Character A';
  const tierRank = options.tierRank === undefined ? DEFAULT_RANK : options.tierRank;
  const slug = versionId.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

  return {
    version_id: versionId,
    character: { id: `char_${slug}`, slug, name },
    verse: { id: 'verse_test', slug: 'test-verse', name: 'Test Verse' },
    form: {
      id: `form_${slug}`,
      slug: `form-${slug}`,
      name: `${name} (bentuk default)`,
      era: null,
      data_completeness: 'complete',
      media_type: 'manga',
    },
    tier: {
      code: tierRank === null ? null : `tier_${tierRank}`,
      rank: tierRank,
      rankable: options.rankable ?? tierRank !== null,
    },
    metrics: metrics({ tier: tierRank, ...options.metrics }),
    nonphysical_metrics: options.nonphysical_metrics ?? [],
    statistics: options.statistics ?? [],
    abilities: options.abilities ?? [],
    resistances: options.resistances ?? [],
    traits: options.traits ?? [],
  };
}

export function ability(overrides: Partial<SideAbility> = {}): SideAbility {
  return {
    id: 'ab_test_1',
    name: 'Test Ability',
    category_slug: 'mind-manipulation',
    category_is_negation: false,
    activation_speed: 'instant',
    is_offensive: true,
    is_passive: false,
    is_prep_required: false,
    proficiency: 'advanced',
    confidence: 1,
    effective_range_rank: null,
    ...overrides,
  };
}

export function resistance(overrides: Partial<SideResistance> = {}): SideResistance {
  return {
    resistance_type_id: 'rt_test_1',
    category_slug: 'mind-manipulation',
    level: 2,
    level_label: 'moderate',
    verification_status: 'imported',
    confidence: 0.8,
    ...overrides,
  };
}

export function stat(overrides: Partial<SideStatistics> = {}): SideStatistics {
  return {
    metric: 'speed',
    raw_text: 'klaim kecepatan',
    qualifier: 'exact',
    scale_rank: null,
    confidence: 0.8,
    source_id: 'src_test',
    status: 'current',
    ...overrides,
  };
}

export function conditions(overrides: Partial<BattleConditions> = {}): BattleConditions {
  return {
    mode: 'standard',
    speed_equalized: false,
    starting_distance_rank: null,
    battlefield: 'neutral',
    knowledge_level: 'partial',
    prep_time: 'none',
    win_condition: 'incapacitation',
    ...overrides,
  };
}

export function outcome(overrides: Partial<AbilityOutcome> = {}): AbilityOutcome {
  return {
    side: 'a',
    ability_id: 'ab_test_1',
    ability_name: 'Test Ability',
    category_slug: 'mind-manipulation',
    attack_level: 'strong',
    status: 'effective',
    effectiveness: 1,
    inactive_reason: null,
    resistance_level_label: null,
    resistance_sourced: false,
    satisfies_win_condition: true,
    decisive: true,
    rule_applied: null,
    notes: [],
    ...overrides,
  };
}

export function edge(overrides: Partial<DecisiveEdge> = {}): DecisiveEdge {
  return {
    id: 'a:mind-manipulation:ab_test_1',
    side: 'a',
    ability_id: 'ab_test_1',
    ability_name: 'Test Ability',
    category_slug: 'mind-manipulation',
    status: 'effective',
    effectiveness: 1,
    inactive_reason: null,
    blocked_by: null,
    satisfies_win_condition: true,
    decisive: true,
    delta_ranks: 0,
    ...overrides,
  };
}

/** Sisi A yang jelas lebih kuat tanpa memicu dominance gate (tier Δ6, durability Δ4). */
export function strongerSideA(): SideData {
  return side({
    version_id: 'ver_strong_a',
    name: 'Character A',
    tierRank: 26,
    metrics: {
      attack_potency: 26,
      durability: 24,
      speed: 26,
      reaction_speed: 26,
      combat_speed: 26,
      range: 26,
      stamina: 26,
      intelligence: 26,
      battle_iq: 26,
      experience: 30,
    },
  });
}

export function weakerSideB(): SideData {
  return side({ version_id: 'ver_weak_b', name: 'Character B', tierRank: 20 });
}

export function battleInput(
  sideA: SideData,
  sideB: SideData,
  overrides: Partial<BattleConditions> = {},
): BattleInput {
  return { side_a: sideA, side_b: sideB, conditions: conditions(overrides) };
}
