/**
 * Layer 5 — difficulty & battle length (PRD §16.3).
 *
 * Kedua nilai ini diturunkan dari bentuk hasil, bukan ditebak: difficulty dari
 * ketidakpastian, battle length dari daya tahan, regenerasi, dan keberadaan
 * hax instan.
 */

import type { AbilityOutcome, RuleSet, SideData } from './types.ts';

export type Difficulty = 'low' | 'mid' | 'high' | 'extreme';
export type BattleLength = 'short' | 'medium' | 'long';

/**
 * Toleransi pembanding ambang.
 *
 * `0,95 - 0,5` menghasilkan 0,44999999999999996, sehingga ambang `low: 0,45`
 * yang seharusnya inklusif justru terlewat dan tingkat kesulitan berubah karena
 * representasi biner, bukan karena data. Toleransi ini mengembalikan arti angka
 * desimal pada rule set.
 */
const THRESHOLD_EPSILON = 1e-9;

function reaches(margin: number, threshold: number): boolean {
  return margin >= threshold - THRESHOLD_EPSILON;
}

/** Semakin timpang hasilnya, semakin rendah kesulitan bagi pemenang. */
export function computeDifficulty(probability: number, ruleSet: RuleSet): Difficulty {
  const t = ruleSet.constants.difficulty_thresholds;
  const margin = Math.abs(probability - 0.5);
  if (reaches(margin, t.low)) return 'low';
  if (reaches(margin, t.mid)) return 'mid';
  if (reaches(margin, t.high)) return 'high';
  return 'extreme';
}

const SUSTAIN_CATEGORIES = ['regeneration', 'immortality', 'durability-negation', 'reactive-evolution'];

export interface LengthParams {
  sideA: SideData;
  sideB: SideData;
  outcomes: AbilityOutcome[];
  probability: number;
}

export function computeBattleLength(params: LengthParams): BattleLength {
  const { sideA, sideB, outcomes, probability } = params;

  const hasDecisive = outcomes.some((o) => o.decisive);

  const durabilityDelta = Math.abs((sideA.metrics.durability ?? 0) - (sideB.metrics.durability ?? 0));
  const speedDelta = Math.abs((sideA.metrics.speed ?? 0) - (sideB.metrics.speed ?? 0));

  const sustain = (side: SideData): boolean =>
    side.abilities.some((a) => SUSTAIN_CATEGORIES.includes(a.category_slug));

  const instantWin = sideA.abilities
    .concat(sideB.abilities)
    .some((a) => a.category_is_negation && a.activation_speed === 'instant');

  if (instantWin && Math.abs(probability - 0.5) >= 0.28) return 'short';
  if (hasDecisive && Math.abs(probability - 0.5) >= 0.28) return 'short';
  if (durabilityDelta >= 6) return 'short';
  if ((sustain(sideA) && sustain(sideB)) || (durabilityDelta <= 2 && speedDelta <= 2)) return 'long';
  return 'medium';
}
