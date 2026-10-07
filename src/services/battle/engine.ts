/**
 * Battle engine v1 — orkestrasi Layer 0–7 (PRD §16.3).
 *
 * Sifat yang dijamin:
 *  - Deterministik: input yang sama + rule set yang sama → hasil identik,
 *    termasuk `input_hash` dan `battle_id`. Tidak ada RNG di jalur ini.
 *  - Bebas I/O: seluruh data diterima sebagai argumen.
 *  - Dapat diaudit: setiap angka ada di `score_breakdown`/`decisive_edges`,
 *    dan setiap kalimat reasoning punya rujukan yang divalidasi (RG-1).
 */

import { computeBattleLength, computeDifficulty } from './difficulty.ts';
import { checkDominance, checkEligibility } from './gates.ts';
import type { DominanceResult } from './gates.ts';
import type { CoverageResult } from './hax-engine.ts';
import {
  evaluateAllAbilities,
  resistanceCoverage,
  toDecisiveEdges,
} from './hax-engine.ts';
import { clamp, missingScoringMetricCount, prepareRankMetrics } from './metrics.ts';
import { buildReasoning, validateReasoningTraceability } from './reasoning.ts';
import type { ReasoningBundle } from './reasoning.ts';
import { validateRuleSet } from './rule-set.ts';
import { buildScoreBreakdown, logistic, weightedScore } from './scoring.ts';
import type { ScoringOutput } from './scoring.ts';
import { hashValue } from './stable-json.ts';
import { DISCLAIMER, REQUIRED_METRICS } from './types.ts';
import type {
  BattleInput,
  BattleReasoning,
  BattleResult,
  DecisiveEdge,
  RuleSet,
  SideData,
} from './types.ts';

export const ENGINE_VERSION = 'battle-engine@1.0.0';

/** Input yang dipakai untuk hash: hanya hal-hal yang mempengaruhi hasil. */
function hashPayload(input: BattleInput, ruleSet: RuleSet): unknown {
  const side = (data: SideData): unknown => ({
    version_id: data.version_id,
    tier: data.tier,
    metrics: data.metrics,
    nonphysical_metrics: [...data.nonphysical_metrics].sort(),
    statistics: [...data.statistics]
      .map((s) => `${s.metric}|${s.raw_text}|${s.qualifier}|${s.status}|${s.confidence}`)
      .sort(),
    abilities: [...data.abilities]
      .map((a) => `${a.id}|${a.category_slug}|${a.proficiency}|${a.activation_speed}`)
      .sort(),
    resistances: [...data.resistances]
      .map((r) => `${r.category_slug}|${r.level}|${r.verification_status}|${r.confidence}`)
      .sort(),
    traits: [...data.traits].sort(),
  });
  return {
    engine_version: ENGINE_VERSION,
    rule_set_version: ruleSet.version,
    conditions: input.conditions,
    side_a: side(input.side_a),
    side_b: side(input.side_b),
  };
}

export function computeInputHash(input: BattleInput, ruleSet: RuleSet): string {
  return hashValue(hashPayload(input, ruleSet));
}

function battleId(hash: string): string {
  return `btl_${hash.replace('sha256:', '').slice(0, 24)}`;
}

/** Jalur keluar untuk data yang tidak mencukupi (Layer 0). */
function insufficientResult(ruleSet: RuleSet, hash: string, limitations: string[]): BattleResult {
  const emptyDominance = {
    applies: false,
    dominant_side: null,
    tier_delta: 0,
    durability_delta: 0,
    speed_delta: 0,
    blocked_by: 'eligibility_failed',
  } as const;
  const reasoning: ReasoningBundle = {
    primary: {
      text: 'Data minimum tidak terpenuhi sehingga tidak ada pemenang yang dapat dinyatakan.',
      refs: limitations.map((l) => `limitation:${l}`),
    },
    secondary: [
      {
        text: 'Lengkapi tier, attack potency, durability, dan speed untuk kedua form terlebih dahulu.',
        refs: ['condition:win_condition'],
      },
    ],
    criticalCounter: {
      text: 'Tanpa data minimum, perbandingan hanya dapat dilakukan sebagai tabel statistik, bukan simulasi.',
      refs: ['condition:win_condition'],
    },
    scenario: {
      text: 'Tidak ada skenario pertarungan yang dapat disimulasikan pada data ini.',
      refs: ['condition:mode'],
    },
  };

  return {
    battle_id: battleId(hash),
    input_hash: hash,
    engine_version: ENGINE_VERSION,
    rule_set_version: ruleSet.version,
    winner: 'insufficient_data',
    win_probability: { a: 0.5, b: 0.5 },
    confidence: ruleSet.constants.confidence.floor,
    low_confidence: true,
    // Placeholder terdeklarasi: saat tidak ada pemenang, kedua nilai ini tidak
    // bermakna. Kolom DB bersifat NOT NULL (lihat PRD §16.5).
    difficulty: 'extreme',
    battle_length: 'short',
    decisive_edges: [],
    ability_outcomes: [],
    score_breakdown: [],
    weighted_score: 0,
    dominance: emptyDominance,
    coverage: { a: 0, b: 0 },
    primary_reason: reasoning.primary.text,
    secondary_factors: reasoning.secondary.map((s) => s.text),
    critical_counter: reasoning.criticalCounter.text,
    potential_scenario: reasoning.scenario.text,
    reasoning: {
      primary: reasoning.primary,
      secondary: reasoning.secondary,
      critical_counter: reasoning.criticalCounter,
      scenario: reasoning.scenario,
    },
    limitations: [...limitations].sort(),
    assumptions: ['insufficient_data_placeholder_fields'],
    disclaimer: DISCLAIMER,
  };
}

export function runBattle(input: BattleInput, ruleSet: RuleSet): BattleResult {
  const problems = validateRuleSet(ruleSet);
  if (problems.length > 0) {
    throw new Error(`Rule set tidak sah (${ruleSet.version}): ${problems.join('; ')}`);
  }

  const { side_a: sideA, side_b: sideB, conditions } = input;
  const hash = computeInputHash(input, ruleSet);

  // Layer 0 — kelayakan data
  const eligibility = checkEligibility(sideA, sideB);
  if (!eligibility.ok) {
    return insufficientResult(ruleSet, hash, eligibility.limitations);
  }

  // Layer 2 dihitung lebih dulu karena Layer 1 membutuhkannya: dominasi mutlak
  // dilewati bila pihak yang tertinggal punya decisive edge.
  const outcomes = evaluateAllAbilities(sideA, sideB, conditions, ruleSet);
  const dominance = checkDominance(sideA, sideB, ruleSet, outcomes);
  const coverageA = resistanceCoverage(sideA, sideB, 'a', ruleSet);
  const coverageB = resistanceCoverage(sideB, sideA, 'b', ruleSet);
  const edges = toDecisiveEdges(outcomes);

  const scored = buildScoreBreakdown({
    sideA,
    sideB,
    prepared: prepareRankMetrics(sideA, sideB, ruleSet),
    outcomes,
    coverageA,
    coverageB,
    conditions,
    ruleSet,
  });

  // Layer 1 — dominasi mutlak
  if (dominance.applies && dominance.dominantSide) {
    const winner = dominance.dominantSide;
    const p = ruleSet.constants.dominance_gate.min_probability;
    const probabilities = winner === 'a' ? { a: p, b: 1 - p } : { a: 1 - p, b: p };
    // Kesulitan bagi pemenang minimal; mismatch-nya yang ekstrem.
    const difficulty = 'low' as const;
    const battleLength = computeBattleLength({ sideA, sideB, outcomes, probability: probabilities.a });
    const confidence = computeConfidence(sideA, sideB, scored, ruleSet);
    const reasoning = buildReasoning({
      sideA,
      sideB,
      breakdown: scored.breakdown,
      outcomes,
      edges,
      limitations: scored.limitations,
      assumptions: scored.assumptions,
      conditions,
      dominance,
      winner,
      probability: probabilities.a,
      difficulty,
      battleLength,
      ruleSet,
    });
    return assemble({
      hash,
      ruleSet,
      winner,
      probabilities,
      confidence,
      difficulty,
      battleLength,
      edges,
      outcomes,
      breakdown: scored.breakdown,
      weightedScore: weightedScore(scored.breakdown),
      dominance,
      coverage: { a: coverageA.ratio, b: coverageB.ratio },
      reasoning,
      limitations: scored.limitations,
      assumptions: scored.assumptions,
    });
  }

  // Layer 3 — weighted scoring
  const score = weightedScore(scored.breakdown);
  let probability = logistic(score, ruleSet.constants.logistic_k);

  // Layer 4 — kalibrasi
  const decisiveA = edges.filter((e) => e.decisive && e.side === 'a');
  const decisiveB = edges.filter((e) => e.decisive && e.side === 'b');
  const floor = ruleSet.constants.decisive_edge.single_edge_probability_floor;
  const [clampLo, clampHi] = ruleSet.constants.decisive_edge.mutual_edge_probability_clamp;

  let decisiveFloor: number | null = null;
  if (decisiveA.length > 0 && decisiveB.length > 0) {
    probability = clamp(probability, clampLo, clampHi);
  } else if (decisiveA.length > 0) {
    probability = Math.max(probability, floor);
    decisiveFloor = floor;
  } else if (decisiveB.length > 0) {
    probability = Math.min(probability, 1 - floor);
    decisiveFloor = 1 - floor;
  }

  const qualifierPulls = [...sideA.statistics, ...sideB.statistics]
    .filter((s) => s.status === 'current')
    .map((s) => ruleSet.constants.qualifier_penalty[s.qualifier] ?? 0);
  const pull = Math.min(0.2, qualifierPulls.length > 0 ? Math.max(...qualifierPulls) : 0);
  if (pull > 0) probability = probability + (0.5 - probability) * pull;

  if (scored.gapRatio > 0) probability = probability + (0.5 - probability) * scored.gapRatio;

  // Penarikan kalibrasi tidak boleh melanggar lantai decisive edge.
  if (decisiveFloor !== null) {
    probability =
      decisiveFloor >= 0.5 ? Math.max(probability, decisiveFloor) : Math.min(probability, decisiveFloor);
  }
  probability = clamp(probability, 0.02, 0.98);

  const winner: BattleResult['winner'] =
    decisiveA.length === 0 && decisiveB.length === 0 && Math.abs(probability - 0.5) < 0.02
      ? 'draw'
      : probability > 0.5
        ? 'a'
        : 'b';

  const probabilities = { a: probability, b: 1 - probability };
  const difficulty = computeDifficulty(probability, ruleSet);
  const battleLength = computeBattleLength({ sideA, sideB, outcomes, probability });
  const confidence = computeConfidence(sideA, sideB, scored, ruleSet);

  const reasoning = buildReasoning({
    sideA,
    sideB,
    breakdown: scored.breakdown,
    outcomes,
    edges,
    limitations: scored.limitations,
    assumptions: scored.assumptions,
    conditions,
    dominance,
    winner,
    probability,
    difficulty,
    battleLength,
    ruleSet,
  });

  return assemble({
    hash,
    ruleSet,
    winner,
    probabilities,
    confidence,
    difficulty,
    battleLength,
    edges,
    outcomes,
    breakdown: scored.breakdown,
    weightedScore: score,
    dominance,
    coverage: { a: coverageA.ratio, b: coverageB.ratio },
    reasoning,
    limitations: scored.limitations,
    assumptions: scored.assumptions,
  });
}

interface AssembleParams {
  hash: string;
  ruleSet: RuleSet;
  winner: BattleResult['winner'];
  probabilities: { a: number; b: number };
  confidence: number;
  difficulty: BattleResult['difficulty'];
  battleLength: BattleResult['battle_length'];
  edges: DecisiveEdge[];
  outcomes: BattleResult['ability_outcomes'];
  breakdown: BattleResult['score_breakdown'];
  weightedScore: number;
  dominance: DominanceResult;
  coverage: { a: number; b: number };
  reasoning: ReasoningBundle;
  limitations: string[];
  assumptions: string[];
}

function assemble(params: AssembleParams): BattleResult {
  // Bentuk tersimpan memakai nama kolom database, sehingga reasoning dapat
  // dipetakan ke `battle_results` tanpa penerjemahan di lapisan API.
  const reasoning: BattleReasoning = {
    primary: params.reasoning.primary,
    secondary: params.reasoning.secondary,
    critical_counter: params.reasoning.criticalCounter,
    scenario: params.reasoning.scenario,
  };

  const traceability = validateReasoningTraceability({
    reasoning,
    breakdown: params.breakdown,
    edges: params.edges,
    limitations: params.limitations,
    assumptions: params.assumptions,
  });
  if (!traceability.ok) {
    // Fail-closed: jangan pernah mengembalikan kalimat yang tidak dapat dirujuk.
    throw new Error(
      `RG-1 gagal: reasoning memuat rujukan tak terselesaikan: ${traceability.unresolved.join(', ')}`,
    );
  }

  return {
    battle_id: battleId(params.hash),
    input_hash: params.hash,
    engine_version: ENGINE_VERSION,
    rule_set_version: params.ruleSet.version,
    winner: params.winner,
    win_probability: {
      a: Number(params.probabilities.a.toFixed(4)),
      b: Number(params.probabilities.b.toFixed(4)),
    },
    confidence: Number(params.confidence.toFixed(3)),
    low_confidence:
      params.confidence < params.ruleSet.constants.confidence.low_confidence_banner_threshold,
    difficulty: params.difficulty,
    battle_length: params.battleLength,
    decisive_edges: params.edges,
    ability_outcomes: params.outcomes,
    score_breakdown: params.breakdown,
    weighted_score: Number(params.weightedScore.toFixed(6)),
    dominance: {
      applies: params.dominance.applies,
      dominant_side: params.dominance.dominantSide,
      tier_delta: params.dominance.tierDelta,
      durability_delta: params.dominance.durabilityDelta,
      speed_delta: params.dominance.speedDelta,
      blocked_by: params.dominance.blockedBy,
    },
    coverage: { a: Number(params.coverage.a.toFixed(4)), b: Number(params.coverage.b.toFixed(4)) },
    primary_reason: params.reasoning.primary.text,
    secondary_factors: params.reasoning.secondary.map((s) => s.text),
    critical_counter: params.reasoning.criticalCounter.text,
    potential_scenario: params.reasoning.scenario.text,
    reasoning,
    limitations: [...params.limitations].sort(),
    assumptions: [...params.assumptions].sort(),
    disclaimer: DISCLAIMER,
  };
}

/**
 * Confidence hasil (PRD §17.3): turun oleh metrik skoring yang hilang, kualifikasi
 * lemah yang menumpuk, konflik sumber yang belum diselesaikan, dan bukti ability
 * yang tipis. Ada lantai, karena kejujuran lebih penting daripada angka rendah.
 *
 * Metrik WAJIB yang hilang tidak dihitung di sini karena kasus tersebut sudah
 * berhenti di Layer 0 (`insufficient_data`).
 */
function computeConfidence(
  sideA: SideData,
  sideB: SideData,
  scored: Pick<
    ScoringOutput,
    'weakQualifierCount' | 'conflictingCount' | 'lowConfidenceAbilities'
  >,
  ruleSet: RuleSet,
): number {
  const c = ruleSet.constants.confidence;
  let confidence = c.base;

  confidence -= c.per_missing_metric * missingScoringMetricCount(sideA);
  confidence -= c.per_missing_metric * missingScoringMetricCount(sideB);

  if (sideA.abilities.length > 0 && scored.lowConfidenceAbilities.a > 0) {
    confidence -= c.per_missing_ability_data;
  }
  if (sideB.abilities.length > 0 && scored.lowConfidenceAbilities.b > 0) {
    confidence -= c.per_missing_ability_data;
  }
  if (scored.weakQualifierCount.a >= c.qualifier_heavy_threshold) confidence -= c.qualifier_heavy_penalty;
  if (scored.weakQualifierCount.b >= c.qualifier_heavy_threshold) confidence -= c.qualifier_heavy_penalty;
  confidence -= c.per_unresolved_conflict * scored.conflictingCount;

  return clamp(confidence, c.floor, 1);
}

export type { CoverageResult };
