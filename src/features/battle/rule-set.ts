/**
 * Rule set default dari berkas seed.
 *
 * Sementara: produksi harus memuat `battle_rule_sets` versi aktif dari database
 * (PRD §16, BC-4) agar mengubah bobot tidak menuntut deploy. Nilai fixture
 * divalidasi dengan validator engine saat pertama diminta, sehingga berkas yang
 * rusak gagal cepat alih-alih menghasilkan hasil yang tampak wajar.
 *
 * Dipakai `app/api/battle/simulate/route.ts` **dan** halaman `/versus/result`;
 * keduanya harus memakai bobot yang sama persis, karena itu pemuatannya ada di
 * satu tempat, bukan disalin.
 */

import ruleSetFixture from '../../services/battle/fixtures/rule-set.default.json';
import { validateRuleSet } from '../../services/battle/index.ts';
import type { RuleSet } from '../../services/battle/types.ts';

let cached: RuleSet | null = null;

export function defaultRuleSet(): RuleSet {
  if (cached) return cached;

  const candidate = ruleSetFixture as unknown as RuleSet;
  const problems = validateRuleSet(candidate);
  if (problems.length > 0) {
    throw new Error(`Rule set default tidak sah: ${problems.join('; ')}`);
  }

  cached = candidate;
  return cached;
}
