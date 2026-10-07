/**
 * Rule set: validasi + lookup aturan.
 *
 * Engine TIDAK membaca file atau database (aturan arsitektur PRD §39: modul ini
 * bebas I/O). Pemanggil bertanggung jawab memuat rule set dari
 * `battle_rule_sets` + `hax_interactions` (produksi) atau dari fixtures (uji).
 */

import { RANK_METRICS } from './types.ts';
import type { HaxRule, RuleSet, SpanKey, WeightKey, WinCondition } from './types.ts';

/** Span hanya diperlukan metrik ber-rank + pengalaman (PRD §17.1). */
const SPAN_KEYS: readonly SpanKey[] = [...RANK_METRICS, 'experience'];

export const WEIGHT_KEYS: readonly WeightKey[] = [
  'tier',
  'attack_potency',
  'durability',
  'speed',
  'reaction_speed',
  'combat_speed',
  'range',
  'stamina',
  'intelligence',
  'battle_iq',
  'experience',
  'abilities',
  'hax',
  'resistances',
];

/** Kembalikan daftar masalah; array kosong berarti rule set sah. */
export function validateRuleSet(ruleSet: RuleSet): string[] {
  const problems: string[] = [];
  const { weights, constants } = ruleSet;

  const sum = WEIGHT_KEYS.reduce((acc, key) => acc + (weights[key] ?? 0), 0);
  if (sum !== 100) problems.push(`Σ bobot harus 100, ditemukan ${sum}`);

  for (const key of WEIGHT_KEYS) {
    const w = weights[key];
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) {
      problems.push(`bobot "${key}" tidak valid: ${String(w)}`);
    }
  }
  for (const key of SPAN_KEYS) {
    const span = constants.normalization_spans[key];
    if (typeof span !== 'number' || span <= 0) {
      problems.push(`normalization_spans["${key}"] harus > 0`);
    }
  }
  if (!(constants.logistic_k > 0)) problems.push('logistic_k harus > 0');
  const gate = constants.dominance_gate;
  if (gate.tier_delta <= 0 || gate.durability_delta <= 0) {
    problems.push('dominance_gate delta harus > 0');
  }
  const [lo, hi] = constants.decisive_edge.mutual_edge_probability_clamp;
  if (!(lo > 0 && hi < 1 && lo < hi)) {
    problems.push('mutual_edge_probability_clamp harus 0 < lo < hi < 1');
  }
  if (!(constants.confidence.floor >= 0 && constants.confidence.floor < 1)) {
    problems.push('confidence.floor harus pada [0, 1)');
  }
  if (!constants.win_condition_map['_default']) {
    problems.push('win_condition_map harus punya kunci "_default"');
  }
  const seen = new Set<string>();
  for (const rule of ruleSet.hax_rules) {
    const key = `${rule.ability_category_slug}|${rule.resistance_category_slug}`;
    if (seen.has(key)) problems.push(`aturan hax duplikat untuk pasangan ${key}`);
    seen.add(key);
    if (!(rule.effectiveness_multiplier >= 0 && rule.effectiveness_multiplier <= 2)) {
      problems.push(`effectiveness_multiplier di luar [0,2] untuk ${key}`);
    }
  }
  return problems;
}

/** Win condition yang dapat dipenuhi sebuah kategori ability. */
export function winConditionsFor(ruleSet: RuleSet, categorySlug: string): WinCondition[] {
  const map = ruleSet.constants.win_condition_map;
  return map[categorySlug] ?? map['_default'] ?? [];
}

/**
 * Apakah kategori ini dapat memenuhi win condition pertarungan yang dipilih.
 *
 * Daftar pada `win_condition_map` berisi SETTING win condition yang dapat
 * dipenuhi, sehingga pencocokannya langsung: ability BFR tidak memenuhi setting
 * `death`, tetapi memenuhi setting `bfr` dan `any`. Konsekuensinya, kategori
 * utilitas (mis. teleportation) yang dipetakan ke [] tidak pernah menjadi
 * jalur kemenangan — sekalipun setting-nya `any`.
 */
export function satisfiesWinCondition(
  ruleSet: RuleSet,
  categorySlug: string,
  winCondition: WinCondition,
): boolean {
  return winConditionsFor(ruleSet, categorySlug).includes(winCondition);
}

/** Aturan interaksi paling spesifik untuk pasangan (kategori ability, kategori resistensi). */
export function findHaxRule(
  ruleSet: RuleSet,
  abilityCategorySlug: string,
  resistanceCategorySlug: string,
): HaxRule | null {
  return (
    ruleSet.hax_rules.find(
      (r) =>
        r.ability_category_slug === abilityCategorySlug &&
        r.resistance_category_slug === resistanceCategorySlug,
    ) ?? null
  );
}
