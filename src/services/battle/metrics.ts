/**
 * Normalisasi metrik (PRD §17.1).
 *
 * Setiap metrik ordinal menghasilkan nilai ternormalisasi a ∈ [-1, 1] yang
 * independen dari bobot. Metrik yang tidak terdokumentasi atau tidak dapat
 * dibandingkan TIDAK diberi nilai tebakan: nilainya 0 dan alasannya dicatat
 * sebagai keterbatasan/asumsi.
 */

import { gapDamping, isComparableQualifier, limitationCodeFor } from './qualifiers.ts';
import { RANK_METRICS } from './types.ts';
import type { Qualifier, RankMetric, RuleSet, Side, SideData, StatMetric } from './types.ts';

export { RANK_METRICS };
export type { RankMetric };

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Kualifikasi aktif untuk sebuah metrik: baris statistik 'current' paling dipercaya. */
export function qualifierOf(side: SideData, metric: StatMetric): Qualifier {
  let best: { q: Qualifier; confidence: number } | null = null;
  for (const s of side.statistics) {
    if (s.metric !== metric || s.status !== 'current') continue;
    if (!best || s.confidence > best.confidence) best = { q: s.qualifier, confidence: s.confidence };
  }
  return best ? best.q : 'exact';
}

export interface PreparedMetric {
  metric: RankMetric;
  rankA: number | null;
  rankB: number | null;
  qualifierA: Qualifier;
  qualifierB: Qualifier;
  /** Nilai ternormalisasi untuk sisi A pada [-1, 1]; 0 bila tidak dapat dibandingkan. */
  advantage: number;
  comparable: boolean;
  limitations: string[];
  assumptions: string[];
  /** Keterangan yang dipakai `score_breakdown.note`. */
  note: string | null;
}

function rankOf(side: SideData, metric: RankMetric): number | null {
  if (metric === 'tier') {
    if (!side.tier.rankable) return null;
    return side.tier.rank;
  }
  return side.metrics[metric];
}

/**
 * Hitung a_i untuk satu metrik ordinal.
 *
 * - Kualifikasi `varies`/`unknown` → metrik dikeluarkan (bukan ditebak).
 * - Kualifikasi `possibly`/`likely` → selisih diredam (0,5 / 0,75).
 * - Kualifikasi `up_to` pada salah satu sisi → selisih dibatasi +2 rank (§12.3).
 * - Metrik non-fisik (mis. FTL) → selisih diredam 0,5 dan dicatat sebagai asumsi,
 *   karena rezim tersebut tidak dapat dibandingkan secara energi.
 */
export function prepareRankMetric(
  metric: RankMetric,
  sideA: SideData,
  sideB: SideData,
  ruleSet: RuleSet,
): PreparedMetric {
  const qualifierA = qualifierOf(sideA, metric);
  const qualifierB = qualifierOf(sideB, metric);
  const limitations: string[] = [];
  const assumptions: string[] = [];
  let note: string | null = null;

  for (const [side, qualifier] of [
    ['a', qualifierA],
    ['b', qualifierB],
  ] as const) {
    const code = limitationCodeFor(qualifier, metric, side);
    if (code) limitations.push(code);
  }

  const comparableQualifiers =
    isComparableQualifier(qualifierA) && isComparableQualifier(qualifierB);
  if (!comparableQualifiers) {
    note = 'metrik dikeluarkan: kualifikasi varies/unknown';
    return {
      metric,
      rankA: rankOf(sideA, metric),
      rankB: rankOf(sideB, metric),
      qualifierA,
      qualifierB,
      advantage: 0,
      comparable: false,
      limitations,
      assumptions,
      note,
    };
  }

  let rankA = rankOf(sideA, metric);
  let rankB = rankOf(sideB, metric);

  if (rankA === null) {
    limitations.push(`missing_metric:${metric}:a`);
    note = 'metrik tidak terdokumentasi pada sisi A';
  }
  if (rankB === null) {
    limitations.push(`missing_metric:${metric}:b`);
    note = note ?? 'metrik tidak terdokumentasi pada sisi B';
  }
  if (rankA === null || rankB === null) {
    return {
      metric,
      rankA,
      rankB,
      qualifierA,
      qualifierB,
      advantage: 0,
      comparable: false,
      limitations,
      assumptions,
      note,
    };
  }

  // `up_to` = batas atas: nilai sebenarnya tidak boleh melampaui lawan lebih dari 2 rank.
  if (qualifierA === 'up_to') rankA = Math.min(rankA, rankB + 2);
  if (qualifierB === 'up_to') rankB = Math.min(rankB, rankA + 2);

  const span = ruleSet.constants.normalization_spans[metric];
  if (typeof span !== 'number' || span <= 0) {
    throw new Error(`normalization_spans tidak terdefinisi untuk metrik "${metric}"`);
  }
  const damping = Math.min(gapDamping(qualifierA), gapDamping(qualifierB));
  let advantage = clamp((rankA - rankB) / span, -1, 1) * damping;

  const nonphysical =
    sideA.nonphysical_metrics.includes(metric) || sideB.nonphysical_metrics.includes(metric);
  if (nonphysical) {
    advantage *= 0.5;
    assumptions.push(`nonphysical_metric:${metric}`);
    note = 'rezim non-fisik: selisih diredam 0,5';
  }

  return {
    metric,
    rankA,
    rankB,
    qualifierA,
    qualifierB,
    advantage: clamp(advantage, -1, 1),
    comparable: true,
    limitations,
    assumptions,
    note,
  };
}

export function prepareRankMetrics(
  sideA: SideData,
  sideB: SideData,
  ruleSet: RuleSet,
): PreparedMetric[] {
  return RANK_METRICS.map((metric) => prepareRankMetric(metric, sideA, sideB, ruleSet));
}

/** Bobot kecakapan untuk skor ability (dipakai juga oleh tekanan hax). */
export const PROFICIENCY_WEIGHT: Record<string, number> = {
  novice: 0.5,
  intermediate: 0.75,
  advanced: 1,
  master: 1.25,
  godlike: 1.5,
};

export function proficiencyWeight(proficiency: string): number {
  return PROFICIENCY_WEIGHT[proficiency] ?? 1;
}

/**
 * Metrik `experience` bersifat numerik (tahun), bukan ordinal: PRD §17.1 memakai
 * rasio logaritmik. Mengembalikan a_i pada [-1, 1].
 */
export function experienceAdvantage(sideA: SideData, sideB: SideData): number {
  const yearsA = sideA.metrics.experience ?? 0;
  const yearsB = sideB.metrics.experience ?? 0;
  if (yearsA <= 0 && yearsB <= 0) return 0;
  const value = Math.log10(yearsA + 1) / Math.log10(yearsB + 1) - 1;
  return clamp(value, -1, 1);
}

/** Jumlah metrik yang hilang dari daftar tertentu (dipakai confidence). */
export function missingMetricCount(side: SideData, required: readonly StatMetric[]): number {
  let missing = 0;
  for (const metric of required) {
    const rank = metric === 'tier' ? (side.tier.rankable ? side.tier.rank : null) : side.metrics[metric];
    if (rank === null) missing += 1;
  }
  return missing;
}

/**
 * Jumlah metrik SKORING yang tidak terdokumentasi (12 metrik ber-rank + pengalaman).
 *
 * Layer 0 (kelayakan) hanya menuntut 4 metrik wajib; sisanya menurunkan
 * keyakinan lewat angka ini, karena perbandingan dengan 9 dari 13 metrik kosong
 * secara jujur tidak boleh mengaku setara dengan perbandingan data lengkap.
 */
export function missingScoringMetricCount(side: SideData): number {
  let missing = 0;
  for (const metric of RANK_METRICS) {
    if (rankOf(side, metric) === null) missing += 1;
  }
  if (side.metrics.experience === null) missing += 1;
  return missing;
}

export function sideLabel(side: SideData, which: Side): string {
  return `${which.toUpperCase()} (${side.form.name})`;
}
