/**
 * Unit test Layer 0 (kelayakan data) dan Layer 1 (dominasi mutlak) — PRD §16.3.
 *
 * Dua gerbang ini menentukan kapan engine berhenti menghitung. Karena itu yang
 * diuji bukan hanya "kapan aktif", melainkan juga urutan alasan penolakan
 * (`blocked_by`): alasan yang salah membuat audit hasil menyesatkan, dan urutan
 * yang tertukar menyembunyikan kasus yang seharusnya diperiksa.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkDominance, checkEligibility } from '../../src/services/battle/gates.ts';
import { ability, defaultRuleSet, outcome, resistance, ruleSetWithConstants, side } from './helpers.ts';

describe('checkEligibility — Layer 0', () => {
  it('meloloskan dua sisi dengan 4 metrik wajib', () => {
    const result = checkEligibility(side(), side({ version_id: 'ver_test_b' }));
    assert.equal(result.ok, true);
    assert.deepEqual(result.limitations, []);
    assert.deepEqual(result.missingBySide, { a: [], b: [] });
  });

  it('menolak sisi yang kehilangan satu metrik wajib dan menyebut kodenya', () => {
    const result = checkEligibility(side(), side({ version_id: 'ver_test_b', metrics: { durability: null } }));
    assert.equal(result.ok, false);
    assert.deepEqual(result.missingBySide.b, ['durability']);
    assert.deepEqual(result.limitations, ['missing_metric:durability:b']);
  });

  it('membedakan tier yang tidak dapat di-rank dari metrik yang hilang', () => {
    const result = checkEligibility(side({ tierRank: null, rankable: false }), side());
    assert.equal(result.ok, false);
    assert.deepEqual(result.limitations, ['unknown_metric:tier:a']);
    assert.deepEqual(result.missingBySide.a, ['tier']);
  });

  it('mengumpulkan beberapa metrik hilang secara terurut dan tanpa duplikat', () => {
    const a = side({ metrics: { speed: null, attack_potency: null } });
    const b = side({ version_id: 'ver_test_b', metrics: { attack_potency: null } });
    const result = checkEligibility(a, b);
    assert.equal(result.ok, false);
    assert.deepEqual(result.missingBySide.a, ['attack_potency', 'speed']);
    assert.deepEqual(result.limitations, [
      'missing_metric:attack_potency:a',
      'missing_metric:attack_potency:b',
      'missing_metric:speed:a',
    ]);
  });
});

describe('checkDominance — kapan gerbang aktif', () => {
  const dominantA = side({ tierRank: 30, metrics: { durability: 30, speed: 30 } });
  const trailingB = side({ version_id: 'ver_test_b', tierRank: 20 });

  it('aktif saat selisih tier ≥ ambang dan durability ≥ ambang', () => {
    const result = checkDominance(dominantA, trailingB, defaultRuleSet, []);
    assert.equal(result.applies, true);
    assert.equal(result.dominantSide, 'a');
    assert.equal(result.blockedBy, null);
    assert.equal(result.tierDelta, 10);
    assert.equal(result.durabilityDelta, 10);
  });

  it('menentukan sisi dominan dari tier, bukan dari durability', () => {
    const result = checkDominance(trailingB, dominantA, defaultRuleSet, []);
    assert.equal(result.applies, true);
    assert.equal(result.dominantSide, 'b');
  });

  it('melaporkan selisih speed meski tidak dipakai sebagai syarat', () => {
    const result = checkDominance(dominantA, trailingB, defaultRuleSet, []);
    assert.equal(result.speedDelta, 10);
  });

  it('tidak aktif saat gate dimatikan rule set', () => {
    const disabled = ruleSetWithConstants({
      dominance_gate: { ...defaultRuleSet.constants.dominance_gate, enabled: false },
    });
    const result = checkDominance(dominantA, trailingB, disabled, []);
    assert.equal(result.applies, false);
    assert.equal(result.blockedBy, 'gate_disabled');
  });

  it('tidak aktif saat selisih tier di bawah ambang', () => {
    const a = side({ tierRank: 27, metrics: { durability: 30 } });
    const result = checkDominance(a, trailingB, defaultRuleSet, []);
    assert.equal(result.applies, false);
    assert.equal(result.blockedBy, 'tier_delta_below_threshold');
  });

  it('tidak aktif saat selisih durability di bawah ambang', () => {
    const a = side({ tierRank: 30, metrics: { durability: 25 } });
    const result = checkDominance(a, trailingB, defaultRuleSet, []);
    assert.equal(result.applies, false);
    assert.equal(result.blockedBy, 'durability_delta_below_threshold');
  });
});

describe('checkDominance — alasan gerbang dilewati', () => {
  const dominantA = side({ tierRank: 30, metrics: { durability: 30, speed: 30 } });
  const trailingB = side({ version_id: 'ver_test_b', tierRank: 20 });

  it('dilewati bila pihak yang tertinggal punya decisive edge', () => {
    const result = checkDominance(dominantA, trailingB, defaultRuleSet, [
      outcome({ side: 'b', decisive: true }),
    ]);
    assert.equal(result.applies, false);
    assert.equal(result.blockedBy, 'trailing_side_has_decisive_edge');
  });

  it('tidak terpengaruh decisive edge milik pihak yang dominan', () => {
    const result = checkDominance(dominantA, trailingB, defaultRuleSet, [
      outcome({ side: 'a', decisive: true }),
    ]);
    assert.equal(result.applies, true);
  });

  it('dilewati bila tertinggal punya resistensi tersumber atas ability ofensif dominan', () => {
    const attacker = side({
      tierRank: 30,
      metrics: { durability: 30 },
      abilities: [ability({ category_slug: 'mind-manipulation' })],
    });
    const defender = side({
      version_id: 'ver_test_b',
      tierRank: 20,
      resistances: [resistance({ category_slug: 'mind-manipulation', verification_status: 'verified' })],
    });
    const result = checkDominance(attacker, defender, defaultRuleSet, []);
    assert.equal(result.applies, false);
    assert.equal(result.blockedBy, 'trailing_side_has_sourced_resistance');
  });

  it('tetap aktif bila resistensi tidak tersumber (RS-1)', () => {
    const attacker = side({
      tierRank: 30,
      metrics: { durability: 30 },
      abilities: [ability({ category_slug: 'mind-manipulation' })],
    });
    const defender = side({
      version_id: 'ver_test_b',
      tierRank: 20,
      resistances: [
        resistance({ category_slug: 'mind-manipulation', verification_status: 'unknown', confidence: 0.2 }),
      ],
    });
    const result = checkDominance(attacker, defender, defaultRuleSet, []);
    assert.equal(result.applies, true);
  });

  it('tetap aktif bila resistensi tidak relevan dengan ability ofensif dominan', () => {
    const attacker = side({
      tierRank: 30,
      metrics: { durability: 30 },
      abilities: [ability({ category_slug: 'mind-manipulation' })],
    });
    const defender = side({
      version_id: 'ver_test_b',
      tierRank: 20,
      resistances: [resistance({ category_slug: 'time-manipulation', verification_status: 'verified' })],
    });
    const result = checkDominance(attacker, defender, defaultRuleSet, []);
    assert.equal(result.applies, true);
  });

  it('mengabaikan resistensi bila rule set tidak menuntutnya', () => {
    const attacker = side({
      tierRank: 30,
      metrics: { durability: 30 },
      abilities: [ability({ category_slug: 'mind-manipulation' })],
    });
    const defender = side({
      version_id: 'ver_test_b',
      tierRank: 20,
      resistances: [resistance({ category_slug: 'mind-manipulation', verification_status: 'verified' })],
    });
    const lenient = ruleSetWithConstants({
      dominance_gate: {
        ...defaultRuleSet.constants.dominance_gate,
        requires_no_relevant_resistance: false,
      },
    });
    const result = checkDominance(attacker, defender, lenient, []);
    assert.equal(result.applies, true);
  });

  it('memeriksa ambang tier sebelum durability', () => {
    // Keduanya di bawah ambang: alasan yang dilaporkan harus yang pertama dievaluasi,
    // supaya audit tidak menunjuk syarat yang sebenarnya sudah terpenuhi.
    const a = side({ tierRank: 24, metrics: { durability: 21 } });
    const result = checkDominance(a, trailingB, defaultRuleSet, []);
    assert.equal(result.blockedBy, 'tier_delta_below_threshold');
  });
});
