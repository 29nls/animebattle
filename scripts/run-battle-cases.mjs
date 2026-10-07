#!/usr/bin/env node
/**
 * Runner case library battle engine.
 *
 *   npm run validate:battle-cases
 *
 * Yang diperiksa:
 *   1. Setiap kasus memenuhi harapannya (pemenang, rentang probabilitas, difficulty,
 *      status interaksi hax, keterbatasan/asumsi, nilai breakdown, catatan outcome).
 *   2. Determinisme (AC-28): menjalankan kasus dua kali menghasilkan hasil identik,
 *      termasuk `input_hash`.
 *   3. RG-1 (AC-34): setiap kalimat reasoning punya rujukan yang dapat diselesaikan.
 *      Engine sudah fail-closed, runner memverifikasi ulang lewat `reasoning.refs`.
 *   4. Invarian AC-32: pihak yang tertinggal jauh (tier ≥ 8, durability ≥ 6) tidak
 *      boleh menang kecuali memiliki decisive edge.
 *   5. Kelengkapan library: ≥ 30 kasus dan semua kategori terwakili.
 *
 * Keluar dengan status 1 bila ada satu pemeriksaan pun gagal.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runBattle, validateReasoningTraceability } from '../src/services/battle/index.ts';

const dir = (name) => fileURLToPath(new URL(`../src/services/battle/${name}`, import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const roster = readJson(dir('cases/roster.json'));
const ruleSet = readJson(dir('fixtures/rule-set.default.json'));

const caseFiles = readdirSync(dir('cases'))
  .filter((f) => f.endsWith('.json') && f !== 'roster.json')
  .sort();

const LEVEL_LABELS = ['none', 'limited', 'moderate', 'high', 'absolute'];
const ALL_METRICS = [
  'tier', 'attack_potency', 'durability', 'striking_strength', 'lifting_strength',
  'speed', 'reaction_speed', 'combat_speed', 'range', 'stamina', 'intelligence',
  'battle_iq', 'experience',
];

// ---------------------------------------------------------------- roster loader

function deepMerge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (key === 'extends') continue;
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && typeof out[key] === 'object' && out[key] !== null && !Array.isArray(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function rawSide(key, seen = new Set()) {
  const raw = roster.sides[key];
  if (!raw) throw new Error(`sisi "${key}" tidak ada di roster.json`);
  if (seen.has(key)) throw new Error(`dependensi "extends" melingkar pada "${key}"`);
  if (!raw.extends) return raw;
  seen.add(key);
  return deepMerge(rawSide(raw.extends, seen), raw);
}

function buildSide(key) {
  const merged = rawSide(key);
  const defaults = roster.defaults;
  const tierRank = merged.tier && 'rank' in merged.tier ? merged.tier.rank : null;
  const rankable = merged.tier ? (merged.tier.rankable ?? tierRank !== null) : false;

  const metrics = {};
  for (const metric of ALL_METRICS) {
    metrics[metric] = metric === 'tier' ? tierRank : (merged.metrics?.[metric] ?? null);
  }

  const abilities = (merged.abilities ?? []).map((a, i) => ({
    id: `ab_${key}_${i + 1}`,
    name: a.name,
    category_slug: a.category,
    category_is_negation: a.negation ?? false,
    activation_speed: a.activation ?? 'instant',
    is_offensive: a.offensive ?? true,
    is_passive: a.passive ?? false,
    is_prep_required: a.prep ?? false,
    proficiency: a.proficiency ?? 'intermediate',
    confidence: a.confidence ?? defaults.ability_confidence,
    effective_range_rank: a.range_rank ?? null,
  }));

  const resistances = (merged.resistances ?? []).map((r) => ({
    resistance_type_id: `rt_${r.category}`,
    category_slug: r.category,
    level: r.level,
    level_label: LEVEL_LABELS[r.level],
    verification_status: r.status ?? 'imported',
    confidence: r.confidence ?? defaults.resistance_confidence,
  }));

  const statistics = (merged.statistics ?? []).map((s) => ({
    metric: s.metric,
    raw_text: s.raw_text,
    qualifier: s.qualifier,
    scale_rank: s.scale_rank ?? null,
    confidence: s.confidence ?? 0.5,
    source_id: s.source_id ?? 'src_fixture',
    status: s.status ?? 'current',
  }));

  return {
    version_id: `ver_${key}`,
    character: { id: `char_${key}`, slug: key.replace(/_/g, '-'), name: merged.name ?? key },
    verse: { id: 'verse_fixture', slug: 'fixture-verse', name: 'Fixture Verse' },
    form: {
      id: `form_${key}`,
      slug: merged.form_slug ?? defaults.form_slug,
      name: merged.form_name ?? defaults.form_name,
      era: merged.era ?? null,
      data_completeness: merged.data_completeness ?? defaults.data_completeness,
      media_type: merged.media_type ?? defaults.media_type,
    },
    tier: { code: merged.tier?.code ?? null, rank: tierRank, rankable },
    metrics,
    nonphysical_metrics: merged.nonphysical_metrics ?? [],
    statistics,
    abilities,
    resistances,
    traits: merged.traits ?? [],
  };
}

// ------------------------------------------------------------ expectation check

const failures = [];
let checks = 0;

function check(caseId, label, condition, detail) {
  checks += 1;
  if (!condition) failures.push(`${caseId} :: ${label}${detail ? ` — ${detail}` : ''}`);
}

function inRange(value, range) {
  return typeof value === 'number' && value >= range[0] && value <= range[1];
}

function hasAll(actual, expected) {
  return expected.every((item) => actual.includes(item));
}

function evaluate(caseDef, result) {
  const id = caseDef.id;
  const e = caseDef.expect ?? {};

  if (e.winner !== undefined) {
    const allowed = Array.isArray(e.winner) ? e.winner : [e.winner];
    check(id, 'winner', allowed.includes(result.winner), `didapat "${result.winner}", diharapkan ${allowed.join('/')}`);
  }
  if (e.probability_a) {
    check(id, 'probability_a', inRange(result.win_probability.a, e.probability_a), `didapat ${result.win_probability.a} di luar [${e.probability_a}]`);
  }
  if (e.probability_b) {
    check(id, 'probability_b', inRange(result.win_probability.b, e.probability_b), `didapat ${result.win_probability.b} di luar [${e.probability_b}]`);
  }
  if (e.difficulty) {
    check(id, 'difficulty', e.difficulty.includes(result.difficulty), `didapat "${result.difficulty}"`);
  }
  if (e.battle_length) {
    check(id, 'battle_length', e.battle_length.includes(result.battle_length), `didapat "${result.battle_length}"`);
  }
  if (e.confidence) {
    check(id, 'confidence.min', result.confidence >= e.confidence.min, `didapat ${result.confidence}`);
    check(id, 'confidence.max', result.confidence <= e.confidence.max, `didapat ${result.confidence}`);
  }
  if (e.low_confidence !== undefined) {
    check(id, 'low_confidence', result.low_confidence === e.low_confidence, `didapat ${result.low_confidence}`);
  }
  if (e.probability_sums_to_one !== false) {
    const sum = result.win_probability.a + result.win_probability.b;
    check(id, 'jumlah probabilitas = 1', Math.abs(sum - 1) < 0.0011, `didapat ${sum}`);
  }
  if (e.dominance) {
    check(id, 'dominance.applies', result.dominance.applies === e.dominance.applies, `didapat ${result.dominance.applies}`);
    if (e.dominance.dominant_side !== undefined) {
      check(id, 'dominance.dominant_side', result.dominance.dominant_side === e.dominance.dominant_side, `didapat ${result.dominance.dominant_side}`);
    }
    if (e.dominance.blocked_by !== undefined) {
      check(id, 'dominance.blocked_by', result.dominance.blocked_by === e.dominance.blocked_by, `didapat ${result.dominance.blocked_by}`);
    }
  }
  if (e.decisive_edges) {
    const decisive = result.decisive_edges.filter((x) => x.decisive);
    if (e.decisive_edges.count_min !== undefined) {
      check(id, 'decisive_edges.count_min', decisive.length >= e.decisive_edges.count_min, `didapat ${decisive.length}`);
    }
    if (e.decisive_edges.count_max !== undefined) {
      check(id, 'decisive_edges.count_max', decisive.length <= e.decisive_edges.count_max, `didapat ${decisive.length}`);
    }
    if (e.decisive_edges.side !== undefined) {
      check(id, 'decisive_edges.side', decisive.every((x) => x.side === e.decisive_edges.side), `didapat ${decisive.map((x) => x.side).join(',') || '-'}`);
    }
  }
  if (e.no_decisive_edges) {
    const decisive = result.decisive_edges.filter((x) => x.decisive);
    check(id, 'tidak ada decisive edge', decisive.length === 0, `didapat ${decisive.length}`);
  }
  if (e.edge_status) {
    for (const [category, expected] of Object.entries(e.edge_status)) {
      const edge = result.decisive_edges.find((x) => x.category_slug === category);
      check(id, `edge_status[${category}]`, edge !== undefined && edge.status === expected, `didapat ${edge ? edge.status : 'tidak ada edge'}`);
    }
  }
  if (e.edge_effectiveness) {
    for (const [category, spec] of Object.entries(e.edge_effectiveness)) {
      const edge = result.decisive_edges.find((x) => x.category_slug === category);
      check(id, `edge_effectiveness[${category}]`, edge !== undefined && inRange(edge.effectiveness, spec), `didapat ${edge ? edge.effectiveness : 'tidak ada edge'}`);
    }
  }
  if (e.edge_inactive_reason) {
    for (const [category, fragment] of Object.entries(e.edge_inactive_reason)) {
      const edge = result.decisive_edges.find((x) => x.category_slug === category);
      check(id, `edge_inactive_reason[${category}]`, edge !== undefined && typeof edge.inactive_reason === 'string' && edge.inactive_reason.includes(fragment), `didapat ${edge ? edge.inactive_reason : 'tidak ada edge'}`);
    }
  }
  if (e.edge_satisfies_win_condition) {
    for (const [category, expected] of Object.entries(e.edge_satisfies_win_condition)) {
      const edge = result.decisive_edges.find((x) => x.category_slug === category);
      check(id, `edge_satisfies_win_condition[${category}]`, edge !== undefined && edge.satisfies_win_condition === expected, `didapat ${edge ? edge.satisfies_win_condition : 'tidak ada edge'}`);
    }
  }
  if (e.limitations_include) {
    check(id, 'limitations_include', hasAll(result.limitations, e.limitations_include), `limitations=${result.limitations.join(',')}`);
  }
  if (e.limitations_exclude) {
    const present = e.limitations_exclude.filter((x) => result.limitations.includes(x));
    check(id, 'limitations_exclude', present.length === 0, `tidak seharusnya ada: ${present.join(',')}`);
  }
  if (e.limitations_empty) {
    check(id, 'limitations_empty', result.limitations.length === 0, `didapat ${result.limitations.join(',')}`);
  }
  if (e.assumptions_include) {
    check(id, 'assumptions_include', hasAll(result.assumptions, e.assumptions_include), `assumptions=${result.assumptions.join(',')}`);
  }
  if (e.assumptions_exclude) {
    const present = e.assumptions_exclude.filter((x) => result.assumptions.includes(x));
    check(id, 'assumptions_exclude', present.length === 0, `tidak seharusnya ada: ${present.join(',')}`);
  }
  if (e.outcome_notes_include) {
    const allNotes = result.ability_outcomes.flatMap((o) => o.notes);
    check(id, 'outcome_notes_include', hasAll(allNotes, e.outcome_notes_include), `notes=${allNotes.join(',')}`);
  }
  if (e.primary_reason_refs_include) {
    check(id, 'primary_reason_refs_include', hasAll(result.reasoning.primary.refs, e.primary_reason_refs_include), `refs=${result.reasoning.primary.refs.join(',')}`);
  }
  if (e.score_a_value) {
    for (const [metric, spec] of Object.entries(e.score_a_value)) {
      const row = result.score_breakdown.find((r) => r.metric === metric);
      const tol = spec.tol ?? 0.001;
      check(id, `score_a_value[${metric}]`, row !== undefined && Math.abs(row.a_value - spec.value) <= tol, `didapat ${row ? row.a_value : 'tidak ada'}, diharapkan ${spec.value}±${tol}`);
    }
  }
  if (e.score_breakdown_length !== undefined) {
    check(id, 'score_breakdown_length', result.score_breakdown.length === e.score_breakdown_length, `didapat ${result.score_breakdown.length}`);
  }
  if (e.coverage) {
    if (e.coverage.a) check(id, 'coverage.a', inRange(result.coverage.a, e.coverage.a), `didapat ${result.coverage.a}`);
    if (e.coverage.b) check(id, 'coverage.b', inRange(result.coverage.b, e.coverage.b), `didapat ${result.coverage.b}`);
  }
  if (e.engine_fields) {
    check(id, 'engine_version', typeof result.engine_version === 'string' && result.engine_version.length > 0);
    check(id, 'rule_set_version', result.rule_set_version === ruleSet.version, `didapat ${result.rule_set_version}`);
    check(id, 'input_hash', /^sha256:[0-9a-f]{64}$/.test(result.input_hash), `didapat ${result.input_hash}`);
    check(id, 'battle_id', /^btl_[0-9a-f]{24}$/.test(result.battle_id), `didapat ${result.battle_id}`);
  }
  if (e.reasoning_traceable !== false) {
    const trace = validateReasoningTraceability({
      reasoning: result.reasoning,
      breakdown: result.score_breakdown,
      edges: result.decisive_edges,
      limitations: result.limitations,
      assumptions: result.assumptions,
    });
    check(id, 'RG-1 reasoning dapat dirujuk', trace.ok, trace.unresolved.join(','));
    check(id, 'RG-1 jumlah rujukan > 0', trace.checkedRefs > 0, `didapat ${trace.checkedRefs}`);
  }
  if (e.disclaimer !== false) {
    check(id, 'disclaimer disertakan', /simulasi\/analitis/.test(result.disclaimer) && /calculated from available/.test(result.disclaimer));
  }
}

// ------------------------------------------------------------------ run cases

const sides = {};
function side(key) {
  if (!sides[key]) sides[key] = buildSide(key);
  return sides[key];
}

const categories = new Set();
const collected = [];
let caseCount = 0;
let traceableCount = 0;
const invariantViolations = [];
const seenIds = new Set();

for (const file of caseFiles) {
  const parsed = readJson(dir(`cases/${file}`));
  for (const caseDef of parsed.cases) {
    caseCount += 1;
    categories.add(caseDef.category);
    if (seenIds.has(caseDef.id)) {
      failures.push(`${caseDef.id} :: id kasus duplikat`);
      continue;
    }
    seenIds.add(caseDef.id);
    if (!caseDef.expect || Object.keys(caseDef.expect).length === 0) {
      failures.push(`${caseDef.id} :: kasus tanpa harapan (expect) tidak diperbolehkan`);
      continue;
    }
    // Kasus yang mempertemukan fixture yang sama dengan dirinya sendiri tidak
    // menguji apa pun selain jalur `draw`. Bila memang disengaja, pakai dua kunci
    // roster berbeda dan nyatakan harapannya — bukan kunci yang sama.
    if (caseDef.side_a === caseDef.side_b) {
      failures.push(`${caseDef.id} :: side_a === side_b (kasus tidak bermakna)`);
      continue;
    }

    let input;
    try {
      input = {
        side_a: side(caseDef.side_a),
        side_b: side(caseDef.side_b),
        conditions: { ...roster.conditions_defaults, ...(caseDef.conditions ?? {}) },
      };
    } catch (err) {
      failures.push(`${caseDef.id} :: fixture tidak dapat dimuat — ${String(err.message).split('\n')[0]}`);
      continue;
    }

    let result;
    try {
      result = runBattle(input, ruleSet);
    } catch (err) {
      failures.push(`${caseDef.id} :: engine melempar error — ${String(err.message).split('\n')[0]}`);
      continue;
    }

    // Determinisme (AC-28): jalankan ulang dari fixture yang dibangun baru
    const again = runBattle(
      {
        side_a: buildSide(caseDef.side_a),
        side_b: buildSide(caseDef.side_b),
        conditions: { ...roster.conditions_defaults, ...(caseDef.conditions ?? {}) },
      },
      ruleSet,
    );
    check(caseDef.id, 'determinisme: hasil identik', JSON.stringify(result) === JSON.stringify(again), 'hasil berbeda antar dua eksekusi');
    check(caseDef.id, 'determinisme: input_hash identik', result.input_hash === again.input_hash);

    evaluate(caseDef, result);

    // Simpan untuk pemeriksaan sensitivitas kondisi (AC-33).
    collected.push({
      id: caseDef.id,
      pair: `${caseDef.side_a}|${caseDef.side_b}`,
      conditions: JSON.stringify(caseDef.conditions ?? {}),
      signature: (() => {
        const { input_hash: _h, battle_id: _b, ...rest } = result;
        return JSON.stringify(rest);
      })(),
      winner: result.winner,
    });

    const trace = validateReasoningTraceability({
      reasoning: result.reasoning,
      breakdown: result.score_breakdown,
      edges: result.decisive_edges,
      limitations: result.limitations,
      assumptions: result.assumptions,
    });
    if (trace.ok) traceableCount += 1;

    // Invarian AC-32
    const a = input.side_a;
    const b = input.side_b;
    const tierDelta = Math.abs((a.tier.rank ?? 0) - (b.tier.rank ?? 0));
    const durDelta = Math.abs((a.metrics.durability ?? 0) - (b.metrics.durability ?? 0));
    if (tierDelta >= 8 && durDelta >= 6 && (result.winner === 'a' || result.winner === 'b')) {
      const trailing = (a.tier.rank ?? 0) > (b.tier.rank ?? 0) ? 'b' : 'a';
      if (result.winner === trailing && !result.decisive_edges.some((e) => e.decisive && e.side === trailing)) {
        invariantViolations.push(`${caseDef.id}: pihak tertinggal (${trailing}) menang tanpa decisive edge (Δtier ${tierDelta}, Δdur ${durDelta})`);
      }
    }
  }
}

// ------------------------------------------------------------- global checks

const globalId = 'GLOBAL';
check(globalId, 'jumlah kasus ≥ 30', caseCount >= 30, `didapat ${caseCount}`);
for (const required of ['dominance', 'speed', 'hax', 'incomplete_data', 'conditions', 'qualifiers']) {
  check(globalId, `kategori "${required}" terwakili`, categories.has(required), `kategori yang ada: ${[...categories].join(',')}`);
}
check(globalId, 'RG-1 lulus untuk semua kasus', traceableCount === caseCount, `${traceableCount}/${caseCount}`);
check(globalId, 'invarian AC-32 (tidak ada hasil mustahil)', invariantViolations.length === 0, invariantViolations.join(' | '));
check(globalId, 'rule set fixture sah', ruleSet.hax_rules.length >= 20, `hax_rules=${ruleSet.hax_rules.length}`);

// AC-33: perubahan kondisi harus benar-benar mengubah hasil perhitungan.
// Pasangan yang dibandingkan adalah kasus dengan pasangan sisi identik tetapi
// kondisi berbeda. Pasangan yang keduanya `insufficient_data` dikecualikan —
// memang begitu perilaku yang benar (kondisi tidak dapat memperbaiki data yang
// tidak ada), dan hal itu diperiksa tersendiri oleh incomplete-05.
const byPair = new Map();
for (const item of collected) {
  if (!byPair.has(item.pair)) byPair.set(item.pair, []);
  byPair.get(item.pair).push(item);
}
let sensitivePairs = 0;
let exemptPairs = 0;
const insensitive = [];
for (const [pair, items] of byPair) {
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (items[i].conditions === items[j].conditions) continue;
      const bothInsufficient = items[i].winner === 'insufficient_data' && items[j].winner === 'insufficient_data';
      if (bothInsufficient) {
        exemptPairs += 1;
        continue;
      }
      sensitivePairs += 1;
      if (items[i].signature === items[j].signature) {
        insensitive.push(`${pair}: ${items[i].id} vs ${items[j].id}`);
      }
    }
  }
}
check(globalId, 'AC-33 sensitivitas kondisi: semua pasangan kondisi berbeda menghasilkan hasil berbeda', insensitive.length === 0, insensitive.join(' | '));

// Satu kontrol terakhir: input berbeda → hash berbeda.
const hashA = runBattle({ side_a: side('baseline'), side_b: side('baseline_twin'), conditions: roster.conditions_defaults }, ruleSet).input_hash;
const hashB = runBattle({ side_a: side('baseline'), side_b: side('apex'), conditions: roster.conditions_defaults }, ruleSet).input_hash;
check(globalId, 'input berbeda menghasilkan input_hash berbeda', hashA !== hashB);
check(globalId, 'pengulangan input yang sama menghasilkan input_hash sama', hashA === runBattle({ side_a: side('baseline'), side_b: side('baseline_twin'), conditions: roster.conditions_defaults }, ruleSet).input_hash);

// ------------------------------------------------------------------- laporan

const perCategory = new Map();
for (const file of caseFiles) {
  const parsed = readJson(dir(`cases/${file}`));
  perCategory.set(file.replace('.json', ''), parsed.cases.length);
}

console.log('=== Battle case library ===');
console.log(`Berkas kasus : ${caseFiles.join(', ')}`);
const breakdownText = [...perCategory].map(([k, v]) => `${k}=${v}`).join(', ');
console.log(`Jumlah kasus : ${caseCount} (${breakdownText})`);
console.log(`Pemeriksaan  : ${checks}`);
console.log(`RG-1         : ${traceableCount}/${caseCount} kasus dapat dirujuk`);
console.log(`AC-33        : ${sensitivePairs} pasangan sensitivitas diperiksa, ${exemptPairs} dikecualikan (dua-duanya insufficient_data)`);
console.log('');

if (failures.length > 0) {
  console.log(`GAGAL (${failures.length}):`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log('');
  console.log(`Total: ${checks} · gagal ${failures.length}`);
  process.exit(1);
}

console.log(`Total: ${checks} · gagal 0`);
console.log('Semua kasus memenuhi harapannya, deterministik, dan dapat diaudit.');
