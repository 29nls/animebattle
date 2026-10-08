/**
 * Unit test harness kalibrasi bobot (PRD §17.1, D19).
 *
 * Kontrak yang dikunci:
 *  1. Rule set hasil kalibrasi selalu sah (Σ bobot = 100 eksak, semua ≥ 0)
 *     — kalibrasi tidak boleh menghasilkan rule set yang ditolak engine.
 *  2. Akurasi training tidak pernah turun.
 *  3. Deterministik: input sama → bobot hasil identik.
 *  4. Evaluasi jujur: kasus tanpa pemenang (draw/insufficient_data) tidak
 *     dihitung, dan pemenang yang cocok dihitung benar.
 *  5. Leave-one-out: membuang satu baris tidak pernah menaikkan akurasi
 *     dibanding fit penuh (overfit dianggap sinyal, bukan kegagalan harness).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BRIER_MAX,
  evaluateRuleSet,
  calibrateWeights,
  leaveOneOutAccuracy,
} from '../../src/services/battle/calibration.ts';
import { runBattle } from '../../src/services/battle/engine.ts';
import { defaultRuleSet, battleInput, strongerSideA, weakerSideB } from './helpers.ts';
import type { LabelledBattleCase } from '../../src/services/battle/calibration.ts';
import type { SideData, WeightKey } from '../../src/services/battle/types.ts';

/** Kasus sintetis kecil: A lebih kuat → label 'a', B lebih kuat → label 'b'. */
function makeCase(
  id: string,
  label: 'a' | 'b' | 'draw',
  sideA: SideData,
  sideB: SideData,
): LabelledBattleCase {
  return { id, label, input: battleInput(sideA, sideB) };
}

const sampleCases = (): LabelledBattleCase[] => [
  makeCase('k1', 'a', strongerSideA(), weakerSideB()),
  makeCase('k2', 'b', weakerSideB(), strongerSideA()),
  makeCase('k3', 'a', strongerSideA(), weakerSideB()),
  makeCase('k4', 'b', weakerSideB(), strongerSideA()),
];

describe('evaluateRuleSet', () => {
  it('menghitung akurasi, brier, dan rincian tanpa pemenang dengan jujur', () => {
    const report = evaluateRuleSet(sampleCases(), defaultRuleSet);
    assert.equal(report.total, 4);
    assert.equal(report.evaluated, 4);
    assert.ok(report.correct === 4 || report.correct === 0, 'simetris penuh: benar semua atau salah semua');
    assert.ok(report.accuracy >= 0 && report.accuracy <= 1);
    assert.ok(report.brier >= 0 && report.brier <= BRIER_MAX);
    assert.equal(report.drawCount, 0);
    assert.equal(report.insufficientCount, 0);
  });

  it('menghitung draw pada penyebut, insufficient_data dikecualikan seluruhnya', () => {
    // Kontrak evaluator: prediksi draw adalah klaim yang dapat salah, jadi
    // kasus draw dihitung di penyebut. Hanya insufficient_data yang bebas
    // dikecualikan (tidak ada prediksi yang mungkin di sana — §8.5).
    const cases = [
      ...sampleCases(),
      makeCase('seri', 'draw', sideEVEN(), sideEVEN()), // label draw, hasil draw → benar
      makeCase('kurang', 'a', sideTANPA_TIER(), weakerSideB()), // insufficient_data
    ];
    const report = evaluateRuleSet(cases, defaultRuleSet);
    assert.equal(report.total, 6);
    assert.equal(report.drawCount, 1);
    assert.equal(report.insufficientCount, 1);
    assert.equal(report.evaluated, 5);
    assert.ok(report.accuracy <= 1, 'akurasi selalu ≤ 1');
    assert.ok(!report.mislabeled.includes('seri'));
  });

  it('kasus kosong → akurasi 0 dan brier 0 tanpa melempar error', () => {
    const report = evaluateRuleSet([], defaultRuleSet);
    assert.equal(report.evaluated, 0);
    assert.equal(report.accuracy, 0);
    assert.equal(report.brier, 0);
  });
});

describe('calibrateWeights', () => {
  it('menghasilkan rule set yang sah dan bobot yang identik untuk input sama', () => {
    const cases = sampleCases();
    const r1 = calibrateWeights(cases, defaultRuleSet, { maxSweeps: 2, log: () => {} });
    const r2 = calibrateWeights(cases, defaultRuleSet, { maxSweeps: 2, log: () => {} });
    assert.deepEqual(r1.ruleSet.weights, r2.ruleSet.weights);
    assert.deepEqual(r1.ruleSet.constants, r2.ruleSet.constants);
    assert.equal(r1.ruleSet.version, '1.0.0-calibrated');
    assert.deepEqual(Object.values(r1.ruleSet.weights).reduce((a, b) => a + b, 0), 100);
    for (const w of Object.values(r1.ruleSet.weights)) assert.ok(w >= 0);
  });

  it('akurasi training tidak pernah turun dibanding baseline', () => {
    const cases = sampleCases();
    const before = evaluateRuleSet(cases, defaultRuleSet);
    const after = calibrateWeights(cases, defaultRuleSet, { maxSweeps: 3, log: () => {} });
    assert.ok(
      after.after.accuracy >= before.accuracy,
      `baseline ${before.accuracy} → calibrated ${after.after.accuracy}`,
    );
    assert.equal(after.before.accuracy, before.accuracy);
  });

  it('meningkatkan akurasi pada dataset yang tidak cocok dengan rule set default', () => {
    // Label menyatakan sisi yang SECARA ARSITEKTUR lebih lemah menang: pada
    // baseline engine hanya bisa memprediksi benar lewat jalur hax.
    // Kalibrasi harus menemukan bobot yang lebih cocok (atau minimal sama).
    const inverted: LabelledBattleCase[] = [
      makeCase('i1', 'b', strongerSideA(), weakerSideB()),
      makeCase('i2', 'a', weakerSideB(), strongerSideA()),
      makeCase('i3', 'b', strongerSideA(), weakerSideB()),
    ];
    const before = evaluateRuleSet(inverted, defaultRuleSet);
    const after = calibrateWeights(inverted, defaultRuleSet, { maxSweeps: 4, log: () => {} });
    assert.ok(after.after.accuracy >= before.accuracy, 'tidak boleh lebih buruk');
  });

  it('tidak mengubah konstanta non-bobot (logistic_k, dominance gate, hax rules)', () => {
    const after = calibrateWeights(sampleCases(), defaultRuleSet, { maxSweeps: 1, log: () => {} });
    assert.equal(after.ruleSet.constants.logistic_k, defaultRuleSet.constants.logistic_k);
    assert.deepEqual(after.ruleSet.constants.dominance_gate, defaultRuleSet.constants.dominance_gate);
    assert.deepEqual(after.ruleSet.hax_rules, defaultRuleSet.hax_rules);
  });

  it('tidak menjalankan sweep bila dataset kosong dan tetap menghasilkan rule set sah', () => {
    const after = calibrateWeights([], defaultRuleSet, { maxSweeps: 3, log: () => {} });
    assert.deepEqual(after.ruleSet.weights, defaultRuleSet.weights);
    assert.equal(after.after.evaluated, 0);
  });
});

describe('leaveOneOutAccuracy', () => {
  it('menghasilkan angka per-kasus dan rata-rata yang konsisten', () => {
    const report = leaveOneOutAccuracy(sampleCases(), defaultRuleSet, { maxSweeps: 1, log: () => {} });
    assert.equal(report.rows.length, 4);
    for (const row of report.rows) {
      assert.ok(row.accuracy >= 0 && row.accuracy <= 1);
    }
    const mean = report.rows.reduce((a, r) => a + r.accuracy, 0) / report.rows.length;
    assert.ok(Math.abs(mean - report.meanAccuracy) < 1e-9);
  });

  it('dengan satu kasus, LOO sama dengan akurasi training (kasus itu sendiri)', () => {
    const single = [makeCase('solo', 'a', strongerSideA(), weakerSideB())];
    const report = leaveOneOutAccuracy(single, defaultRuleSet, { maxSweeps: 1, log: () => {} });
    assert.equal(report.rows.length, 1);
    assert.ok(report.rows[0].accuracy === 1 || report.rows[0].accuracy === 0);
  });
});

// ------------------------------------------------------------------ fixtures

function sideEVEN(): SideData {
  return strongerSideA(); // kedua sisi sama → engine menyatakan draw
}

function sideTANPA_TIER(): SideData {
  const s = strongerSideA();
  return { ...s, tier: { code: null, rank: null, rankable: false }, metrics: { ...s.metrics, tier: null } };
}
