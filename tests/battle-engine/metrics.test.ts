/**
 * Unit test normalisasi metrik (PRD §17.1, §12.3).
 *
 * Yang dikunci di sini adalah janji anti-tebakan: metrik yang tidak dapat
 * dibandingkan menghasilkan nilai 0 beserta kode keterbatasan, bukan angka
 * karangan. Test sengaja memeriksa angka eksak (bukan hanya tanda) karena
 * kesalahan span/damping tidak akan terlihat pada pemeriksaan tanda saja.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clamp,
  experienceAdvantage,
  missingScoringMetricCount,
  prepareRankMetric,
  prepareRankMetrics,
  qualifierOf,
  RANK_METRICS,
} from '../../src/services/battle/metrics.ts';
import { defaultRuleSet, ruleSetWithConstants, side, stat } from './helpers.ts';

describe('clamp', () => {
  it('menjepit nilai ke batas dan meneruskan nilai yang sudah di dalam rentang', () => {
    assert.equal(clamp(5, 0, 1), 1);
    assert.equal(clamp(-5, 0, 1), 0);
    assert.equal(clamp(0.25, 0, 1), 0.25);
    assert.equal(clamp(0, 0, 1), 0);
    assert.equal(clamp(1, 0, 1), 1);
  });
});

describe('qualifierOf', () => {
  it('mengembalikan "exact" bila tidak ada baris statistik', () => {
    assert.equal(qualifierOf(side(), 'speed'), 'exact');
  });

  it('mengabaikan baris yang tidak berstatus current', () => {
    const withSuperseded = side({
      statistics: [
        stat({ metric: 'speed', qualifier: 'varies', status: 'superseded' }),
        stat({ metric: 'speed', qualifier: 'possibly', status: 'conflicting' }),
      ],
    });
    assert.equal(qualifierOf(withSuperseded, 'speed'), 'exact');
  });

  it('memilih baris current dengan confidence tertinggi', () => {
    const withTwo = side({
      statistics: [
        stat({ metric: 'speed', qualifier: 'possibly', confidence: 0.3 }),
        stat({ metric: 'speed', qualifier: 'likely', confidence: 0.9 }),
      ],
    });
    assert.equal(qualifierOf(withTwo, 'speed'), 'likely');
  });

  it('hanya membaca metrik yang diminta', () => {
    const s = side({ statistics: [stat({ metric: 'durability', qualifier: 'varies' })] });
    assert.equal(qualifierOf(s, 'speed'), 'exact');
    assert.equal(qualifierOf(s, 'durability'), 'varies');
  });
});

describe('prepareRankMetric — selisih dasar', () => {
  it('membagi selisih dengan span dan menandai metrik dapat dibandingkan', () => {
    // span speed = 10 → (20-15)/10 = 0,5
    const result = prepareRankMetric(
      'speed',
      side({ metrics: { speed: 20 } }),
      side({ metrics: { speed: 15 } }),
      defaultRuleSet,
    );
    assert.equal(result.advantage, 0.5);
    assert.equal(result.comparable, true);
    assert.equal(result.note, null);
    assert.deepEqual(result.limitations, []);
    assert.deepEqual(result.assumptions, []);
  });

  it('menjepit keunggulan ekstrem ke 1, bukan melampauinya', () => {
    const result = prepareRankMetric(
      'speed',
      side({ metrics: { speed: 60 } }),
      side({ metrics: { speed: 0 } }),
      defaultRuleSet,
    );
    assert.equal(result.advantage, 1);
  });

  it('memberi tanda negatif bila sisi A tertinggal', () => {
    const result = prepareRankMetric(
      'speed',
      side({ metrics: { speed: 10 } }),
      side({ metrics: { speed: 20 } }),
      defaultRuleSet,
    );
    assert.equal(result.advantage, -1);
  });

  it('membaca tier dari tier.rank, bukan metrics.tier', () => {
    const a = side({ tierRank: 28, metrics: { tier: 0 } });
    const b = side({ tierRank: 20 });
    const result = prepareRankMetric('tier', a, b, defaultRuleSet);
    // span tier = 8 → (28-20)/8 = 1
    assert.equal(result.rankA, 28);
    assert.equal(result.advantage, 1);
  });
});

describe('prepareRankMetric — peredaman kualifikasi', () => {
  it('meredam selisih 0,5 pada kualifikasi "possibly"', () => {
    const result = prepareRankMetric(
      'speed',
      side({ metrics: { speed: 20 }, statistics: [stat({ metric: 'speed', qualifier: 'possibly' })] }),
      side({ metrics: { speed: 15 } }),
      defaultRuleSet,
    );
    assert.equal(result.advantage, 0.25);
    assert.equal(result.comparable, true);
  });

  it('meredam selisih 0,75 pada kualifikasi "likely"', () => {
    const result = prepareRankMetric(
      'speed',
      side({ metrics: { speed: 20 }, statistics: [stat({ metric: 'speed', qualifier: 'likely' })] }),
      side({ metrics: { speed: 15 } }),
      defaultRuleSet,
    );
    assert.equal(result.advantage, 0.375);
  });

  it('memakai peredaman terkuat bila kedua sisi memakai kualifikasi lemah', () => {
    const result = prepareRankMetric(
      'speed',
      side({ metrics: { speed: 20 }, statistics: [stat({ metric: 'speed', qualifier: 'possibly' })] }),
      side({ metrics: { speed: 15 }, statistics: [stat({ metric: 'speed', qualifier: 'likely' })] }),
      defaultRuleSet,
    );
    assert.equal(result.advantage, 0.25);
  });

  it('tidak meredam kualifikasi "at_least"', () => {
    const result = prepareRankMetric(
      'speed',
      side({
        metrics: { speed: 20 },
        statistics: [stat({ metric: 'speed', qualifier: 'at_least' })],
      }),
      side({ metrics: { speed: 15 } }),
      defaultRuleSet,
    );
    assert.equal(result.advantage, 0.5);
  });
});

describe('prepareRankMetric — batas atas "up_to"', () => {
  it('membatasi keunggulan menjadi maksimum +2 rank (PRD §12.3)', () => {
    const result = prepareRankMetric(
      'speed',
      side({ metrics: { speed: 30 }, statistics: [stat({ metric: 'speed', qualifier: 'up_to' })] }),
      side({ metrics: { speed: 10 } }),
      defaultRuleSet,
    );
    assert.equal(result.rankA, 12);
    assert.equal(result.advantage, 0.2);
  });

  it('menerapkan batas atas pada sisi B dengan arah yang benar', () => {
    const result = prepareRankMetric(
      'speed',
      side({ metrics: { speed: 10 } }),
      side({ metrics: { speed: 30 }, statistics: [stat({ metric: 'speed', qualifier: 'up_to' })] }),
      defaultRuleSet,
    );
    assert.equal(result.rankB, 12);
    assert.equal(result.advantage, -0.2);
  });
});

describe('prepareRankMetric — metrik yang tidak dapat dibandingkan', () => {
  it('mengeluarkan metrik berkualifikasi "varies" dan mencatat kode keterbatasan', () => {
    const result = prepareRankMetric(
      'speed',
      side({ metrics: { speed: 30 }, statistics: [stat({ metric: 'speed', qualifier: 'varies' })] }),
      side({ metrics: { speed: 10 } }),
      defaultRuleSet,
    );
    assert.equal(result.comparable, false);
    assert.equal(result.advantage, 0);
    assert.deepEqual(result.limitations, ['varies_metric:speed:a']);
    assert.match(result.note ?? '', /dikeluarkan: kualifikasi varies\/unknown/);
  });

  it('mencatat "unknown" pada sisi B dengan kode sisi yang benar', () => {
    const result = prepareRankMetric(
      'speed',
      side({ metrics: { speed: 30 } }),
      side({ metrics: { speed: 10 }, statistics: [stat({ metric: 'speed', qualifier: 'unknown' })] }),
      defaultRuleSet,
    );
    assert.equal(result.comparable, false);
    assert.deepEqual(result.limitations, ['unknown_metric:speed:b']);
  });

  it('mengeluarkan metrik yang tidak terdokumentasi pada satu sisi', () => {
    const result = prepareRankMetric(
      'range',
      side({ metrics: { range: 20 } }),
      side({ metrics: { range: null } }),
      defaultRuleSet,
    );
    assert.equal(result.rankB, null);
    assert.equal(result.comparable, false);
    assert.deepEqual(result.limitations, ['missing_metric:range:b']);
    assert.equal(result.note, 'metrik tidak terdokumentasi pada sisi B');
  });

  it('mengeluarkan tier bila tier tidak dapat di-rank', () => {
    const result = prepareRankMetric(
      'tier',
      side({ tierRank: null, rankable: false }),
      side({ tierRank: 20 }),
      defaultRuleSet,
    );
    assert.equal(result.rankA, null);
    assert.equal(result.comparable, false);
    assert.deepEqual(result.limitations, ['missing_metric:tier:a']);
  });
});

describe('prepareRankMetric — rezim non-fisik', () => {
  it('meredam selisih separuh dan mencatatnya sebagai asumsi', () => {
    // Keunggulan mentah (20-10)/10 = 1 → dijepit dulu ke 1, lalu dikali 0,5.
    const result = prepareRankMetric(
      'speed',
      side({ metrics: { speed: 20 }, nonphysical_metrics: ['speed'] }),
      side({ metrics: { speed: 10 } }),
      defaultRuleSet,
    );
    assert.equal(result.advantage, 0.5);
    assert.deepEqual(result.assumptions, ['nonphysical_metric:speed']);
    assert.equal(result.note, 'rezim non-fisik: selisih diredam 0,5');
  });

  it('menjepit sebelum meredam, sehingga rezim non-fisik tidak pernah melampaui 0,5', () => {
    // Bila peredaman dilakukan sebelum penjepitan, selisih (25-10)/10 = 1,5
    // akan menghasilkan 0,75. Urutan yang berlaku menghasilkan 0,5 — batas inilah
    // yang membuat perbandingan antar-rezim tidak mendominasi skor.
    const result = prepareRankMetric(
      'speed',
      side({ metrics: { speed: 25 }, nonphysical_metrics: ['speed'] }),
      side({ metrics: { speed: 10 } }),
      defaultRuleSet,
    );
    assert.equal(result.advantage, 0.5);
  });

  it('juga berlaku bila penandaan non-fisik ada di sisi B', () => {
    const result = prepareRankMetric(
      'speed',
      side({ metrics: { speed: 20 } }),
      side({ metrics: { speed: 10 }, nonphysical_metrics: ['speed'] }),
      defaultRuleSet,
    );
    assert.equal(result.advantage, 0.5);
    assert.deepEqual(result.assumptions, ['nonphysical_metric:speed']);
  });
});

describe('prepareRankMetric — rule set tidak lengkap', () => {
  it('melempar bila span metrik tidak terdefinisi (gagal cepat, bukan menebak)', () => {
    const spans = { ...defaultRuleSet.constants.normalization_spans } as Record<string, number>;
    delete spans.speed;
    const broken = ruleSetWithConstants({
      normalization_spans: spans as typeof defaultRuleSet.constants.normalization_spans,
    });
    assert.throws(
      () => prepareRankMetric('speed', side(), side(), broken),
      /normalization_spans tidak terdefinisi untuk metrik "speed"/,
    );
  });
});

describe('prepareRankMetrics', () => {
  it('menghasilkan satu baris per metrik ber-rank dengan urutan RANK_METRICS', () => {
    const rows = prepareRankMetrics(side(), side(), defaultRuleSet);
    assert.equal(rows.length, RANK_METRICS.length);
    assert.deepEqual(
      rows.map((row) => row.metric),
      [...RANK_METRICS],
    );
  });

  it('memberi nilai 0 untuk konfigurasi seimbang', () => {
    const rows = prepareRankMetrics(side(), side(), defaultRuleSet);
    assert.ok(rows.every((row) => row.advantage === 0 && row.comparable));
  });
});

describe('experienceAdvantage', () => {
  it('memberi 0 bila pengalaman sama', () => {
    assert.equal(experienceAdvantage(side(), side()), 0);
  });

  it('memberi 0 bila kedua sisi tidak punya data pengalaman', () => {
    const a = side({ metrics: { experience: 0 } });
    const b = side({ metrics: { experience: 0 } });
    assert.equal(experienceAdvantage(a, b), 0);
  });

  it('memakai rasio logaritmik dan menjepit pada 1', () => {
    const a = side({ metrics: { experience: 100 } });
    const b = side({ metrics: { experience: 1 } });
    // log10(101)/log10(2) - 1 ≈ 5,66 → dijepit ke 1
    assert.equal(experienceAdvantage(a, b), 1);
  });

  it('memberi 0 bila salah satu sisi ≤ 0 tahun — rasio logaritmik tidak bermakna (PRD §17.1)', () => {
    const a = side({ metrics: { experience: 0 } });
    const b = side({ metrics: { experience: 10 } });
    assert.equal(experienceAdvantage(a, b), 0);
    assert.equal(experienceAdvantage(b, a), 0);
  });

  it('memberi 0 bila pengalaman salah satu sisi tidak terdokumentasi (null), bukan hukuman maksimal', () => {
    const a = side({ metrics: { experience: null } });
    const b = side({ metrics: { experience: 10 } });
    assert.equal(experienceAdvantage(a, b), 0);
    assert.equal(experienceAdvantage(b, a), 0);
  });

  it('memberi nilai negatif proporsional bila A sedikit lebih muda', () => {
    const a = side({ metrics: { experience: 1 } });
    const b = side({ metrics: { experience: 101 } });
    const value = experienceAdvantage(a, b);
    assert.ok(value < 0 && value > -1, `didapat ${value}`);
  });
});

describe('missingScoringMetricCount', () => {
  it('memberi 0 untuk sisi lengkap', () => {
    assert.equal(missingScoringMetricCount(side()), 0);
  });

  it('menghitung metrik ber-rank yang hilang', () => {
    assert.equal(missingScoringMetricCount(side({ metrics: { durability: null } })), 1);
  });

  it('menghitung pengalaman sebagai metrik skoring juga', () => {
    assert.equal(missingScoringMetricCount(side({ metrics: { experience: null } })), 1);
  });

  it('menjumlahkan metrik hilang dan pengalaman hilang', () => {
    const s = side({ metrics: { durability: null, experience: null, speed: null } });
    assert.equal(missingScoringMetricCount(s), 3);
  });

  it('menghitung tier yang tidak dapat di-rank sebagai hilang', () => {
    assert.equal(missingScoringMetricCount(side({ tierRank: null, rankable: false })), 1);
  });
});
