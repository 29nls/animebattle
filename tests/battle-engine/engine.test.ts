/**
 * Unit test orkestrasi engine (Layer 0–7) — PRD §16.3, AC-28, AC-31..34.
 *
 * Dua sifat yang dijamin engine dan tidak dapat dibuktikan oleh case library:
 *  - **Determinisme**: input sama → hasil identik, termasuk `input_hash` dan
 *    `battle_id`; hash tidak bergantung pada urutan array maupun urutan kunci.
 *  - **Kemurnian**: hasil tidak boleh bergantung pada waktu atau keacakan. Test di
 *    sini membuktikannya dengan melarang `Date.now` dan `Math.random` selama
 *    pemanggilan — pemeriksaan perilaku, bukan pemeriksaan teks kode.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeInputHash, ENGINE_VERSION, runBattle } from '../../src/services/battle/engine.ts';
import type { MetricValues, SideData } from '../../src/services/battle/types.ts';
import { DISCLAIMER } from '../../src/services/battle/types.ts';
import {
  ability,
  battleInput,
  defaultRuleSet,
  resistance,
  ruleSetWith,
  ruleSetWithConstants,
  side,
  stat,
  strongerSideA,
  weakerSideB,
} from './helpers.ts';

function enrich(base: SideData): SideData {
  return {
    ...base,
    statistics: [stat({ metric: 'speed' }), stat({ metric: 'durability', qualifier: 'possibly' })],
    abilities: [
      ability({ id: 'ab_2', category_slug: 'mind-manipulation' }),
      ability({ id: 'ab_1', category_slug: 'time-manipulation' }),
    ],
    resistances: [resistance({ category_slug: 'time-manipulation', level_label: 'limited', level: 1 })],
    traits: ['tactical'],
  };
}

function run(input: Parameters<typeof runBattle>[0] = battleInput(strongerSideA(), weakerSideB())) {
  return runBattle(input, defaultRuleSet);
}

describe('determinisme', () => {
  it('menghasilkan hasil yang identik pada pemanggilan berulang', () => {
    const input = battleInput(strongerSideA(), weakerSideB());
    assert.deepStrictEqual(runBattle(input, defaultRuleSet), runBattle(input, defaultRuleSet));
  });

  it('menghasilkan input_hash dan battle_id yang identik', () => {
    const first = run();
    const second = run();
    assert.equal(first.input_hash, second.input_hash);
    assert.equal(first.battle_id, second.battle_id);
  });

  it('tidak mengubah input yang diberikan', () => {
    const a = enrich(strongerSideA());
    const b = enrich(weakerSideB());
    const snapshotA = structuredClone(a);
    const snapshotB = structuredClone(b);
    runBattle(battleInput(a, b), defaultRuleSet);
    assert.deepStrictEqual(a, snapshotA);
    assert.deepStrictEqual(b, snapshotB);
  });
});

describe('input_hash', () => {
  it('berformat sha256 dan battle_id memakai 24 heksadesimal pertama', () => {
    const result = run();
    assert.match(result.input_hash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(result.battle_id, `btl_${result.input_hash.slice('sha256:'.length, 'sha256:'.length + 24)}`);
  });

  it('tidak bergantung pada urutan array statistik, ability, dan resistensi', () => {
    const a = enrich(side({ version_id: 'ver_x' }));
    const b = enrich(side({ version_id: 'ver_x' }));
    const reordered: SideData = {
      ...b,
      statistics: [...b.statistics].reverse(),
      abilities: [...b.abilities].reverse(),
      resistances: [...b.resistances].reverse(),
    };
    assert.equal(
      computeInputHash(battleInput(a, weakerSideB()), defaultRuleSet),
      computeInputHash(battleInput(reordered, weakerSideB()), defaultRuleSet),
    );
  });

  it('tidak bergantung pada urutan kunci objek metrik', () => {
    const a = side({ version_id: 'ver_x' });
    const reversedMetrics = Object.fromEntries(
      Object.entries(a.metrics).reverse(),
    ) as MetricValues;
    assert.equal(
      computeInputHash(battleInput(a, weakerSideB()), defaultRuleSet),
      computeInputHash(battleInput({ ...a, metrics: reversedMetrics }, weakerSideB()), defaultRuleSet),
    );
  });

  it('berubah saat metrik, kondisi, atau versi rule set berubah', () => {
    const base = computeInputHash(battleInput(strongerSideA(), weakerSideB()), defaultRuleSet);
    assert.notEqual(
      base,
      computeInputHash(
        battleInput(side({ version_id: 'ver_strong_a', metrics: { durability: 30 } }), weakerSideB()),
        defaultRuleSet,
      ),
    );
    assert.notEqual(
      base,
      computeInputHash(battleInput(strongerSideA(), weakerSideB(), { win_condition: 'bfr' }), defaultRuleSet),
    );
    assert.notEqual(
      base,
      computeInputHash(battleInput(strongerSideA(), weakerSideB()), ruleSetWith({ version: '9.9.9' })),
    );
  });

  it('mengabaikan field yang tidak mempengaruhi hasil (nama tampilan)', () => {
    // Hash hanya memuat hal yang mempengaruhi perhitungan; mengubah nama karakter
    // tidak boleh membuat cache battle_results tidak valid.
    const a = side({ version_id: 'ver_x', name: 'Nama Satu' });
    const renamed = side({ version_id: 'ver_x', name: 'Nama Lain' });
    assert.equal(
      computeInputHash(battleInput(a, weakerSideB()), defaultRuleSet),
      computeInputHash(battleInput(renamed, weakerSideB()), defaultRuleSet),
    );
  });
});

describe('kemurnian (bebas I/O)', () => {
  it('tidak menyentuh waktu maupun keacakan selama perhitungan', () => {
    const dateConstructor = Date as unknown as { now: () => number };
    const realRandom = Math.random;
    const realNow = dateConstructor.now;
    const expected = run();

    Math.random = () => {
      throw new Error('Math.random dipakai engine');
    };
    dateConstructor.now = () => {
      throw new Error('Date.now dipakai engine');
    };
    let actual;
    try {
      actual = run();
    } finally {
      Math.random = realRandom;
      dateConstructor.now = realNow;
    }

    assert.deepStrictEqual(actual, expected);
  });
});

describe('validasi rule set', () => {
  it('menolak rule set yang bobotnya tidak berjumlah 100', () => {
    const broken = ruleSetWith({ weights: { ...defaultRuleSet.weights, tier: 0 } });
    assert.throws(() => runBattle(battleInput(strongerSideA(), weakerSideB()), broken), /Rule set tidak sah/);
  });

  it('menolak rule set dengan konstanta yang tidak masuk akal', () => {
    const broken = ruleSetWithConstants({ logistic_k: 0 });
    assert.throws(() => runBattle(battleInput(strongerSideA(), weakerSideB()), broken), /logistic_k harus > 0/);
  });
});

describe('jalur data tidak mencukupi (Layer 0)', () => {
  const result = run(battleInput(side({ version_id: 'ver_a', metrics: { durability: null } }), weakerSideB()));

  it('menyatakan tidak ada pemenang dan mencatat kekurangan datanya', () => {
    assert.equal(result.winner, 'insufficient_data');
    assert.deepEqual(result.win_probability, { a: 0.5, b: 0.5 });
    assert.deepEqual(result.limitations, ['missing_metric:durability:a']);
    assert.equal(result.low_confidence, true);
    assert.equal(result.confidence, defaultRuleSet.constants.confidence.floor);
  });

  it('mengosongkan analisis alih-alih mengarang angka', () => {
    assert.deepEqual(result.score_breakdown, []);
    assert.deepEqual(result.decisive_edges, []);
    assert.deepEqual(result.ability_outcomes, []);
    assert.equal(result.weighted_score, 0);
    assert.deepEqual(result.coverage, { a: 0, b: 0 });
    assert.deepEqual(result.dominance, {
      applies: false,
      dominant_side: null,
      tier_delta: 0,
      durability_delta: 0,
      speed_delta: 0,
      blocked_by: 'eligibility_failed',
    });
  });

  it('mengisi placeholder terdeklarasi karena kolomnya NOT NULL', () => {
    assert.equal(result.difficulty, 'extreme');
    assert.equal(result.battle_length, 'short');
    assert.ok(result.assumptions.includes('insufficient_data_placeholder_fields'));
  });

  it('tetap dapat diaudit dan tetap membawa disclaimer', () => {
    assert.match(result.primary_reason, /Data minimum tidak terpenuhi/);
    assert.equal(result.disclaimer, DISCLAIMER);
    assert.equal(result.engine_version, ENGINE_VERSION);
    assert.equal(result.rule_set_version, defaultRuleSet.version);
  });
});

describe('kontrak hasil (PRD §16.5)', () => {
  const result = run();

  it('mengisi seluruh field wajib', () => {
    assert.equal(result.winner, 'a');
    assert.equal(result.engine_version, ENGINE_VERSION);
    assert.equal(result.rule_set_version, defaultRuleSet.version);
    assert.equal(result.disclaimer, DISCLAIMER);
  });

  it('memberi 14 baris breakdown dan probabilitas yang berjumlah 1', () => {
    assert.equal(result.score_breakdown.length, 14);
    assert.ok(Math.abs(result.win_probability.a + result.win_probability.b - 1) < 1e-3);
  });

  it('mengurutkan keterbatasan dan asumsi secara unik', () => {
    for (const list of [result.limitations, result.assumptions]) {
      assert.deepEqual(list, [...list].sort());
      assert.equal(new Set(list).size, list.length);
    }
  });

  it('menjaga rasio cakupan resistensi pada [0, 1]', () => {
    assert.ok(result.coverage.a >= 0 && result.coverage.a <= 1);
    assert.ok(result.coverage.b >= 0 && result.coverage.b <= 1);
  });

  it('menyimpan bentuk reasoning yang sama dengan kolom teksnya', () => {
    assert.equal(result.primary_reason, result.reasoning.primary.text);
    assert.equal(result.critical_counter, result.reasoning.critical_counter.text);
    assert.equal(result.potential_scenario, result.reasoning.scenario.text);
    assert.deepEqual(
      result.secondary_factors,
      result.reasoning.secondary.map((item) => item.text),
    );
  });

  it('menjaga probabilitas di dalam jepitan rule set', () => {
    const [lo, hi] = defaultRuleSet.constants.decisive_edge.mutual_edge_probability_clamp;
    const mutual = runBattle(
      battleInput(
        { ...strongerSideA(), abilities: [ability({ id: 'ab_d', category_slug: 'mind-manipulation' })] },
        { ...weakerSideB(), abilities: [ability({ id: 'ab_d', category_slug: 'mind-manipulation' })] },
        { mode: 'standard' },
      ),
      defaultRuleSet,
    );
    assert.ok(mutual.win_probability.a >= Math.max(0.02, lo - 1e-3));
    assert.ok(mutual.win_probability.a <= Math.min(0.98, hi + 1e-3));
  });

  it('memakai edge sebagai satu-satunya sumber id yang dapat dirujuk reasoning', () => {
    const ids = new Set(result.decisive_edges.map((e) => e.id));
    for (const ref of result.reasoning.primary.refs) {
      if (ref.startsWith('edge:')) assert.ok(ids.has(ref.slice('edge:'.length)), ref);
    }
  });

  it('tetap konsisten saat dibangun dari fixture minimal', () => {
    const minimal = runBattle(
      battleInput(side({ version_id: 'ver_a' }), side({ version_id: 'ver_b' }), { mode: 'equal_speed' }),
      defaultRuleSet,
    );
    assert.equal(minimal.winner, 'draw');
    assert.equal(minimal.score_breakdown.length, 14);
    assert.equal(minimal.dominance.applies, false);
    assert.equal(minimal.dominance.blocked_by, 'tier_delta_below_threshold');
  });
});

describe('stabilitas hasil terhadap urutan masukan', () => {
  it('memberi hasil sama untuk input yang sama dengan urutan array berbeda', () => {
    const a = enrich(side({ version_id: 'ver_x' }));
    const b = { ...a, statistics: [...a.statistics].reverse(), abilities: [...a.abilities].reverse() };
    assert.deepStrictEqual(
      runBattle(battleInput(a, weakerSideB()), defaultRuleSet),
      runBattle(battleInput(b, weakerSideB()), defaultRuleSet),
    );
  });

  it('membedakan hasil pertarungan yang memang berbeda', () => {
    const equal = runBattle(battleInput(side({ version_id: 'ver_a' }), side({ version_id: 'ver_b' })), defaultRuleSet);
    assert.equal(equal.winner, 'draw');
    assert.notDeepStrictEqual(equal, run());
  });

  it('mengembalikan edge kosong saat tidak ada ability yang dievaluasi', () => {
    const result = runBattle(
      battleInput(side({ version_id: 'ver_a' }), side({ version_id: 'ver_b' })),
      defaultRuleSet,
    );
    assert.equal(result.decisive_edges.length, 0);
    assert.equal(result.ability_outcomes.length, 0);
  });
});
