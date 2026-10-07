/**
 * Hax interaction engine (PRD §15.3, §16.3 Layer 2, §12).
 *
 * Alur: ABILITY → TARGET → RESISTANCE → COUNTER → SUCCESS PROBABILITY.
 *
 * Yang menentukan hasil bukan hanya angka statistik, melainkan apakah sebuah
 * ability (a) dapat aktif sebelum lawan bertindak, (b) ditahan oleh resistensi
 * lawan, dan (c) benar-benar memenuhi win condition pertarungan. Ability yang
 * memenuhi ketiganya disebut *decisive edge* dan memiliki otoritas di atas skor
 * tertimbang.
 */

import { proficiencyWeight } from './metrics.ts';
import { findHaxRule, satisfiesWinCondition } from './rule-set.ts';
import type {
  AbilityOutcome,
  BattleConditions,
  DecisiveEdge,
  HaxRule,
  ResistanceLevelLabel,
  RuleSet,
  Side,
  SideAbility,
  SideData,
  SideResistance,
} from './types.ts';

export type AttackLevel = 'weak' | 'medium' | 'strong' | 'absolute';

/** Attack level diturunkan dari kecakapan; kategori negasi selalu 'absolute'. */
export function attackLevelOf(ability: SideAbility): AttackLevel {
  if (ability.category_is_negation) return 'absolute';
  switch (ability.proficiency) {
    case 'godlike':
    case 'master':
    case 'advanced':
      return 'strong';
    case 'intermediate':
      return 'medium';
    default:
      return 'weak';
  }
}

export interface MatrixResult {
  status: 'effective' | 'reduced' | 'blocked' | 'negated';
  multiplier: number;
  /** `blocked` hanya sah bila resistensi punya bukti tersumber (RS-1). */
  requiresSourceEvidence: boolean;
}

/**
 * Matriks §15.3. Kolom = level resistensi (none → absolute).
 * Urutan baris = attack level (weak, medium, strong, absolute).
 */
export function baseMatrixStatus(
  attackLevel: AttackLevel,
  resistanceLabel: ResistanceLevelLabel,
): MatrixResult {
  const table: Record<AttackLevel, Record<ResistanceLevelLabel, MatrixResult>> = {
    weak: {
      none: { status: 'effective', multiplier: 1, requiresSourceEvidence: false },
      limited: { status: 'effective', multiplier: 1, requiresSourceEvidence: false },
      moderate: { status: 'reduced', multiplier: 0.5, requiresSourceEvidence: false },
      high: { status: 'blocked', multiplier: 0, requiresSourceEvidence: true },
      absolute: { status: 'blocked', multiplier: 0, requiresSourceEvidence: true },
    },
    medium: {
      none: { status: 'effective', multiplier: 1, requiresSourceEvidence: false },
      limited: { status: 'reduced', multiplier: 0.5, requiresSourceEvidence: false },
      moderate: { status: 'reduced', multiplier: 0.5, requiresSourceEvidence: false },
      high: { status: 'blocked', multiplier: 0, requiresSourceEvidence: true },
      absolute: { status: 'blocked', multiplier: 0, requiresSourceEvidence: true },
    },
    strong: {
      none: { status: 'effective', multiplier: 1, requiresSourceEvidence: false },
      limited: { status: 'effective', multiplier: 1, requiresSourceEvidence: false },
      moderate: { status: 'reduced', multiplier: 0.5, requiresSourceEvidence: false },
      high: { status: 'reduced', multiplier: 0.5, requiresSourceEvidence: false },
      absolute: { status: 'blocked', multiplier: 0, requiresSourceEvidence: true },
    },
    absolute: {
      none: { status: 'effective', multiplier: 1, requiresSourceEvidence: false },
      limited: { status: 'reduced', multiplier: 0.5, requiresSourceEvidence: false },
      moderate: { status: 'reduced', multiplier: 0.5, requiresSourceEvidence: false },
      high: { status: 'blocked', multiplier: 0, requiresSourceEvidence: true },
      absolute: { status: 'blocked', multiplier: 0, requiresSourceEvidence: true },
    },
  };
  return table[attackLevel][resistanceLabel];
}

/** Resistensi dianggap bersumber bila status verifikasinya dapat ditelusuri (RS-1). */
export function isSourcedResistance(resistance: SideResistance): boolean {
  const sourced =
    resistance.verification_status === 'verified' ||
    resistance.verification_status === 'imported' ||
    resistance.verification_status === 'partially_verified';
  return sourced && resistance.confidence >= 0.5;
}

export interface ActivationState {
  active: boolean;
  reason: string | null;
  /** Level efektif setelah memperhitungkan persiapan/mode. */
  effectiveSpeed: SideAbility['activation_speed'];
}

/**
 * Kelayakan aktivasi: apakah ability dapat dipakai sebelum lawan bertindak.
 * Ini yang mencegah "hax instan jarak jauh" tanpa dasar.
 */
export function activationState(
  ability: SideAbility,
  side: SideData,
  opponent: SideData,
  conditions: BattleConditions,
  ruleSet: RuleSet,
): ActivationState {
  const gate = ruleSet.constants.dominance_gate;
  let effectiveSpeed = ability.activation_speed;

  if (ability.is_passive) return { active: true, reason: null, effectiveSpeed };

  // Persiapan panjang memungkinkan ability yang butuh persiapan berjalan lebih cepat.
  if (conditions.prep_time === 'extended' && ability.is_prep_required) {
    effectiveSpeed = 'fast';
  }
  // Bloodlusted: semua ability yang mampu dianggap langsung digunakan.
  if (conditions.mode === 'bloodlusted') {
    effectiveSpeed = 'instant';
  }

  // Jangkauan: ability di luar jangkauan tidak dapat mengenai lawan.
  const effectiveRange = ability.effective_range_rank ?? side.metrics.range;
  if (
    conditions.starting_distance_rank !== null &&
    effectiveRange !== null &&
    effectiveRange < conditions.starting_distance_rank
  ) {
    return { active: false, reason: 'out_of_range', effectiveSpeed };
  }

  // Selisih kecepatan: lawan yang jauh lebih cepat bertindak lebih dulu.
  if (!conditions.speed_equalized && conditions.mode !== 'equal_speed') {
    const speedA = side.metrics.speed;
    const speedB = opponent.metrics.speed;
    if (speedA !== null && speedB !== null) {
      const opponentGap = speedB - speedA; // positif = lawan lebih cepat
      if (opponentGap >= gate.speed_delta && effectiveSpeed !== 'instant' && effectiveSpeed !== 'fast') {
        return {
          active: false,
          reason: `too_slow_against_speed_gap:${opponentGap}`,
          effectiveSpeed,
        };
      }
    }
  }

  return { active: true, reason: null, effectiveSpeed };
}

/**
 * Tentukan resistensi yang relevan terhadap sebuah ability.
 *
 * Pencocokan tidak hanya berdasarkan kategori yang sama: aturan hax dapat
 * MENGHUBUNGKAN kategori berbeda (mis. Regeneration Negation vs resistensi
 * Regeneration). Tanpa ini, aturan lintas-kategori di `hax_interactions` tidak
 * akan pernah diterapkan.
 */
export function resolveResistance(
  opponent: SideData,
  abilityCategorySlug: string,
  ruleSet: RuleSet,
): { resistance: SideResistance; rule: HaxRule | null } | null {
  const direct = opponent.resistances.find((r) => r.category_slug === abilityCategorySlug);
  const ruleForAbility = ruleSet.hax_rules.find(
    (r) => r.ability_category_slug === abilityCategorySlug,
  );

  if (direct) {
    const rule =
      findHaxRule(ruleSet, abilityCategorySlug, direct.category_slug) ?? null;
    return { resistance: direct, rule };
  }

  if (ruleForAbility) {
    const coupled = opponent.resistances.find(
      (r) => r.category_slug === ruleForAbility.resistance_category_slug,
    );
    if (coupled) return { resistance: coupled, rule: ruleForAbility };
  }

  return null;
}

export interface EvaluateParams {
  ability: SideAbility;
  side: Side;
  owner: SideData;
  opponent: SideData;
  conditions: BattleConditions;
  ruleSet: RuleSet;
}

/** Evaluasi satu ability terhadap seluruh resistensi lawan + win condition. */
export function evaluateAbility(params: EvaluateParams): AbilityOutcome {
  const { ability, side, owner, opponent, conditions, ruleSet } = params;
  const notes: string[] = [];
  const attackLevel = attackLevelOf(ability);

  const resolved = resolveResistance(opponent, ability.category_slug, ruleSet);
  const resistance: SideResistance | null = resolved ? resolved.resistance : null;

  let status: AbilityOutcome['status'] = 'effective';
  let multiplier = 1;
  let ruleApplied: HaxRule | null = null;

  if (resistance) {
    const rule = resolved ? resolved.rule : null;
    ruleApplied = rule;
    const result = rule
      ? {
          status: rule.relation === 'bypasses' ? ('effective' as const) : rule.relation,
          multiplier:
            rule.relation === 'bypasses'
              ? 1
              : rule.relation === 'effective'
                ? 1
                : rule.relation === 'reduced'
                  ? Math.min(rule.effectiveness_multiplier, 1)
                  : 0,
          requiresSourceEvidence: rule.requires_source_evidence,
        }
      : baseMatrixStatus(attackLevel, resistance.level_label);

    const sourced = isSourcedResistance(resistance);
    const wantsBlock = result.status === 'blocked' || result.status === 'negated';
    if (wantsBlock && result.requiresSourceEvidence && !sourced) {
      // RS-1: resistensi tanpa bukti tersumber tidak boleh memblokir sepenuhnya.
      status = 'reduced';
      multiplier = 0.5;
      notes.push('resistance_evidence_missing:downgraded_to_reduced');
    } else {
      status = result.status === 'negated' ? 'negated' : result.status;
      multiplier = result.multiplier;
    }

    // Pengetahuan defender mempengaruhi kekuatan penangkalan.
    const knowledgeMultiplier =
      conditions.knowledge_level === 'full'
        ? ruleSet.constants.condition_modifiers.knowledge_full_counter_multiplier
        : conditions.knowledge_level === 'none'
          ? ruleSet.constants.condition_modifiers.knowledge_none_counter_multiplier
          : 1;
    if (knowledgeMultiplier !== 1) {
      multiplier = multiplier / knowledgeMultiplier;
      notes.push(`knowledge_multiplier:${conditions.knowledge_level}`);
    }
  }

  // Mode pertarungan
  if (conditions.mode === 'bloodlusted') {
    multiplier *= ruleSet.constants.condition_modifiers.bloodlusted_hax_multiplier;
    notes.push('bloodlusted_boost');
  }
  if (conditions.mode === 'in_character') {
    const holdsBack =
      owner.traits.includes('holds_back') ||
      owner.traits.includes('talkative') ||
      owner.traits.includes('measured');
    if (holdsBack) {
      multiplier *= 1 - ruleSet.constants.condition_modifiers.in_character_activation_penalty;
      notes.push('in_character_penalty');
    }
  }
  if (conditions.prep_time === 'extended' && ability.is_prep_required) {
    multiplier *= 1 + ruleSet.constants.condition_modifiers.prep_time_extended_bonus;
    notes.push('prep_time_bonus');
  }

  const activation = activationState(ability, owner, opponent, conditions, ruleSet);
  if (!activation.active && activation.reason) notes.push(`inactive:${activation.reason}`);

  const effectiveness = Math.max(0, Math.min(1, multiplier));
  const satisfies = satisfiesWinCondition(ruleSet, ability.category_slug, conditions.win_condition);
  if (!satisfies) notes.push(`win_condition_not_met:${conditions.win_condition}`);

  const decisive =
    ruleSet.constants.decisive_edge.enabled &&
    activation.active &&
    status === 'effective' &&
    effectiveness >= ruleSet.constants.decisive_edge.min_effectiveness &&
    satisfies;

  return {
    side,
    ability_id: ability.id,
    ability_name: ability.name,
    category_slug: ability.category_slug,
    attack_level: attackLevel,
    status: activation.active ? status : 'inactive',
    effectiveness: activation.active ? effectiveness : 0,
    inactive_reason: activation.active ? null : activation.reason,
    resistance_level_label: resistance ? resistance.level_label : null,
    resistance_sourced: resistance ? isSourcedResistance(resistance) : false,
    satisfies_win_condition: satisfies,
    decisive,
    rule_applied: ruleApplied,
    notes,
  };
}

export function evaluateAllAbilities(
  sideA: SideData,
  sideB: SideData,
  conditions: BattleConditions,
  ruleSet: RuleSet,
): AbilityOutcome[] {
  const outcomes: AbilityOutcome[] = [];
  for (const ability of [...sideA.abilities].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (!ability.is_offensive && !ability.is_passive) continue;
    outcomes.push(
      evaluateAbility({ ability, side: 'a', owner: sideA, opponent: sideB, conditions, ruleSet }),
    );
  }
  for (const ability of [...sideB.abilities].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (!ability.is_offensive && !ability.is_passive) continue;
    outcomes.push(
      evaluateAbility({ ability, side: 'b', owner: sideB, opponent: sideA, conditions, ruleSet }),
    );
  }
  return outcomes;
}

/** Konversi outcome → edge (semua ability, termasuk yang non-decisive, agar dapat diaudit). */
export function toDecisiveEdges(outcomes: AbilityOutcome[]): DecisiveEdge[] {
  return outcomes
    .map((o) => ({
      id: `${o.side}:${o.category_slug}:${o.ability_id}`,
      side: o.side,
      ability_id: o.ability_id,
      ability_name: o.ability_name,
      category_slug: o.category_slug,
      status: o.status,
      effectiveness: Number(o.effectiveness.toFixed(4)),
      inactive_reason: o.inactive_reason,
      blocked_by:
        o.resistance_level_label !== null
          ? { resistance_type_id: `resistance:${o.category_slug}`, level_label: o.resistance_level_label }
          : null,
      satisfies_win_condition: o.satisfies_win_condition,
      decisive: o.decisive,
      delta_ranks: 0,
    }))
    .sort((x, y) => (x.id < y.id ? -1 : 1));
}

/** Tekanan hax sebuah sisi: jumlah efektivitas ability ofensif berbobot kecakapan. */
export function haxPressure(outcomes: AbilityOutcome[], side: Side, sideData: SideData): number {
  let pressure = 0;
  for (const outcome of outcomes) {
    if (outcome.side !== side || !outcome.decisive && outcome.effectiveness === 0) continue;
    const ability = sideData.abilities.find((a) => a.id === outcome.ability_id);
    if (!ability || !ability.is_offensive) continue;
    pressure += outcome.effectiveness * proficiencyWeight(ability.proficiency);
  }
  return pressure;
}

export interface CoverageResult {
  /** Rasio kategori ofensif lawan yang dapat ditahan (0..1). */
  ratio: number;
  covered: number;
  total: number;
  assumptions: string[];
  notes: string[];
}

/**
 * Cakupan resistensi (PRD §15.2). Sisi tanpa resistensi yang terdokumentasi
 * dicatat sebagai asumsi eksplisit — bukan diperlakukan sebagai "tahan nol".
 */
export function resistanceCoverage(
  defender: SideData,
  attacker: SideData,
  side: Side,
  ruleSet: RuleSet,
): CoverageResult {
  const offensiveCategories = [...new Set(attacker.abilities.filter((a) => a.is_offensive).map((a) => a.category_slug))];
  const assumptions: string[] = [];
  const notes: string[] = [];

  if (defender.resistances.length === 0) {
    assumptions.push(`no_documented_resistances:${side}`);
  }
  if (offensiveCategories.length === 0) {
    notes.push(`no_offensive_abilities_opposing:${side}`);
    return { ratio: 0, covered: 0, total: 0, assumptions, notes };
  }

  let covered = 0;
  for (const category of offensiveCategories) {
    const resolved = resolveResistance(defender, category, ruleSet);
    if (!resolved) continue;
    const resistance = resolved.resistance;
    const probe: SideAbility = {
      id: `probe:${category}`,
      name: `probe ${category}`,
      category_slug: category,
      category_is_negation: false,
      activation_speed: 'instant',
      is_offensive: true,
      is_passive: false,
      is_prep_required: false,
      proficiency: 'advanced',
      confidence: 1,
      effective_range_rank: null,
    };
    const rule = resolved.rule;
    const base = rule
      ? rule.relation === 'effective' || rule.relation === 'bypasses'
        ? { status: 'effective' as const, multiplier: 1 }
        : rule.relation === 'reduced'
          ? { status: 'reduced' as const, multiplier: Math.min(rule.effectiveness_multiplier, 1) }
          : { status: 'blocked' as const, multiplier: 0 }
      : baseMatrixStatus(attackLevelOf(probe), resistance.level_label);
    if (base.status !== 'effective') covered += 1;
  }

  return {
    ratio: covered / offensiveCategories.length,
    covered,
    total: offensiveCategories.length,
    assumptions,
    notes,
  };
}

/** Apakah sebuah sisi punya setidaknya satu decisive edge. */
export function hasDecisiveEdge(outcomes: AbilityOutcome[], side: Side): boolean {
  return outcomes.some((o) => o.side === side && o.decisive);
}
