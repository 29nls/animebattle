/**
 * Penanganan kualifikasi klaim (PRD §12.3).
 *
 * Prinsip: kualifikasi melemahkan KEYAKINAN, bukan mengubah angka. Modul ini
 * tidak pernah mengarang nilai — bila kualifikasi berarti nilai tidak diketahui
 * (`varies`, `unknown`), metrik tersebut dikeluarkan dari skoring dan dicatat
 * sebagai keterbatasan.
 */

import type { Qualifier, RuleSet } from './types.ts';

/** Kualifikasi yang membuat metrik tidak dapat dibandingkan. */
const NON_COMPARABLE: readonly Qualifier[] = ['varies', 'unknown'];

export function isComparableQualifier(q: Qualifier): boolean {
  return !NON_COMPARABLE.includes(q);
}

/** Penalti keyakinan dari tabel rule set (0 = tidak ada penalti). */
export function qualifierPenalty(ruleSet: RuleSet, q: Qualifier): number {
  return ruleSet.constants.qualifier_penalty[q] ?? 0;
}

/**
 * Peredam selisih. Kualifikasi "possibly" berarti bukti lemah, sehingga selisih
 * dianggap separuh; "likely" berarti 75%. Kualifikasi lain tidak meredam.
 */
export function gapDamping(q: Qualifier): number {
  switch (q) {
    case 'possibly':
      return 0.5;
    case 'likely':
      return 0.75;
    default:
      return 1;
  }
}

/** Kualifikasi yang dianggap "lemah" untuk menghitung penalti kualifikasi berat. */
export function isWeakQualifier(q: Qualifier): boolean {
  return q === 'possibly' || q === 'varies' || q === 'unknown';
}

/** Penanda keterbatasan untuk kualifikasi non-komparabel. */
export function limitationCodeFor(q: Qualifier, metric: string, side: string): string | null {
  if (q === 'varies') return `varies_metric:${metric}:${side}`;
  if (q === 'unknown') return `unknown_metric:${metric}:${side}`;
  return null;
}
