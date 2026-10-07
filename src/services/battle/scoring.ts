/**
 * Layer 3 — weighted scoring (PRD §17.1–§17.2).
 *
 * Skor tertimbang hanya SALAH SATU input; keputusan akhir dibentuk oleh gate,
 * rule engine hax, dan kalibrasi. Bobot berasal dari rule set (dapat diubah
 * admin) sehingga tidak ada satu pun angka yang tertanam di kode.
 */

import { haxPressure } from './hax-engine.ts';
import type { CoverageResult } from './hax-engine.ts';
import { clamp, experienceAdvantage, proficiencyWeight } from './metrics.ts';
import type { PreparedMetric } from './metrics.ts';
import { WEIGHT_KEYS } from './rule-set.ts';
import type {
  AbilityOutcome,
  BattleConditions,
  ScoreContribution,
  SideData,
  RuleSet,
  WeightKey,
} from './types.ts';
import { isWeakQualifier } from './qualifiers.ts';

export interface ScoringParams {
  sideA: SideData;
  sideB: SideData;
  prepared: PreparedMetric[];
  outcomes: AbilityOutcome[];
  coverageA: CoverageResult;
  coverageB: CoverageResult;
  conditions: BattleConditions;
  ruleSet: RuleSet;
}

export interface ScoringOutput {
  breakdown: ScoreContribution[];
  limitations: string[];
  assumptions: string[];
  /** Rasio input skoring yang tidak terdokumentasi (dipakai kalibrasi). */
  gapRatio: number;
  weakQualifierCount: { a: number; b: number };
  conflictingCount: number;
  lowConfidenceAbilities: { a: number; b: number };
}

function abilityScore(side: SideData): number {
  return side.abilities.reduce((acc, a) => acc + proficiencyWeight(a.proficiency), 0);
}

/**
 * Bangun 14 kontribusi skor. Setiap kontribusi menyimpan nilai, bobot, dan
 * catatan alasan sehingga hasil dapat diaudit (AC-34).
 */
export function buildScoreBreakdown(params: ScoringParams): ScoringOutput {
  const { sideA, sideB, prepared, outcomes, coverageA, coverageB, conditions, ruleSet } = params;

  const limitations = new Set<string>();
  const assumptions = new Set<string>();
  for (const row of prepared) {
    for (const l of row.limitations) limitations.add(l);
    for (const a of row.assumptions) assumptions.add(a);
  }
  // Asumsi dari analisis cakupan resistensi (mis. "tidak ada resistensi yang
  // terdokumentasi") harus ikut terbawa; jika tidak, peringatan penting ini
  // hilang dari hasil dan pengguna mengira sisi tersebut benar-benar kebal.
  for (const coverage of [coverageA, coverageB]) {
    for (const a of coverage.assumptions) assumptions.add(a);
  }

  const advantages = new Map<WeightKey, { value: number; note: string | null }>();

  for (const row of prepared) {
    const key = row.metric as WeightKey;
    advantages.set(key, {
      value: row.comparable ? row.advantage : 0,
      note: row.comparable ? row.note : (row.note ?? 'metrik tidak dapat dibandingkan'),
    });
  }

  // Tingkat kecakapan (ability): jumlah + kualitas, dinormalisasi.
  const countA = sideA.abilities.length;
  const countB = sideB.abilities.length;
  const skillA = abilityScore(sideA);
  const skillB = abilityScore(sideB);
  advantages.set('abilities', {
    value: clamp((countA - countB) / 6 + (skillA - skillB) / 12, -1, 1),
    note:
      countA === 0 && countB === 0
        ? 'kedua sisi tanpa ability terdokumentasi'
        : `kemampuan terdokumentasi A=${countA}, B=${countB}`,
  });

  // Hax: tekanan efektif setelah aturan resistensi diterapkan.
  const pressureA = haxPressure(outcomes, 'a', sideA);
  const pressureB = haxPressure(outcomes, 'b', sideB);
  advantages.set('hax', {
    value: clamp((pressureA - pressureB) / 4, -1, 1),
    note: `tekanan efektif A=${pressureA.toFixed(2)}, B=${pressureB.toFixed(2)}`,
  });

  // Resistensi: cakupan terhadap ability ofensif lawan.
  advantages.set('resistances', {
    value: clamp((coverageA.ratio - coverageB.ratio) * 4, -1, 1),
    note: `cakupan A=${coverageA.covered}/${coverageA.total}, B=${coverageB.covered}/${coverageB.total}`,
  });

  // Experience bersifat numerik (tahun) → rasio logaritmik.
  advantages.set('experience', {
    value: experienceAdvantage(sideA, sideB),
    note:
      sideA.metrics.experience === null || sideB.metrics.experience === null
        ? 'tahun pengalaman tidak terdokumentasi sebagian'
        : `tahun pengalaman A=${sideA.metrics.experience}, B=${sideB.metrics.experience}`,
  });

  // Modifikasi kondisi pertarungan (§16.4)
  const modifiers = ruleSet.constants.condition_modifiers;
  const speedEqualized =
    conditions.speed_equalized || (conditions.mode === 'equal_speed' && modifiers.equal_speed_zeroes_speed_metric);

  if (conditions.mode === 'random_encounter') {
    const biq = advantages.get('battle_iq');
    if (biq) {
      advantages.set('battle_iq', {
        value: clamp(biq.value * modifiers.random_encounter_battle_iq_multiplier, -1, 1),
        note: 'random encounter: battle IQ diperkuat 1,2×',
      });
    }
  }

  const breakdown: ScoreContribution[] = [];
  for (const key of WEIGHT_KEYS) {
    const entry = advantages.get(key) ?? { value: 0, note: 'tidak dihitung' };
    let value = entry.value;
    let note = entry.note;

    if (speedEqualized && key === 'speed') {
      value = 0;
      note = 'kecepatan disetarakan oleh kondisi pertarungan';
    } else if (speedEqualized && (key === 'reaction_speed' || key === 'combat_speed')) {
      value = value * 0.5;
      note = 'kecepatan disetarakan: kontribusi kecepatan reaksi/aksi dihitung separuh';
    }

    const weight = ruleSet.weights[key];
    breakdown.push({
      metric: key,
      a_value: Number(value.toFixed(4)),
      weight,
      contribution: Number(((value * weight) / 100).toFixed(4)),
      note,
    });
  }

  let missingInputs = 0;
  let totalInputs = 0;
  for (const row of prepared) {
    totalInputs += 1;
    if (!row.comparable) missingInputs += 1;
  }
  totalInputs += 1; // experience
  if (sideA.metrics.experience === null || sideB.metrics.experience === null) missingInputs += 1;

  const weakQualifierCount = {
    a: sideA.statistics.filter((s) => s.status === 'current' && isWeakQualifier(s.qualifier)).length,
    b: sideB.statistics.filter((s) => s.status === 'current' && isWeakQualifier(s.qualifier)).length,
  };
  const conflictingCount =
    sideA.statistics.filter((s) => s.status === 'conflicting').length +
    sideB.statistics.filter((s) => s.status === 'conflicting').length;

  const lowConfidenceAbilities = {
    a: sideA.abilities.filter((x) => x.confidence < 0.5).length,
    b: sideB.abilities.filter((x) => x.confidence < 0.5).length,
  };
  if (sideA.abilities.length === 0) assumptions.add('no_documented_abilities:a');
  if (sideB.abilities.length === 0) assumptions.add('no_documented_abilities:b');

  return {
    breakdown,
    limitations: [...limitations].sort(),
    assumptions: [...assumptions].sort(),
    gapRatio: totalInputs === 0 ? 0 : missingInputs / totalInputs,
    weakQualifierCount,
    conflictingCount,
    lowConfidenceAbilities,
  };
}

/** S = Σ w_i·a_i / 100, pada rentang [-1, 1]. */
export function weightedScore(breakdown: ScoreContribution[]): number {
  return breakdown.reduce((acc, row) => acc + row.contribution, 0);
}

/** Transformasi logistik: skor → keyakinan model, bukan probabilitas dunia nyata. */
export function logistic(score: number, k: number): number {
  return 1 / (1 + Math.exp(-k * score));
}
