/**
 * Unit test Layer 4–5 (kalibrasi, difficulty, battle length) — PRD §17.3.
 *
 * Urutan kalibrasi adalah kontrak, bukan detail implementasi:
 *   1. lantai decisive edge diterapkan,
 *   2. hasil ditarik ke 0,5 oleh penalti kualifikasi (maksimum, dibatasi 0,20),
 *   3. hasil ditarik ke 0,5 oleh rasio data yang hilang,
 *   4. lantai decisive edge DIPULIHKAN,
 *   5. hasil dijepit ke [0,02; 0,98].
 *
 * Test di bawah mengunci urutan itu, karena menukar langkah 2 dan 4 akan membuat
 * "kemampuan penentu" dapat dikalahkan oleh metrik yang tidak terdokumentasi —
 * tepat kebalikan dari maksud kalibrasi.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeBattleLength, computeDifficulty } from '../../src/services/battle/difficulty.ts';
import { runBattle } from '../../src/services/battle/engine.ts';
import { logistic } from '../../src/services/battle/scoring.ts';
import type { SideData } from '../../src/services/battle/types.ts';
import {
  ability,
  battleInput,
  defaultRuleSet,
  outcome,
  side,
  stat,
  strongerSideA,
  weakerSideB,
} from './helpers.ts';

const DECISIVE = ability({ id: 'ab_decisive', category_slug: 'mind-manipulation' });

function run(a: SideData, b: SideData, statisticOverrides: Parameters<typeof stat>[0][] = []) {
  const sides = statisticOverrides.length > 0 ? { ...a, statistics: statisticOverrides.map((o) => stat(o)) } : a;
  return runBattle(battleInput(sides, b), defaultRuleSet);
}

describe('kalibrasi — dominasi mutlak (Layer 1)', () => {
  it('memakai probabilitas minimum rule set, bukan hasil logistik', () => {
    const a = side({ version_id: 'ver_a', tierRank: 30, metrics: { durability: 30, speed: 30 } });
    const b = side({ version_id: 'ver_b', tierRank: 20 });
    const result = run(a, b);
    assert.equal(result.dominance.applies, true);
    assert.equal(result.dominance.blocked_by, null);
    assert.equal(result.winner, 'a');
    assert.equal(result.win_probability.a, 0.95);
    assert.equal(result.win_probability.b, 0.05);
    assert.equal(result.difficulty, 'low');
  });

  it('membalik arah probabilitas saat sisi B yang dominan', () => {
    const a = side({ version_id: 'ver_a', tierRank: 30, metrics: { durability: 30, speed: 30 } });
    const b = side({ version_id: 'ver_b', tierRank: 20 });
    const result = run(b, a);
    assert.equal(result.dominance.dominant_side, 'b');
    assert.equal(result.winner, 'b');
    assert.equal(result.win_probability.a, 0.05);
    assert.equal(result.win_probability.b, 0.95);
  });

  it('tidak memakai jalur dominasi saat selisih tier di bawah ambang', () => {
    const result = run(strongerSideA(), weakerSideB());
    assert.equal(result.dominance.applies, false);
    assert.equal(result.dominance.blocked_by, 'tier_delta_below_threshold');
    assert.equal(result.winner, 'a');
    assert.ok(result.win_probability.a > 0.6 && result.win_probability.a < 0.9);
  });
});

describe('kalibrasi — lantai decisive edge', () => {
  it('menaikkan probabilitas ke lantai 0,90 saat hanya satu sisi punya jalur penentu', () => {
    const a = { ...strongerSideA(), abilities: [DECISIVE] };
    const result = run(a, weakerSideB());
    assert.equal(result.decisive_edges.filter((e) => e.decisive).length, 1);
    assert.equal(result.win_probability.a, 0.9);
    assert.equal(result.winner, 'a');
  });

  it('menjepit ke rentang bersama saat kedua sisi punya jalur penentu', () => {
    const a = { ...strongerSideA(), abilities: [DECISIVE] };
    const b = { ...weakerSideB(), abilities: [DECISIVE] };
    const result = run(a, b);
    assert.equal(result.decisive_edges.filter((e) => e.decisive).length, 2);
    assert.ok(
      result.win_probability.a >= 0.35 && result.win_probability.a <= 0.65,
      `didapat ${result.win_probability.a}`,
    );
  });

  it('membalik lantai untuk sisi B', () => {
    const b = { ...weakerSideB(), abilities: [DECISIVE] };
    const result = run(strongerSideA(), b);
    assert.equal(result.win_probability.a, 0.1);
    assert.equal(result.winner, 'b');
  });
});

describe('kalibrasi — penarikan oleh kualifikasi', () => {
  // Baris statistik pada metrik `experience` hanya mempengaruhi penalti kualifikasi:
  // pengalaman dibaca dari metrics.experience, dan `experience` bukan metrik ber-rank.
  // Karena itu test ini mengukur penarikan kalibrasi tanpa mengubah skor tertimbang.
  const baseline = () => run(strongerSideA(), weakerSideB()).win_probability.a;

  it('menarik hasil ke 0,5 sebesar penalti kualifikasi', () => {
    const p0 = baseline();
    const p1 = run(strongerSideA(), weakerSideB(), [
      { metric: 'experience', qualifier: 'at_least', status: 'current' },
    ]).win_probability.a;
    assert.ok(p1 < p0, `diharapkan turun: ${p1} vs ${p0}`);
    assert.ok(Math.abs(p1 - (p0 + (0.5 - p0) * 0.1)) < 1e-3, `didapat ${p1}`);
  });

  it('memakai penalti terbesar, bukan jumlah penalti', () => {
    const one = run(strongerSideA(), weakerSideB(), [
      { metric: 'experience', qualifier: 'at_least', status: 'current' },
    ]).win_probability.a;
    const mixed = run(strongerSideA(), weakerSideB(), [
      { metric: 'experience', qualifier: 'at_least', status: 'current' },
      { metric: 'experience', qualifier: 'exact', status: 'current' },
    ]).win_probability.a;
    assert.equal(mixed, one);
  });

  it('membatasi penalti pada 0,20 sekalipun kualifikasinya lebih berat', () => {
    const p0 = baseline();
    const one = run(strongerSideA(), weakerSideB(), [
      { metric: 'experience', qualifier: 'unknown', status: 'current' },
    ]).win_probability.a;
    const many = run(strongerSideA(), weakerSideB(), [
      { metric: 'experience', qualifier: 'unknown', status: 'current' },
      { metric: 'experience', qualifier: 'unknown', status: 'current' },
      { metric: 'experience', qualifier: 'unknown', status: 'current' },
    ]).win_probability.a;

    assert.equal(many, one);
    assert.ok(Math.abs(one - (p0 + (0.5 - p0) * 0.2)) < 1e-3, `didapat ${one}`);
  });

  it('mengabaikan baris statistik yang tidak berstatus current', () => {
    const p0 = baseline();
    const superseded = run(strongerSideA(), weakerSideB(), [
      { metric: 'experience', qualifier: 'unknown', status: 'superseded' },
    ]).win_probability.a;
    assert.equal(superseded, p0);
  });
});

describe('kalibrasi — penarikan oleh data yang hilang', () => {
  it('menarik hasil sebesar rasio input skoring yang hilang', () => {
    const b = side({ version_id: 'ver_weak_b', tierRank: 20, metrics: { range: null } });
    const result = run(strongerSideA(), b);
    const beforePull = logistic(result.weighted_score, defaultRuleSet.constants.logistic_k);
    const expected = beforePull + (0.5 - beforePull) * (1 / 13);
    assert.ok(
      Math.abs(result.win_probability.a - expected) < 1e-3,
      `didapat ${result.win_probability.a}, diharapkan ${expected}`,
    );
    assert.ok(result.win_probability.a < beforePull);
    assert.ok(result.limitations.includes('missing_metric:range:b'));
  });

  it('tidak menarik sama sekali saat semua input tersedia', () => {
    const result = run(strongerSideA(), weakerSideB());
    const expected = logistic(result.weighted_score, defaultRuleSet.constants.logistic_k);
    assert.ok(Math.abs(result.win_probability.a - expected) < 1e-3, `didapat ${result.win_probability.a}`);
    assert.deepEqual(result.limitations, []);
  });

  it('memulihkan lantai decisive edge setelah penarikan (urutan kalibrasi)', () => {
    // Tanpa pemulihan lantai, kualifikasi lemah akan menjatuhkan hasil di bawah
    // 0,90 meski salah satu pihak punya jalur kemenangan yang tidak tertahankan.
    const a = { ...strongerSideA(), abilities: [DECISIVE] };
    const result = run(a, weakerSideB(), [
      { metric: 'experience', qualifier: 'unknown', status: 'current' },
    ]);
    assert.equal(result.win_probability.a, 0.9);
  });
});

describe('kalibrasi — hasil seri dan jepitan akhir', () => {
  it('menyatakan seri hanya saat tidak ada jalur penentu dan hasil hampir seimbang', () => {
    const result = run(side({ version_id: 'ver_a' }), side({ version_id: 'ver_b' }));
    assert.equal(result.winner, 'draw');
    assert.equal(result.win_probability.a, 0.5);
    assert.equal(result.win_probability.b, 0.5);
    assert.equal(result.decisive_edges.length, 0);
    assert.equal(result.difficulty, 'extreme');
    assert.equal(result.battle_length, 'long');
  });

  it('tidak menyatakan seri saat ada keunggulan nyata', () => {
    const result = run(strongerSideA(), weakerSideB());
    assert.notEqual(result.winner, 'draw');
  });

  it('selalu memberi probabilitas dalam [0,02; 0,98] dan berjumlah 1', () => {
    const scenarios = [
      run(strongerSideA(), weakerSideB()),
      run(weakerSideB(), strongerSideA()),
      run(side({ version_id: 'ver_a' }), side({ version_id: 'ver_b' })),
      run({ ...strongerSideA(), abilities: [DECISIVE] }, weakerSideB()),
      run(strongerSideA(), { ...weakerSideB(), abilities: [DECISIVE] }),
    ];
    for (const result of scenarios) {
      assert.ok(result.win_probability.a >= 0.02 && result.win_probability.a <= 0.98);
      assert.ok(Math.abs(result.win_probability.a + result.win_probability.b - 1) < 1e-3);
    }
  });
});

describe('computeDifficulty', () => {
  it('memetakan margin dari 0,5 ke tingkat kesulitan', () => {
    const cases: Array<[number, string]> = [
      [0.95, 'low'],
      [0.9, 'mid'],
      [0.62, 'high'],
      [0.6, 'extreme'],
      [0.5, 'extreme'],
    ];
    for (const [probability, expected] of cases) {
      assert.equal(computeDifficulty(probability, defaultRuleSet), expected, String(probability));
    }
  });

  it('memperlakukan ambang rule set sebagai batas inklusif', () => {
    // Ambang desimal harus berarti apa yang tertulis, bukan apa yang dihasilkan
    // representasi biner: 0,95 - 0,5 = 0,44999999999999996 pada float64.
    const cases: Array<[number, string]> = [
      [0.95, 'low'],
      [0.944, 'mid'],
      [0.78, 'mid'],
      [0.77, 'high'],
      [0.62, 'high'],
      [0.61, 'extreme'],
    ];
    for (const [probability, expected] of cases) {
      assert.equal(computeDifficulty(probability, defaultRuleSet), expected, String(probability));
    }
  });

  it('simetris terhadap 0,5', () => {
    assert.equal(
      computeDifficulty(0.9, defaultRuleSet),
      computeDifficulty(0.1, defaultRuleSet),
    );
  });
});

describe('computeBattleLength', () => {
  const even = { sideA: side({ version_id: 'ver_a' }), sideB: side({ version_id: 'ver_b' }) };

  it('menyatakan singkat saat ada negasi instan dan hasilnya miring', () => {
    const result = computeBattleLength({
      sideA: side({
        version_id: 'ver_a',
        abilities: [ability({ category_is_negation: true, activation_speed: 'instant' })],
      }),
      sideB: side({ version_id: 'ver_b' }),
      outcomes: [],
      probability: 0.8,
    });
    assert.equal(result, 'short');
  });

  it('menyatakan singkat saat ada jalur penentu dan hasilnya miring', () => {
    const result = computeBattleLength({
      ...even,
      outcomes: [outcome({ decisive: true })],
      probability: 0.8,
    });
    assert.equal(result, 'short');
  });

  it('menyatakan singkat saat selisih durability besar', () => {
    const result = computeBattleLength({
      sideA: side({ version_id: 'ver_a', metrics: { durability: 30 } }),
      sideB: side({ version_id: 'ver_b' }),
      outcomes: [],
      probability: 0.55,
    });
    assert.equal(result, 'short');
  });

  it('menyatakan panjang saat kedua sisi punya kemampuan bertahan', () => {
    const result = computeBattleLength({
      sideA: side({ version_id: 'ver_a', metrics: { durability: 25 }, abilities: [ability({ category_slug: 'regeneration', is_offensive: false, is_passive: true })] }),
      sideB: side({ version_id: 'ver_b', abilities: [ability({ category_slug: 'regeneration', is_offensive: false, is_passive: true })] }),
      outcomes: [],
      probability: 0.55,
    });
    assert.equal(result, 'long');
  });

  it('menyatakan panjang saat selisih durability dan kecepatan kecil', () => {
    const result = computeBattleLength({ ...even, outcomes: [], probability: 0.55 });
    assert.equal(result, 'long');
  });

  it('menyatakan sedang pada selisih menengah tanpa jalur penentu', () => {
    const result = computeBattleLength({
      sideA: side({ version_id: 'ver_a', metrics: { durability: 24, speed: 25 } }),
      sideB: side({ version_id: 'ver_b' }),
      outcomes: [],
      probability: 0.55,
    });
    assert.equal(result, 'medium');
  });
});
