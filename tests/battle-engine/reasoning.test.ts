/**
 * Unit test Layer 6 (reasoning deterministik) + validator RG-1 — PRD §17.4, AC-34.
 *
 * Reasoning adalah satu-satunya keluaran engine yang berbentuk bahasa, jadi ia
 * satu-satunya yang dapat "berhalusinasi". Yang dikunci di sini: setiap kalimat
 * membawa rujukan yang dapat diselesaikan ke data hasil, dan validator MENOLAK
 * rujukan yang tidak dapat diselesaikan — fail-closed, bukan fail-open.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runBattle } from '../../src/services/battle/engine.ts';
import { buildReasoning, validateReasoningTraceability } from '../../src/services/battle/reasoning.ts';
import type { ReasoningContext } from '../../src/services/battle/reasoning.ts';
import { WEIGHT_KEYS } from '../../src/services/battle/rule-set.ts';
import type {
  BattleReasoning,
  ReasoningItem,
  ScoreContribution,
  WeightKey,
} from '../../src/services/battle/types.ts';
import {
  ability,
  battleInput,
  conditions,
  defaultRuleSet,
  edge,
  outcome,
  side,
  strongerSideA,
  weakerSideB,
} from './helpers.ts';

type MetricValues = Partial<Record<WeightKey, number>>;

function scoreRows(values: MetricValues = {}, notes: Partial<Record<WeightKey, string>> = {}): ScoreContribution[] {
  return WEIGHT_KEYS.map((metric) => {
    const aValue = values[metric] ?? 0;
    const weight = defaultRuleSet.weights[metric];
    return {
      metric,
      a_value: aValue,
      weight,
      contribution: Number(((aValue * weight) / 100).toFixed(4)),
      note: notes[metric] ?? null,
    };
  });
}

function context(overrides: Partial<ReasoningContext> = {}): ReasoningContext {
  return {
    sideA: side({ version_id: 'ver_a' }),
    sideB: side({ version_id: 'ver_b' }),
    breakdown: scoreRows(),
    outcomes: [],
    edges: [],
    limitations: [],
    assumptions: [],
    conditions: conditions(),
    dominance: {
      applies: false,
      dominantSide: null,
      tierDelta: 0,
      durabilityDelta: 0,
      speedDelta: 0,
      blockedBy: null,
    },
    winner: 'a',
    probability: 0.7,
    difficulty: 'mid',
    battleLength: 'medium',
    ruleSet: defaultRuleSet,
    ...overrides,
  };
}

/** Rujukan yang boleh dipakai reasoning, disusun agar validasi RG-1 dapat menilai. */
function traceInput(reasoning: BattleReasoning, overrides: Partial<Parameters<typeof validateReasoningTraceability>[0]> = {}) {
  return {
    reasoning,
    breakdown: scoreRows({ tier: 0.5, speed: 0.5 }),
    edges: [edge({ id: 'a:mind-manipulation:ab_1' })],
    limitations: ['missing_metric:range:b'],
    assumptions: ['no_documented_abilities:b'],
    ...overrides,
  };
}

const item = (text: string, refs: string[]): ReasoningItem => ({ text, refs });

describe('buildReasoning — alasan utama', () => {
  it('memakai cabang dominasi mutlak dengan rujukan tier dan durability', () => {
    const bundle = buildReasoning(
      context({
        dominance: { applies: true, dominantSide: 'a', tierDelta: 10, durabilityDelta: 8, speedDelta: 3, blockedBy: null },
      }),
    );
    assert.match(bundle.primary.text, /Dominasi statistik menyeluruh/);
    assert.match(bundle.primary.text, /selisih tier 10/);
    assert.match(bundle.primary.text, /durability 8/);
    assert.deepEqual(bundle.primary.refs, ['metric:tier', 'metric:durability']);
  });

  it('memakai cabang jalur penentu saat ada decisive edge', () => {
    const bundle = buildReasoning(
      context({ edges: [edge({ id: 'a:mind-manipulation:ab_x', ability_name: 'X-Ray Vision' })] }),
    );
    assert.match(bundle.primary.text, /Keunggulan kemampuan penentu: X-Ray Vision/);
    assert.deepEqual(bundle.primary.refs, ['edge:a:mind-manipulation:ab_x']);
  });

  it('memakai cabang keunggulan gabungan saat tidak ada jalur penentu', () => {
    const bundle = buildReasoning(
      context({ breakdown: scoreRows({ tier: 0.75, attack_potency: 0.6, durability: 0.4 }) }),
    );
    assert.match(bundle.primary.text, /Keunggulan gabungan pada tier, attack potency, durability\./);
    assert.deepEqual(bundle.primary.refs, ['metric:tier', 'metric:attack_potency', 'metric:durability']);
  });

  it('menyatakan hasil seimbang pada seri', () => {
    const bundle = buildReasoning(context({ winner: 'draw' }));
    assert.match(bundle.primary.text, /Tidak ada keunggulan yang cukup menentukan/);
  });

  it('tidak pernah mengembalikan kalimat tanpa rujukan', () => {
    const bundles = [
      buildReasoning(context()),
      buildReasoning(context({ winner: 'draw' })),
      buildReasoning(context({ winner: 'insufficient_data' })),
    ];
    for (const bundle of bundles) {
      assert.ok(bundle.primary.refs.length > 0);
      assert.ok(bundle.secondary.every((s) => s.refs.length > 0));
      assert.ok(bundle.criticalCounter.refs.length > 0);
      assert.ok(bundle.scenario.refs.length > 0);
    }
  });
});

describe('buildReasoning — faktor sekunder', () => {
  it('menyebut sisi yang diuntungkan dan catatannya', () => {
    const bundle = buildReasoning(
      context({
        breakdown: scoreRows({ tier: 0.75 }, { tier: 'selisih 6 peringkat' }),
      }),
    );
    assert.equal(bundle.secondary.length, 1);
    assert.equal(bundle.secondary[0]?.text, 'Character A unggul pada tier (selisih 6 peringkat)');
    assert.deepEqual(bundle.secondary[0]?.refs, ['metric:tier']);
  });

  it('membalik penamaan sisi untuk keunggulan sisi B', () => {
    const bundle = buildReasoning(context({ breakdown: scoreRows({ battle_iq: -0.5 }) }));
    assert.equal(bundle.secondary[0]?.text, 'Character B unggul pada battle IQ');
  });

  it('membatasi faktor sekunder pada 4 dan melewati metrik bernilai nol', () => {
    const bundle = buildReasoning(
      context({
        breakdown: scoreRows({ tier: 0.9, attack_potency: 0.8, durability: 0.7, speed: 0.6, range: 0.5 }),
      }),
    );
    assert.equal(bundle.secondary.length, 4);
    assert.ok(!bundle.secondary.some((s) => s.text.includes('stamina')));
  });

  it('memberi kalimat pengganti saat tidak ada metrik yang bergerak', () => {
    const bundle = buildReasoning(context());
    assert.equal(bundle.secondary.length, 1);
    assert.match(bundle.secondary[0]?.text ?? '', /Tidak ada metrik yang menunjukkan keunggulan berarti/);
    assert.deepEqual(bundle.secondary[0]?.refs, ['condition:mode']);
  });
});

describe('buildReasoning — penghitung kritis', () => {
  it('menunjuk jalur menang realistis pihak yang tertinggal', () => {
    const bundle = buildReasoning(
      context({
        outcomes: [
          outcome({ side: 'b', ability_id: 'ab_b', ability_name: 'B Ability', effectiveness: 0.7 }),
        ],
      }),
    );
    assert.equal(
      bundle.criticalCounter.text,
      'Character B hanya punya jalur menang realistis bila B Ability berhasil lebih dulu (efektivitas 0.70, win condition incapacitation).',
    );
    assert.deepEqual(bundle.criticalCounter.refs, ['edge:b:mind-manipulation:ab_b']);
  });

  it('menyatakan tidak ada win condition bila pihak tertinggal tanpa ability ofensif', () => {
    const bundle = buildReasoning(context({ outcomes: [] }));
    assert.equal(
      bundle.criticalCounter.text,
      'Tidak ada win condition yang terdokumentasi bagi Character B: tidak ada ability ofensif yang tercatat.',
    );
    assert.deepEqual(bundle.criticalCounter.refs, ['assumption:no_documented_abilities:b']);
  });

  it('mendaftar jalur menang yang tertahan', () => {
    const bundle = buildReasoning(
      context({
        sideB: side({ version_id: 'ver_b', abilities: [ability({ id: 'ab_b' })] }),
        outcomes: [
          outcome({ side: 'b', ability_id: 'ab_b', ability_name: 'B Ability', status: 'blocked', effectiveness: 0 }),
        ],
      }),
    );
    assert.equal(
      bundle.criticalCounter.text,
      'Semua jalur menang Character B tertahan: B Ability (blocked).',
    );
    assert.deepEqual(bundle.criticalCounter.refs, ['edge:b:mind-manipulation:ab_b']);
  });

  it('tidak mengarang jalur menang bila tidak ada pemenang', () => {
    const bundle = buildReasoning(context({ winner: 'draw' }));
    assert.match(bundle.criticalCounter.text, /Tidak ada jalur menang yang dapat diidentifikasi/);
    assert.deepEqual(bundle.criticalCounter.refs, ['condition:win_condition']);
  });

  it('merujuk keterbatasan bila ada saat tidak ada pemenang', () => {
    const bundle = buildReasoning(context({ winner: 'draw', limitations: ['missing_metric:range:b'] }));
    assert.deepEqual(bundle.criticalCounter.refs, ['limitation:missing_metric:range:b']);
  });
});

describe('buildReasoning — skenario potensial', () => {
  const scenarioOf = (overrides: Partial<ReasoningContext>) =>
    buildReasoning(context(overrides)).scenario;

  it('menggambarkan panjang pertarungan sesuai perkiraan', () => {
    assert.match(scenarioOf({ battleLength: 'short' }).text, /diperkirakan singkat/);
    assert.match(scenarioOf({ battleLength: 'long' }).text, /berlangsung panjang/);
    assert.match(scenarioOf({ battleLength: 'medium' }).text, /berlangsung sedang/);
  });

  it('membedakan tempo berdasarkan selisih kecepatan', () => {
    assert.match(
      scenarioOf({ breakdown: scoreRows({ speed: 0.5 }) }).text,
      /selisih kecepatan membuat salah satu pihak menentukan tempo/,
    );
    assert.match(
      scenarioOf({ breakdown: scoreRows({ speed: 0.1 }) }).text,
      /kecepatan kedua pihak relatif berdekatan/,
    );
  });

  it('menyebut kemampuan penentu sebagai jalur kemenangan utama', () => {
    const scenario = scenarioOf({
      edges: [edge({ id: 'a:mind-manipulation:ab_x', ability_name: 'X-Ray Vision' })],
    });
    assert.match(scenario.text, /kemampuan penentu \(X-Ray Vision\) menjadi jalur kemenangan utama/);
    assert.ok(scenario.refs.includes('edge:a:mind-manipulation:ab_x'));
  });

  it('menyertakan catatan kondisi awal pertarungan', () => {
    const scenario = scenarioOf({
      conditions: conditions({
        starting_distance_rank: 5,
        prep_time: 'short',
        battlefield: 'urban',
      }),
    });
    assert.match(scenario.text, /jarak awal membatasi kemampuan berjangkauan pendek/);
    assert.match(scenario.text, /waktu persiapan memberi ruang menyiapkan teknik tertentu/);
    assert.match(scenario.text, /medan urban memengaruhi ruang gerak/);
  });

  it('tidak melebihkan kondisi default menjadi catatan', () => {
    const scenario = scenarioOf({});
    assert.ok(!scenario.text.includes('jarak awal membatasi'));
    assert.ok(!scenario.text.includes('waktu persiapan'));
    assert.ok(!scenario.text.includes('medan neutral'));
  });

  it('selalu menutup dengan penegasan sifat analitis dan rujukan kondisi', () => {
    const scenario = scenarioOf({});
    assert.match(scenario.text, /Simulasi ini bersifat analitis, bukan narasi kanon/);
    assert.ok(scenario.refs.includes('metric:speed'));
    assert.ok(scenario.refs.includes('metric:range'));
    assert.ok(scenario.refs.includes('condition:mode'));
    assert.ok(scenario.refs.includes('condition:win_condition'));
  });
});

describe('validateReasoningTraceability — RG-1', () => {
  const valid: BattleReasoning = {
    primary: item('P', ['metric:tier', 'edge:a:mind-manipulation:ab_1']),
    secondary: [item('S', ['limitation:missing_metric:range:b'])],
    critical_counter: item('C', ['assumption:no_documented_abilities:b']),
    scenario: item('K', ['condition:mode', 'condition:win_condition']),
  };

  it('menerima keluaran yang rujukannya dapat diselesaikan', () => {
    const result = validateReasoningTraceability(traceInput(valid));
    assert.equal(result.ok, true);
    assert.deepEqual(result.unresolved, []);
    assert.equal(result.checkedRefs, 6);
  });

  it('menolak rujukan metrik yang tidak ada di breakdown', () => {
    const result = validateReasoningTraceability(
      traceInput({ ...valid, primary: item('P', ['metric:tidak_ada']) }),
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.unresolved, ['metric:tidak_ada']);
  });

  it('menolak rujukan edge yang tidak ada di hasil', () => {
    const result = validateReasoningTraceability(
      traceInput({ ...valid, primary: item('P', ['edge:b:time-manipulation:ab_hantu']) }),
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.unresolved, ['edge:b:time-manipulation:ab_hantu']);
  });

  it('menolak kunci kondisi yang tidak dikenal', () => {
    const result = validateReasoningTraceability(
      traceInput({ ...valid, scenario: item('K', ['condition:bukan_kondisi']) }),
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.unresolved, ['condition:bukan_kondisi']);
  });

  it('menolak kalimat tanpa rujukan sama sekali', () => {
    const result = validateReasoningTraceability(
      traceInput({ ...valid, critical_counter: item('C', []) }),
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.unresolved, ['<item tanpa rujukan>']);
  });

  it('melaporkan setiap rujukan yang gagal tanpa duplikat', () => {
    const result = validateReasoningTraceability(
      traceInput({
        ...valid,
        primary: item('P', ['metric:tidak_ada', 'metric:tidak_ada']),
        secondary: [item('S', ['metric:tidak_ada'])],
      }),
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.unresolved, ['metric:tidak_ada']);
  });

  it('hanya menerima metrik yang benar-benar ada di breakdown', () => {
    // Seluruh kunci bobot selalu ada di breakdown, termasuk yang bernilai 0.
    assert.equal(
      validateReasoningTraceability(traceInput({ ...valid, primary: item('P', ['metric:battle_iq']) })).ok,
      true,
    );
    // `striking_strength` adalah metrik ber-rank tetapi BUKAN kunci bobot: ia tidak
    // pernah masuk skoring, jadi reasoning tidak boleh mengutipnya sebagai alasan.
    const result = validateReasoningTraceability(
      traceInput({ ...valid, primary: item('P', ['metric:striking_strength']) }),
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.unresolved, ['metric:striking_strength']);
  });
});

describe('RG-1 pada keluaran engine nyata', () => {
  it('lolos untuk setiap cabang hasil (dominasi, jalur penentu, seri, data kurang)', () => {
    const decisive = ability({ id: 'ab_decisive', category_slug: 'mind-manipulation' });
    const results = [
      runBattle(
        battleInput(
          side({ version_id: 'ver_a', tierRank: 30, metrics: { durability: 30, speed: 30 } }),
          side({ version_id: 'ver_b', tierRank: 20 }),
        ),
        defaultRuleSet,
      ),
      runBattle(battleInput(strongerSideA(), weakerSideB()), defaultRuleSet),
      runBattle(
        battleInput({ ...strongerSideA(), abilities: [decisive] }, weakerSideB()),
        defaultRuleSet,
      ),
      runBattle(
        battleInput(side({ version_id: 'ver_a' }), side({ version_id: 'ver_b' })),
        defaultRuleSet,
      ),
      runBattle(
        battleInput(side({ version_id: 'ver_a', metrics: { durability: null } }), weakerSideB()),
        defaultRuleSet,
      ),
    ];

    const branches = results.map((result) => result.reasoning);
    assert.equal(new Set(results.map((r) => r.winner)).size >= 3, true);
    for (const [index, result] of results.entries()) {
      const trace = validateReasoningTraceability({
        reasoning: result.reasoning,
        breakdown: result.score_breakdown,
        edges: result.decisive_edges,
        limitations: result.limitations,
        assumptions: result.assumptions,
      });
      assert.equal(trace.ok, true, `skenario ${index}: ${trace.unresolved.join(', ')}`);
      assert.ok(trace.checkedRefs > 0);
      assert.equal(result.primary_reason, branches[index]?.primary.text);
    }
  });
});
