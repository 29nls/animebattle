/**
 * Layer 0 (kelayakan data) dan Layer 1 (dominasi mutlak) — PRD §16.3.
 *
 * Dua gerbang ini ada supaya engine tidak pernah "menghitung" sesuatu yang tidak
 * seharusnya: tanpa data minimum, tidak ada pemenang; dan pada selisih ekstrem,
 * hasilnya tidak ditentukan oleh aritmetika bobot.
 */

import { hasDecisiveEdge, isSourcedResistance } from './hax-engine.ts';
import { REQUIRED_METRICS } from './types.ts';
import type { AbilityOutcome, RuleSet, Side, SideData, StatMetric } from './types.ts';

export interface EligibilityResult {
  ok: boolean;
  /** Kode keterbatasan: `missing_metric:<metric>:<side>` / `unknown_metric:tier:<side>`. */
  limitations: string[];
  missingBySide: Record<Side, StatMetric[]>;
}

/**
 * Data minimum: tier, attack potency, durability, speed untuk KEDUA sisi.
 * Tanpa itu engine mengembalikan `insufficient_data` — bukan menebak.
 */
export function checkEligibility(sideA: SideData, sideB: SideData): EligibilityResult {
  const missingBySide: Record<Side, StatMetric[]> = { a: [], b: [] };
  const limitations: string[] = [];

  const check = (side: SideData, which: Side): void => {
    for (const metric of REQUIRED_METRICS) {
      const value = metric === 'tier' ? (side.tier.rankable ? side.tier.rank : null) : side.metrics[metric];
      if (value === null) {
        missingBySide[which].push(metric);
        limitations.push(
          metric === 'tier' && !side.tier.rankable
            ? `unknown_metric:tier:${which}`
            : `missing_metric:${metric}:${which}`,
        );
      }
    }
  };

  check(sideA, 'a');
  check(sideB, 'b');

  return {
    ok: missingBySide.a.length === 0 && missingBySide.b.length === 0,
    limitations: [...new Set(limitations)].sort(),
    missingBySide,
  };
}

export interface DominanceResult {
  applies: boolean;
  dominantSide: Side | null;
  tierDelta: number;
  durabilityDelta: number;
  speedDelta: number;
  /** Alasan gerbang tidak diterapkan, untuk audit. */
  blockedBy: string | null;
}

/**
 * Layer 1: dominasi mutlak.
 *
 * Diterapkan bila selisih tier ≥ tier_delta DAN durability ≥ durability_delta.
 * Gerbang ini DILEWATI bila pihak yang tertinggal punya decisive edge — karena
 * kemampuan hax yang jelas dapat membalik selisih statistik (PRD §16.3).
 */
export function checkDominance(
  sideA: SideData,
  sideB: SideData,
  ruleSet: RuleSet,
  outcomes: AbilityOutcome[],
): DominanceResult {
  const gate = ruleSet.constants.dominance_gate;
  const tierA = sideA.tier.rank ?? 0;
  const tierB = sideB.tier.rank ?? 0;
  const durA = sideA.metrics.durability ?? 0;
  const durB = sideB.metrics.durability ?? 0;
  const spdA = sideA.metrics.speed ?? 0;
  const spdB = sideB.metrics.speed ?? 0;

  const tierDelta = Math.abs(tierA - tierB);
  const durabilityDelta = Math.abs(durA - durB);
  const speedDelta = Math.abs(spdA - spdB);
  const dominantSide: Side = tierA > tierB ? 'a' : 'b';
  const trailing: Side = dominantSide === 'a' ? 'b' : 'a';

  const base: DominanceResult = {
    applies: false,
    dominantSide: null,
    tierDelta,
    durabilityDelta,
    speedDelta,
    blockedBy: null,
  };

  if (!gate.enabled) return { ...base, blockedBy: 'gate_disabled' };
  if (tierDelta < gate.tier_delta) return { ...base, blockedBy: 'tier_delta_below_threshold' };
  if (durabilityDelta < gate.durability_delta) {
    return { ...base, blockedBy: 'durability_delta_below_threshold' };
  }

  if (hasDecisiveEdge(outcomes, trailing)) {
    return { ...base, blockedBy: 'trailing_side_has_decisive_edge' };
  }

  if (gate.requires_no_relevant_resistance) {
    const dominantSideData = dominantSide === 'a' ? sideA : sideB;
    const trailingSideData = trailing === 'a' ? sideA : sideB;
    const offensiveCategories = dominantSideData.abilities
      .filter((a) => a.is_offensive)
      .map((a) => a.category_slug);
    const hasRelevantResistance = trailingSideData.resistances.some(
      (r) => offensiveCategories.includes(r.category_slug) && isSourcedResistance(r),
    );
    if (hasRelevantResistance) {
      return { ...base, blockedBy: 'trailing_side_has_sourced_resistance' };
    }
  }

  return { ...base, applies: true, dominantSide };
}
