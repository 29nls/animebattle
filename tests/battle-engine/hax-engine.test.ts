/**
 * Unit test rule engine hax (PRD §15.3, §16.3 Layer 2, §12).
 *
 * Alur yang dikunci: ABILITY → TARGET → RESISTANCE → COUNTER → SUCCESS.
 * Dua invarian terpenting:
 *  - Matriks §15.3 tidak boleh menjadi lebih permisif saat resistensi naik.
 *  - `blocked`/`negated` hanya sah bila resistensi punya bukti tersumber (RS-1);
 *    tanpa itu statusnya diturunkan, bukan dipercaya.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  activationState,
  attackLevelOf,
  baseMatrixStatus,
  evaluateAbility,
  evaluateAllAbilities,
  haxPressure,
  isSourcedResistance,
  resistanceCoverage,
  resolveResistance,
  toDecisiveEdges,
} from '../../src/services/battle/hax-engine.ts';
import type { AttackLevel, MatrixResult } from '../../src/services/battle/hax-engine.ts';
import type { ResistanceLevelLabel, SideAbility } from '../../src/services/battle/types.ts';
import {
  ability,
  conditions,
  defaultRuleSet,
  outcome,
  resistance,
  side,
} from './helpers.ts';

const LABELS: readonly ResistanceLevelLabel[] = ['none', 'limited', 'moderate', 'high', 'absolute'];
const ATTACK_LEVELS: readonly AttackLevel[] = ['weak', 'medium', 'strong', 'absolute'];
/**
 * Peringkat kekuatan hasil interaksi. `negated` disertakan karena tipe
 * `MatrixResult.status` memang mengizinkannya — nilainya -1, dan test di bawah
 * memastikan matriks dasar tidak pernah menghasilkannya.
 */
const SCALE: Record<MatrixResult['status'], number> = {
  effective: 2,
  reduced: 1,
  blocked: 0,
  negated: -1,
};

function effectiveness(status: MatrixResult['status']): number {
  return SCALE[status];
}

/**
 * Multiplier yang diharapkan dari matriks dasar. `negated` ikut didaftarkan agar
 * tipe tertutup; test terpisah memastikan status itu tidak pernah dihasilkan.
 */
const EXPECTED_MULTIPLIER: Record<MatrixResult['status'], number> = {
  effective: 1,
  reduced: 0.5,
  blocked: 0,
  negated: 0,
};

describe('attackLevelOf', () => {
  it('menetapkan "absolute" untuk kategori negasi, apa pun kecakapannya', () => {
    assert.equal(attackLevelOf(ability({ category_is_negation: true, proficiency: 'novice' })), 'absolute');
  });

  it('memetakan kecakapan tinggi ke "strong"', () => {
    for (const proficiency of ['advanced', 'master', 'godlike'] as const) {
      assert.equal(attackLevelOf(ability({ proficiency })), 'strong');
    }
  });

  it('memetakan intermediate ke "medium" dan sisanya ke "weak"', () => {
    assert.equal(attackLevelOf(ability({ proficiency: 'intermediate' })), 'medium');
    assert.equal(attackLevelOf(ability({ proficiency: 'novice' })), 'weak');
  });
});

describe('baseMatrixStatus — matriks §15.3', () => {
  it('memberi multiplier 1 untuk efektif, 0,5 untuk tereduksi, dan 0 untuk tertahan', () => {
    for (const attack of ATTACK_LEVELS) {
      for (const label of LABELS) {
        const result = baseMatrixStatus(attack, label);
        assert.equal(result.multiplier, EXPECTED_MULTIPLIER[result.status], `${attack} vs ${label}`);
      }
    }
  });

  it('menuntut bukti tersumber tepat pada status tertahan', () => {
    for (const attack of ATTACK_LEVELS) {
      for (const label of LABELS) {
        const result = baseMatrixStatus(attack, label);
        assert.equal(
          result.requiresSourceEvidence,
          result.status === 'blocked',
          `${attack} vs ${label}`,
        );
      }
    }
  });

  it('tidak pernah menghasilkan status "negated" sendiri', () => {
    // Negasi hanya boleh datang dari aturan hax eksplisit, bukan dari matriks dasar.
    for (const attack of ATTACK_LEVELS) {
      for (const label of LABELS) {
        assert.notEqual(baseMatrixStatus(attack, label).status, 'negated', `${attack} vs ${label}`);
      }
    }
  });

  it('tidak pernah menjadi lebih permisif saat resistensi naik', () => {
    for (const attack of ATTACK_LEVELS) {
      const scales = LABELS.map((label) => effectiveness(baseMatrixStatus(attack, label).status));
      for (let i = 1; i < scales.length; i += 1) {
        assert.ok(
          scales[i]! <= scales[i - 1]!,
          `${attack}: ${LABELS[i - 1]} (${scales[i - 1]}) → ${LABELS[i]} (${scales[i]})`,
        );
      }
    }
  });

  it('mempertahankan asimetri yang didokumentasikan kuat-vs-lemah', () => {
    // Serangan lemah tertahan resistensi tinggi, tetapi serangan kuat hanya tereduksi.
    assert.equal(baseMatrixStatus('weak', 'high').status, 'blocked');
    assert.equal(baseMatrixStatus('strong', 'high').status, 'reduced');
    // Serangan kuat menembus resistensi terbatas, serangan medium tidak.
    assert.equal(baseMatrixStatus('strong', 'limited').status, 'effective');
    assert.equal(baseMatrixStatus('medium', 'limited').status, 'reduced');
    // Resistensi absolut menahan serangan non-negasi sekalipun kuat.
    assert.equal(baseMatrixStatus('strong', 'absolute').status, 'blocked');
  });
});

describe('isSourcedResistance', () => {
  it('menerima status verifikasi yang dapat ditelusuri dengan confidence memadai', () => {
    for (const status of ['verified', 'imported', 'partially_verified'] as const) {
      assert.equal(isSourcedResistance(resistance({ verification_status: status, confidence: 0.5 })), true);
    }
  });

  it('menolak status konflik atau tidak diketahui', () => {
    assert.equal(isSourcedResistance(resistance({ verification_status: 'conflicting' })), false);
    assert.equal(isSourcedResistance(resistance({ verification_status: 'unknown' })), false);
  });

  it('menolak confidence di bawah ambang meski status terverifikasi', () => {
    assert.equal(isSourcedResistance(resistance({ verification_status: 'verified', confidence: 0.4 })), false);
  });
});

describe('activationState', () => {
  const owner = side({ metrics: { speed: 20, range: 4 } });
  const opponent = side({ version_id: 'ver_test_b', metrics: { speed: 20 } });

  it('selalu mengaktifkan ability pasif, sekalipun di luar jangkauan', () => {
    const result = activationState(
      ability({ is_passive: true, effective_range_rank: 1 }),
      owner,
      opponent,
      conditions({ starting_distance_rank: 9 }),
      defaultRuleSet,
    );
    assert.equal(result.active, true);
    assert.equal(result.reason, null);
  });

  it('menonaktifkan ability di luar jangkauan', () => {
    const result = activationState(
      ability({ effective_range_rank: 2 }),
      owner,
      opponent,
      conditions({ starting_distance_rank: 5 }),
      defaultRuleSet,
    );
    assert.equal(result.active, false);
    assert.equal(result.reason, 'out_of_range');
  });

  it('memakai jangkauan form bila ability tidak menyebutkan jangkauannya', () => {
    const result = activationState(
      ability({ effective_range_rank: null }),
      side({ metrics: { range: 3 } }),
      opponent,
      conditions({ starting_distance_rank: 5 }),
      defaultRuleSet,
    );
    assert.equal(result.active, false);
    assert.equal(result.reason, 'out_of_range');
  });

  it('mengaktifkan ability yang jangkauannya mencukupi', () => {
    const result = activationState(
      ability({ effective_range_rank: 5 }),
      owner,
      opponent,
      conditions({ starting_distance_rank: 5 }),
      defaultRuleSet,
    );
    assert.equal(result.active, true);
  });

  it('menonaktifkan ability lambat bila lawan lebih cepat dari ambang', () => {
    const result = activationState(
      ability({ activation_speed: 'moderate' }),
      side({ metrics: { speed: 20 } }),
      side({ version_id: 'ver_test_b', metrics: { speed: 28 } }),
      conditions(),
      defaultRuleSet,
    );
    assert.equal(result.active, false);
    assert.equal(result.reason, 'too_slow_against_speed_gap:8');
  });

  it('mengaktifkan ability lambat bila selisih kecepatan di bawah ambang', () => {
    const result = activationState(
      ability({ activation_speed: 'moderate' }),
      side({ metrics: { speed: 20 } }),
      side({ version_id: 'ver_test_b', metrics: { speed: 27 } }),
      conditions(),
      defaultRuleSet,
    );
    assert.equal(result.active, true);
  });

  it('membiarkan ability instan dan cepat bertindak lebih dulu', () => {
    for (const activation_speed of ['instant', 'fast'] as const) {
      const result = activationState(
        ability({ activation_speed }),
        side({ metrics: { speed: 20 } }),
        side({ version_id: 'ver_test_b', metrics: { speed: 40 } }),
        conditions(),
        defaultRuleSet,
      );
      assert.equal(result.active, true, activation_speed);
    }
  });

  it('melewati pemeriksaan kecepatan bila kecepatan disetarakan', () => {
    const result = activationState(
      ability({ activation_speed: 'slow' }),
      side({ metrics: { speed: 20 } }),
      side({ version_id: 'ver_test_b', metrics: { speed: 40 } }),
      conditions({ speed_equalized: true }),
      defaultRuleSet,
    );
    assert.equal(result.active, true);
  });

  it('melewati pemeriksaan kecepatan pada mode equal_speed', () => {
    const result = activationState(
      ability({ activation_speed: 'slow' }),
      side({ metrics: { speed: 20 } }),
      side({ version_id: 'ver_test_b', metrics: { speed: 40 } }),
      conditions({ mode: 'equal_speed' }),
      defaultRuleSet,
    );
    assert.equal(result.active, true);
  });

  it('menjadikan semua ability instan pada mode bloodlusted', () => {
    const result = activationState(
      ability({ activation_speed: 'slow' }),
      side({ metrics: { speed: 20 } }),
      side({ version_id: 'ver_test_b', metrics: { speed: 40 } }),
      conditions({ mode: 'bloodlusted' }),
      defaultRuleSet,
    );
    assert.equal(result.effectiveSpeed, 'instant');
    assert.equal(result.active, true);
  });

  it('mempercepat ability berpersiapan pada prep_time extended', () => {
    const result = activationState(
      ability({ activation_speed: 'slow', is_prep_required: true }),
      side({ metrics: { speed: 20 } }),
      side({ version_id: 'ver_test_b', metrics: { speed: 40 } }),
      conditions({ prep_time: 'extended' }),
      defaultRuleSet,
    );
    assert.equal(result.effectiveSpeed, 'fast');
    assert.equal(result.active, true);
  });

  it('tidak mempercepat ability tanpa persiapan pada prep_time extended', () => {
    const result = activationState(
      ability({ activation_speed: 'slow', is_prep_required: false }),
      side({ metrics: { speed: 20 } }),
      side({ version_id: 'ver_test_b', metrics: { speed: 40 } }),
      conditions({ prep_time: 'extended' }),
      defaultRuleSet,
    );
    assert.equal(result.effectiveSpeed, 'slow');
    assert.equal(result.active, false);
  });
});

describe('resolveResistance', () => {
  it('mencocokkan kategori yang sama secara langsung', () => {
    const opponent = side({ resistances: [resistance({ category_slug: 'mind-manipulation' })] });
    const resolved = resolveResistance(opponent, 'mind-manipulation', defaultRuleSet);
    assert.equal(resolved?.resistance.category_slug, 'mind-manipulation');
    assert.equal(resolved?.rule?.relation, 'reduced');
  });

  it('menghubungkan kategori berbeda lewat aturan hax', () => {
    // Negasi regenerasi menyerang resistensi Regeneration — tanpa pemetaan
    // lintas-kategori, aturan di hax_interactions tidak akan pernah terpakai.
    const opponent = side({ resistances: [resistance({ category_slug: 'regeneration' })] });
    const resolved = resolveResistance(opponent, 'regeneration-negation', defaultRuleSet);
    assert.equal(resolved?.resistance.category_slug, 'regeneration');
    assert.equal(resolved?.rule?.ability_category_slug, 'regeneration-negation');
  });

  it('mengembalikan null bila tidak ada resistensi yang relevan', () => {
    assert.equal(resolveResistance(side(), 'teleportation', defaultRuleSet), null);
  });

  it('mengutamakan resistensi langsung atas pemetaan lintas-kategori', () => {
    const opponent = side({
      resistances: [
        resistance({ category_slug: 'regeneration-negation' }),
        resistance({ category_slug: 'regeneration' }),
      ],
    });
    const resolved = resolveResistance(opponent, 'regeneration-negation', defaultRuleSet);
    assert.equal(resolved?.resistance.category_slug, 'regeneration-negation');
    // Tidak ada aturan untuk pasangan identik ini, jadi matriks dasar yang dipakai.
    assert.equal(resolved?.rule, null);
  });
});

describe('evaluateAbility', () => {
  const owner = side({ metrics: { speed: 20, range: 6 } });
  const bareOpponent = side({ version_id: 'ver_test_b' });

  function evaluate(
    abilityOverrides: Partial<SideAbility> = {},
    options: {
      opponent?: typeof bareOpponent;
      conditionOverrides?: Parameters<typeof conditions>[0];
      ownerOverrides?: Parameters<typeof side>[0];
    } = {},
  ) {
    return evaluateAbility({
      ability: ability(abilityOverrides),
      side: 'a',
      owner: options.ownerOverrides ? side(options.ownerOverrides) : owner,
      opponent: options.opponent ?? bareOpponent,
      conditions: conditions(options.conditionOverrides),
      ruleSet: defaultRuleSet,
    });
  }

  it('menandai ability efektif sebagai decisive bila win condition terpenuhi', () => {
    const result = evaluate();
    assert.equal(result.status, 'effective');
    assert.equal(result.effectiveness, 1);
    assert.equal(result.satisfies_win_condition, true);
    assert.equal(result.decisive, true);
    assert.deepEqual(result.notes, []);
  });

  it('tidak menandai decisive bila win condition tidak terpenuhi', () => {
    const result = evaluate({}, { conditionOverrides: { win_condition: 'death' } });
    assert.equal(result.satisfies_win_condition, false);
    assert.equal(result.decisive, false);
    assert.ok(result.notes.includes('win_condition_not_met:death'));
  });

  it('tidak menandai decisive untuk kategori utilitas yang dipetakan ke []', () => {
    const result = evaluate({ category_slug: 'teleportation' }, { conditionOverrides: { win_condition: 'any' } });
    assert.equal(result.satisfies_win_condition, false);
    assert.equal(result.decisive, false);
  });

  it('menerapkan aturan hax, bukan matriks dasar, bila pasangan punya aturan', () => {
    const hurt = evaluate(
      {},
      { opponent: side({ version_id: 'ver_test_b', resistances: [resistance({ category_slug: 'mind-manipulation' })] }) },
    );
    assert.equal(hurt.rule_applied?.relation, 'reduced');
    assert.equal(hurt.status, 'reduced');
    assert.ok(Math.abs(hurt.effectiveness - 0.4) < 1e-9);
    // 0,4 di bawah min_effectiveness 0,55 → bukan jalur kemenangan.
    assert.equal(hurt.decisive, false);
  });

  it('menurunkan status tertahan menjadi tereduksi bila resistensi tidak tersumber (RS-1)', () => {
    const result = evaluate(
      { category_slug: 'teleportation', proficiency: 'novice' },
      {
        opponent: side({
          version_id: 'ver_test_b',
          resistances: [
            resistance({ category_slug: 'teleportation', level_label: 'high', verification_status: 'unknown', confidence: 0.2 }),
          ],
        }),
      },
    );
    assert.equal(result.status, 'reduced');
    assert.equal(result.effectiveness, 0.5);
    assert.equal(result.resistance_sourced, false);
    assert.ok(result.notes.includes('resistance_evidence_missing:downgraded_to_reduced'));
  });

  it('mempertahankan status tertahan bila resistensi tersumber', () => {
    const result = evaluate(
      { category_slug: 'teleportation', proficiency: 'novice' },
      {
        opponent: side({
          version_id: 'ver_test_b',
          resistances: [
            resistance({ category_slug: 'teleportation', level_label: 'high', verification_status: 'verified', confidence: 0.9 }),
          ],
        }),
      },
    );
    assert.equal(result.status, 'blocked');
    assert.equal(result.effectiveness, 0);
    assert.equal(result.resistance_sourced, true);
  });

  it('menguatkan penangkalan saat lawan punya pengetahuan penuh', () => {
    const opponent = side({
      version_id: 'ver_test_b',
      resistances: [resistance({ category_slug: 'mind-manipulation' })],
    });
    const result = evaluate({}, { opponent, conditionOverrides: { knowledge_level: 'full' } });
    assert.ok(Math.abs(result.effectiveness - 0.32) < 1e-9);
    assert.ok(result.notes.includes('knowledge_multiplier:full'));
  });

  it('melemahkan penangkalan saat lawan tanpa pengetahuan', () => {
    const opponent = side({
      version_id: 'ver_test_b',
      resistances: [resistance({ category_slug: 'mind-manipulation' })],
    });
    const result = evaluate({}, { opponent, conditionOverrides: { knowledge_level: 'none' } });
    assert.ok(Math.abs(result.effectiveness - 0.5) < 1e-9);
    assert.ok(result.notes.includes('knowledge_multiplier:none'));
  });

  it('menambah tekanan hax pada mode bloodlusted dan menjepit ke 1', () => {
    const result = evaluate(
      {},
      { opponent: side({ version_id: 'ver_test_b', resistances: [resistance({ category_slug: 'mind-manipulation' })] }), conditionOverrides: { mode: 'bloodlusted' } },
    );
    assert.ok(Math.abs(result.effectiveness - 0.48) < 1e-9);
    assert.ok(result.notes.includes('bloodlusted_boost'));
  });

  it('menjepit efektivitas ke 1, bukan melampauinya', () => {
    const result = evaluate({}, { conditionOverrides: { mode: 'bloodlusted' } });
    assert.equal(result.effectiveness, 1);
  });

  it('memberi penalti in-character untuk sifat yang menahan diri', () => {
    const result = evaluate(
      {},
      { ownerOverrides: { traits: ['holds_back'] }, conditionOverrides: { mode: 'in_character' } },
    );
    assert.ok(Math.abs(result.effectiveness - 0.65) < 1e-9);
    assert.ok(result.notes.includes('in_character_penalty'));
  });

  it('tidak memberi penalti in-character tanpa sifat yang menahan diri', () => {
    const result = evaluate({}, { conditionOverrides: { mode: 'in_character' } });
    assert.equal(result.effectiveness, 1);
    assert.ok(!result.notes.includes('in_character_penalty'));
  });

  it('menambah bonus persiapan pada ability yang membutuhkannya', () => {
    const opponent = side({
      version_id: 'ver_test_b',
      resistances: [resistance({ category_slug: 'mind-manipulation' })],
    });
    const result = evaluate(
      { is_prep_required: true },
      { opponent, conditionOverrides: { prep_time: 'extended' } },
    );
    assert.ok(Math.abs(result.effectiveness - 0.46) < 1e-9);
    assert.ok(result.notes.includes('prep_time_bonus'));
  });

  it('menandai ability tidak aktif tanpa memberi efektivitas', () => {
    const result = evaluate(
      { effective_range_rank: 2 },
      { conditionOverrides: { starting_distance_rank: 9 } },
    );
    assert.equal(result.status, 'inactive');
    assert.equal(result.effectiveness, 0);
    assert.equal(result.inactive_reason, 'out_of_range');
    assert.equal(result.decisive, false);
    assert.ok(result.notes.includes('inactive:out_of_range'));
  });
});

describe('evaluateAllAbilities', () => {
  it('mengurutkan ability per sisi dan melewati ability non-ofensif non-pasif', () => {
    const a = side({
      abilities: [
        ability({ id: 'ab_2' }),
        ability({ id: 'ab_1' }),
        ability({ id: 'ab_util', is_offensive: false, is_passive: false }),
      ],
    });
    const b = side({ version_id: 'ver_test_b', abilities: [ability({ id: 'ab_b_1' })] });
    const outcomes = evaluateAllAbilities(a, b, conditions(), defaultRuleSet);
    assert.deepEqual(
      outcomes.map((o) => `${o.side}:${o.ability_id}`),
      ['a:ab_1', 'a:ab_2', 'b:ab_b_1'],
    );
  });

  it('tetap menyertakan ability pasif', () => {
    const a = side({ abilities: [ability({ id: 'ab_passive', is_passive: true, is_offensive: false })] });
    const outcomes = evaluateAllAbilities(a, side({ version_id: 'ver_test_b' }), conditions(), defaultRuleSet);
    assert.deepEqual(outcomes.map((o) => o.ability_id), ['ab_passive']);
  });
});

describe('toDecisiveEdges', () => {
  it('menyusun edge terurut dengan id yang dapat ditelusuri', () => {
    const edges = toDecisiveEdges([
      outcome({ side: 'b', ability_id: 'ab_b', category_slug: 'time-manipulation', effectiveness: 0.123456 }),
      outcome({ side: 'a', ability_id: 'ab_a' }),
    ]);
    assert.deepEqual(edges.map((e) => e.id), ['a:mind-manipulation:ab_a', 'b:time-manipulation:ab_b']);
  });

  it('membulatkan efektivitas ke 4 desimal', () => {
    const [edgeA] = toDecisiveEdges([outcome({ effectiveness: 0.123456 })]);
    assert.equal(edgeA?.effectiveness, 0.1235);
  });

  it('mengisi blocked_by hanya bila ada resistensi lawan', () => {
    const [withResistance] = toDecisiveEdges([
      outcome({ category_slug: 'time-manipulation', resistance_level_label: 'high' }),
    ]);
    assert.deepEqual(withResistance?.blocked_by, {
      resistance_type_id: 'resistance:time-manipulation',
      level_label: 'high',
    });
    const [withoutResistance] = toDecisiveEdges([outcome()]);
    assert.equal(withoutResistance?.blocked_by, null);
  });
});

describe('haxPressure', () => {
  it('menjumlahkan efektivitas ability ofensif berbobot kecakapan', () => {
    const a = side({ abilities: [ability({ id: 'ab_x', proficiency: 'advanced' })] });
    const pressure = haxPressure([outcome({ side: 'a', ability_id: 'ab_x', decisive: true, effectiveness: 1 })], 'a', a);
    assert.equal(pressure, 1);
  });

  it('mengabaikan ability sisi lain dan ability non-ofensif', () => {
    const a = side({ abilities: [ability({ id: 'ab_x' }), ability({ id: 'ab_pasif', is_offensive: false, is_passive: true })] });
    const outcomes = [
      outcome({ side: 'b', ability_id: 'ab_x', decisive: true, effectiveness: 1 }),
      outcome({ side: 'a', ability_id: 'ab_pasif', decisive: true, effectiveness: 1 }),
      outcome({ side: 'a', ability_id: 'ab_tidak_ada', decisive: true, effectiveness: 1 }),
    ];
    assert.equal(haxPressure(outcomes, 'a', a), 0);
  });

  it('menghitung ability non-decisive yang masih punya efektivitas', () => {
    const a = side({ abilities: [ability({ id: 'ab_x', proficiency: 'master' })] });
    const outcomes = [outcome({ side: 'a', ability_id: 'ab_x', decisive: false, effectiveness: 0.5 })];
    assert.ok(Math.abs(haxPressure(outcomes, 'a', a) - 0.625) < 1e-9);
  });
});

describe('resistanceCoverage', () => {
  const attacker = side({ abilities: [ability({ category_slug: 'teleportation' })] });

  it('mencatat asumsi saat defender tidak punya resistensi terdokumentasi', () => {
    const coverage = resistanceCoverage(side(), attacker, 'a', defaultRuleSet);
    assert.equal(coverage.total, 1);
    assert.equal(coverage.covered, 0);
    assert.equal(coverage.ratio, 0);
    assert.deepEqual(coverage.assumptions, ['no_documented_resistances:a']);
  });

  it('melaporkan tanpa kategori ofensif saat lawan tidak punya ability menyerang', () => {
    const coverage = resistanceCoverage(side(), side({ version_id: 'ver_test_b' }), 'a', defaultRuleSet);
    assert.equal(coverage.total, 0);
    assert.equal(coverage.ratio, 0);
    assert.deepEqual(coverage.notes, ['no_offensive_abilities_opposing:a']);
  });

  it('menghitung kategori yang dapat ditahan', () => {
    const defender = side({
      resistances: [resistance({ category_slug: 'teleportation', level_label: 'moderate' })],
    });
    const coverage = resistanceCoverage(defender, attacker, 'a', defaultRuleSet);
    assert.equal(coverage.covered, 1);
    assert.equal(coverage.total, 1);
    assert.equal(coverage.ratio, 1);
    assert.deepEqual(coverage.assumptions, []);
  });

  it('tidak menghitung resistensi yang tidak cukup menahan serangan kuat', () => {
    const defender = side({
      resistances: [resistance({ category_slug: 'teleportation', level_label: 'limited' })],
    });
    const coverage = resistanceCoverage(defender, attacker, 'a', defaultRuleSet);
    assert.equal(coverage.covered, 0);
    assert.equal(coverage.ratio, 0);
  });

  it('menghitung kategori ofensif unik saja', () => {
    const twoSameCategory = side({
      abilities: [
        ability({ id: 'ab_1', category_slug: 'teleportation' }),
        ability({ id: 'ab_2', category_slug: 'teleportation' }),
      ],
    });
    const coverage = resistanceCoverage(side(), twoSameCategory, 'a', defaultRuleSet);
    assert.equal(coverage.total, 1);
  });
});
