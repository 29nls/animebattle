/**
 * Unit test Layer 3 (weighted scoring) — PRD §17.1–§17.2.
 *
 * Skor tertimbang adalah satu-satunya bagian engine yang boleh "berhitung bebas".
 * Karena itu test-nya memeriksa dua hal sekaligus: aritmetikanya benar
 * (kontribusi = nilai × bobot / 100, jumlah bobot 100), dan setiap angka yang
 * masuk dapat diaudit — ada catatan alasan, dan metrik yang tidak dapat
 * dibandingkan dinolkan alih-alih ditebak.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resistanceCoverage } from '../../src/services/battle/hax-engine.ts';
import { prepareRankMetrics } from '../../src/services/battle/metrics.ts';
import { WEIGHT_KEYS } from '../../src/services/battle/rule-set.ts';
import { buildScoreBreakdown, logistic, weightedScore } from '../../src/services/battle/scoring.ts';
import type { ScoreContribution, SideData } from '../../src/services/battle/types.ts';
import { ability, conditions, defaultRuleSet, outcome, resistance, side, stat } from './helpers.ts';

type ConditionOverrides = Parameters<typeof conditions>[0];

function breakdownOf(
  sideA: SideData,
  sideB: SideData,
  outcomes: ReturnType<typeof outcome>[] = [],
  conditionOverrides: ConditionOverrides = {},
) {
  return buildScoreBreakdown({
    sideA,
    sideB,
    prepared: prepareRankMetrics(sideA, sideB, defaultRuleSet),
    outcomes,
    coverageA: resistanceCoverage(sideA, sideB, 'a', defaultRuleSet),
    coverageB: resistanceCoverage(sideB, sideA, 'b', defaultRuleSet),
    conditions: conditions(conditionOverrides),
    ruleSet: defaultRuleSet,
  });
}

function row(rows: ScoreContribution[], metric: string): ScoreContribution {
  const found = rows.find((r) => r.metric === metric);
  assert.ok(found, `baris "${metric}" tidak ada`);
  return found;
}

const fasterA = () => side({ metrics: { speed: 40, reaction_speed: 40, combat_speed: 40 } });
const slowerB = () => side({ version_id: 'ver_test_b' });

describe('buildScoreBreakdown — aritmetika', () => {
  it('menghasilkan satu baris per kunci bobot, terurut seperti WEIGHT_KEYS', () => {
    const { breakdown } = breakdownOf(side(), slowerB());
    assert.equal(breakdown.length, WEIGHT_KEYS.length);
    assert.deepEqual(
      breakdown.map((r) => r.metric),
      [...WEIGHT_KEYS],
    );
  });

  it('menyalin bobot dari rule set apa adanya', () => {
    const { breakdown } = breakdownOf(side(), slowerB());
    for (const r of breakdown) {
      assert.equal(r.weight, defaultRuleSet.weights[r.metric], r.metric);
    }
    assert.equal(
      breakdown.reduce((sum, r) => sum + r.weight, 0),
      100,
    );
  });

  it('menghitung kontribusi sebagai nilai × bobot / 100', () => {
    const { breakdown } = breakdownOf(fasterA(), slowerB());
    for (const r of breakdown) {
      assert.ok(
        Math.abs(r.contribution - (r.a_value * r.weight) / 100) <= 1e-4,
        `${r.metric}: ${r.contribution} vs ${(r.a_value * r.weight) / 100}`,
      );
    }
  });

  it('memberi catatan berupa string atau null, tanpa string kosong', () => {
    // `null` berarti "tidak ada yang perlu dijelaskan", bukan "tidak diaudit":
    // baris yang nilainya diredam/dinolkan selalu membawa alasan (diuji di bawah).
    const { breakdown } = breakdownOf(side(), slowerB());
    assert.ok(
      breakdown.every((r) => r.note === null || r.note.length > 0),
      breakdown.map((r) => `${r.metric}=${String(r.note)}`).join(', '),
    );
  });

  it('memberi catatan pada baris turunan (ability, hax, resistensi, pengalaman)', () => {
    const { breakdown } = breakdownOf(side(), slowerB());
    for (const metric of ['abilities', 'hax', 'resistances', 'experience']) {
      const note = row(breakdown, metric).note;
      assert.ok(typeof note === 'string' && note.length > 0, `${metric}=${String(note)}`);
    }
  });

  it('menjepit setiap nilai ke [-1, 1]', () => {
    const extremeA = side({ metrics: { speed: 999, stamina: 999, range: 999 } });
    const { breakdown } = breakdownOf(extremeA, slowerB());
    assert.ok(breakdown.every((r) => r.a_value >= -1 && r.a_value <= 1));
  });
});

describe('weightedScore', () => {
  it('merupakan jumlah kontribusi', () => {
    const { breakdown } = breakdownOf(fasterA(), slowerB());
    const expected = breakdown.reduce((sum, r) => sum + r.contribution, 0);
    assert.ok(Math.abs(weightedScore(breakdown) - expected) < 1e-9);
  });

  it('memberi 0 untuk dua sisi identik', () => {
    const { breakdown } = breakdownOf(side(), side({ version_id: 'ver_test_b' }));
    assert.ok(Math.abs(weightedScore(breakdown)) < 1e-9);
  });

  it('tetap berada pada [-1, 1] karena bobot berjumlah 100', () => {
    const extreme = side({
      tierRank: 40,
      metrics: {
        attack_potency: 60,
        durability: 60,
        speed: 60,
        reaction_speed: 60,
        combat_speed: 60,
        range: 60,
        stamina: 60,
        intelligence: 60,
        battle_iq: 60,
        experience: 999,
      },
    });
    const { breakdown } = breakdownOf(extreme, slowerB());
    const score = weightedScore(breakdown);
    assert.ok(score > 0 && score <= 1, `didapat ${score}`);
  });
});

describe('logistic', () => {
  it('memberi 0,5 pada skor nol', () => {
    assert.equal(logistic(0, 2.2), 0.5);
  });

  it('naik monoton', () => {
    assert.ok(logistic(1, 2.2) > logistic(0.5, 2.2));
    assert.ok(logistic(0.5, 2.2) > logistic(0, 2.2));
    assert.ok(logistic(-0.5, 2.2) < logistic(0, 2.2));
  });

  it('tetap di dalam (0, 1) dan simetris di sekitar 0,5', () => {
    assert.ok(logistic(1, 2.2) > 0.9 && logistic(1, 2.2) < 1);
    assert.ok(logistic(-1, 2.2) > 0 && logistic(-1, 2.2) < 0.1);
    assert.ok(Math.abs(logistic(0.4, 2.2) + logistic(-0.4, 2.2) - 1) < 1e-12);
  });
});

describe('buildScoreBreakdown — modifikasi kondisi', () => {
  it('menolkan baris kecepatan pada mode equal_speed', () => {
    const { breakdown } = breakdownOf(fasterA(), slowerB(), [], { mode: 'equal_speed' });
    const speed = row(breakdown, 'speed');
    assert.equal(speed.a_value, 0);
    assert.equal(speed.note, 'kecepatan disetarakan oleh kondisi pertarungan');
  });

  it('memotong kontribusi kecepatan reaksi dan aksi menjadi separuh', () => {
    const standard = breakdownOf(fasterA(), slowerB()).breakdown;
    const equalized = breakdownOf(fasterA(), slowerB(), [], { mode: 'equal_speed' }).breakdown;
    for (const metric of ['reaction_speed', 'combat_speed']) {
      assert.equal(row(standard, metric).a_value, 1);
      assert.equal(row(equalized, metric).a_value, 0.5);
      assert.match(row(equalized, metric).note ?? '', /dihitung separuh/);
    }
  });

  it('berlaku juga lewat flag speed_equalized tanpa mengubah mode', () => {
    const { breakdown } = breakdownOf(fasterA(), slowerB(), [], { speed_equalized: true });
    assert.equal(row(breakdown, 'speed').a_value, 0);
    assert.equal(row(breakdown, 'reaction_speed').a_value, 0.5);
  });

  it('memperkuat battle IQ pada mode random_encounter', () => {
    const a = side({ metrics: { battle_iq: 21 } });
    const standard = row(breakdownOf(a, slowerB()).breakdown, 'battle_iq');
    const random = row(breakdownOf(a, slowerB(), [], { mode: 'random_encounter' }).breakdown, 'battle_iq');
    assert.equal(standard.a_value, 0.5);
    assert.equal(random.a_value, 0.6);
    assert.equal(random.note, 'random encounter: battle IQ diperkuat 1,2×');
  });
});

describe('buildScoreBreakdown — baris turunan', () => {
  it('menghitung jumlah dan kedalaman ability', () => {
    const a = side({
      abilities: [
        ability({ id: 'ab_1', proficiency: 'advanced' }),
        ability({ id: 'ab_2', proficiency: 'advanced' }),
      ],
    });
    const { breakdown } = breakdownOf(a, slowerB());
    const abilities = row(breakdown, 'abilities');
    assert.equal(abilities.a_value, 0.5);
    assert.equal(abilities.note, 'kemampuan terdokumentasi A=2, B=0');
  });

  it('mencatat bila kedua sisi tanpa ability', () => {
    const { breakdown } = breakdownOf(side(), slowerB());
    assert.equal(row(breakdown, 'abilities').note, 'kedua sisi tanpa ability terdokumentasi');
  });

  it('memakai tekanan hax efektif untuk baris hax', () => {
    const a = side({ abilities: [ability({ id: 'ab_x' })] });
    const { breakdown } = breakdownOf(a, slowerB(), [
      outcome({ side: 'a', ability_id: 'ab_x', decisive: true, effectiveness: 1 }),
    ]);
    const hax = row(breakdown, 'hax');
    assert.equal(hax.a_value, 0.25);
    assert.equal(hax.note, 'tekanan efektif A=1.00, B=0.00');
  });

  it('memakai selisih cakupan resistensi untuk baris resistances', () => {
    const a = side({
      abilities: [ability({ id: 'ab_a', category_slug: 'mind-manipulation' })],
      resistances: [resistance({ category_slug: 'teleportation', level_label: 'moderate' })],
    });
    const b = side({
      version_id: 'ver_test_b',
      abilities: [ability({ id: 'ab_b', category_slug: 'teleportation' })],
    });
    const { breakdown } = breakdownOf(a, b);
    const res = row(breakdown, 'resistances');
    assert.equal(res.a_value, 1);
    // B tidak punya resistensi, tetapi tetap punya satu kategori ofensif lawan
    // yang harus ditahan — karena itu penyebutnya 1, bukan 0.
    assert.equal(res.note, 'cakupan A=1/1, B=0/1');
  });

  it('memberi catatan tahun pengalaman bila keduanya terdokumentasi', () => {
    const a = side({ metrics: { experience: 100 } });
    const { breakdown } = breakdownOf(a, slowerB());
    const experience = row(breakdown, 'experience');
    assert.equal(experience.note, 'tahun pengalaman A=100, B=10');
    // log10(101)/log10(11) - 1 ≈ 0,9247 — rasio logaritmik, bukan selisih linear.
    assert.ok(experience.a_value > 0.9 && experience.a_value < 1, `didapat ${experience.a_value}`);
  });

  it('menandai pengalaman yang terdokumentasi sebagian', () => {
    const a = side({ metrics: { experience: null } });
    const { breakdown } = breakdownOf(a, slowerB());
    assert.equal(row(breakdown, 'experience').note, 'tahun pengalaman tidak terdokumentasi sebagian');
  });
});

describe('buildScoreBreakdown — kejujuran data', () => {
  it('memberi gapRatio 0 saat semua input skoring tersedia', () => {
    const { gapRatio } = breakdownOf(side(), slowerB());
    assert.equal(gapRatio, 0);
  });

  it('menaikkan gapRatio saat metrik skoring hilang', () => {
    const b = side({ version_id: 'ver_test_b', metrics: { range: null } });
    const { gapRatio, breakdown } = breakdownOf(side(), b);
    assert.ok(Math.abs(gapRatio - 1 / 13) < 1e-9, `didapat ${gapRatio}`);
    assert.equal(row(breakdown, 'range').a_value, 0);
    assert.equal(row(breakdown, 'range').note, 'metrik tidak terdokumentasi pada sisi B');
  });

  it('mencatat asumsi ketiadaan ability dan ketiadaan resistensi', () => {
    const { assumptions } = breakdownOf(side(), slowerB());
    assert.deepEqual(assumptions, [
      'no_documented_abilities:a',
      'no_documented_abilities:b',
      'no_documented_resistances:a',
      'no_documented_resistances:b',
    ]);
  });

  it('mengumpulkan keterbatasan secara unik dan terurut', () => {
    const a = side({ statistics: [stat({ metric: 'speed', qualifier: 'varies' })] });
    const b = side({
      version_id: 'ver_test_b',
      statistics: [stat({ metric: 'speed', qualifier: 'unknown' })],
    });
    const { limitations } = breakdownOf(a, b);
    assert.deepEqual(limitations, ['unknown_metric:speed:b', 'varies_metric:speed:a']);
    assert.equal(new Set(limitations).size, limitations.length);
  });

  it('menghitung kualifikasi lemah hanya dari baris berstatus current', () => {
    const a = side({
      statistics: [
        stat({ metric: 'striking_strength', qualifier: 'possibly' }),
        stat({ metric: 'lifting_strength', qualifier: 'possibly' }),
        stat({ metric: 'range', qualifier: 'possibly', status: 'superseded' }),
      ],
    });
    const { weakQualifierCount } = breakdownOf(a, slowerB());
    assert.equal(weakQualifierCount.a, 2);
    assert.equal(weakQualifierCount.b, 0);
  });

  it('menghitung sumber yang berkonflik dan ability berkeyakinan rendah', () => {
    const a = side({
      statistics: [stat({ metric: 'range', status: 'conflicting', qualifier: 'exact' })],
      abilities: [
        ability({ id: 'ab_1', confidence: 0.4 }),
        ability({ id: 'ab_2', confidence: 0.9 }),
      ],
    });
    const { conflictingCount, lowConfidenceAbilities } = breakdownOf(a, slowerB());
    assert.equal(conflictingCount, 1);
    assert.equal(lowConfidenceAbilities.a, 1);
  });
});
