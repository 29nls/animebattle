/**
 * Titik masuk publik engine pertarungan.
 *
 * Pemakaian produksi:
 *   const dataset = await rpc('battle_dataset', [versionA, versionB]);   // 1 round-trip
 *   const ruleSet = await loadRuleSet();                                 // battle_rule_sets + hax_interactions
 *   const result  = runBattle({ side_a: dataset[0], side_b: dataset[1], conditions }, ruleSet);
 *
 * Modul ini tidak melakukan I/O apa pun (aturan arsitektur PRD §39).
 */

export { runBattle, computeInputHash, ENGINE_VERSION } from './engine.ts';
export { validateRuleSet, winConditionsFor, satisfiesWinCondition, findHaxRule, WEIGHT_KEYS } from './rule-set.ts';
export { validateReasoningTraceability } from './reasoning.ts';
export type { ReasoningBundle, TraceabilityResult } from './reasoning.ts';
export { checkEligibility, checkDominance } from './gates.ts';
export {
  activationState,
  attackLevelOf,
  baseMatrixStatus,
  evaluateAbility,
  evaluateAllAbilities,
  haxPressure,
  isSourcedResistance,
  resistanceCoverage,
  toDecisiveEdges,
} from './hax-engine.ts';
export { computeBattleLength, computeDifficulty } from './difficulty.ts';
export { buildScoreBreakdown, logistic, weightedScore } from './scoring.ts';
export { prepareRankMetrics, prepareRankMetric, RANK_METRICS, clamp } from './metrics.ts';
export { stableStringify, hashValue } from './stable-json.ts';
export { DISCLAIMER, REQUIRED_METRICS } from './types.ts';
export type * from './types.ts';
