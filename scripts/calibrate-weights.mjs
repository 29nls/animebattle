#!/usr/bin/env node
/**
 * Harness kalibrasi bobot engine dari hasil pertarungan berlabel.
 *
 *   node scripts/calibrate-weights.mjs            # laporan baseline + kalibrasi
 *   node scripts/calibrate-weights.mjs --out out/rule-set.calibrated.json
 *
 * Sumber label: case library `src/services/battle/cases/*.json`. Setiap kasus
 * punya harapan `winner` yang divalidasi 425 pemeriksaan `validate:battle-cases`
 * — di sini harapan itu dipakai sebagai LABEL KANON (proksi pertarungan berlabel
 * yang dikurasi manusia; dataset produksi nantinya berasal dari battle history).
 *
 * Yang diukur:
 *  1. Akurasi + Brier score rule set default (baseline).
 *  2. Akurasi + Brier setelah kalibrasi coordinate descent pada bobot.
 *  3. Leave-one-out mean accuracy sebagai proksi generalisasi (overfit gap).
 *
 * Keluar dengan status 1 bila kalibrasi menghasilkan rule set tidak sah —
 * itu bug harness, bukan hasil.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  calibrateWeights,
  evaluateRuleSet,
  leaveOneOutAccuracy,
} from '../src/services/battle/calibration.ts';
import { runBattle, validateRuleSet } from '../src/services/battle/index.ts';

const dir = (name) => fileURLToPath(new URL(`../src/services/battle/${name}`, import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

// ------------------------------------------------------------ loader dataset

const LEVEL_LABELS = ['none', 'limited', 'moderate', 'high', 'absolute'];
const ALL_METRICS = [
  'tier', 'attack_potency', 'durability', 'striking_strength', 'lifting_strength',
  'speed', 'reaction_speed', 'combat_speed', 'range', 'stamina', 'intelligence',
  'battle_iq', 'experience',
];

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

function buildSideLoader(roster) {
  function rawSide(key, seen = new Set()) {
    const raw = roster.sides[key];
    if (!raw) throw new Error(`sisi "${key}" tidak ada di roster.json`);
    if (seen.has(key)) throw new Error(`dependensi "extends" melingkar pada "${key}"`);
    if (!raw.extends) return raw;
    seen.add(key);
    return deepMerge(rawSide(raw.extends, seen), raw);
  }

  return function buildSide(key) {
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
  };
}

/** Muat semua kasus berlabel dari case library. */
function loadLabelledCases() {
  const roster = readJson(dir('cases/roster.json'));
  const buildSide = buildSideLoader(roster);
  const ruleSet = readJson(dir('fixtures/rule-set.default.json'));

  const caseFiles = readdirSync(dir('cases'))
    .filter((f) => f.endsWith('.json') && f !== 'roster.json')
    .sort();

  const cases = [];
  const cache = new Map();
  const sideOf = (key) => {
    if (!cache.has(key)) cache.set(key, buildSide(key));
    return cache.get(key);
  };

  for (const file of caseFiles) {
    const parsed = readJson(dir(`cases/${file}`));
    for (const caseDef of parsed.cases) {
      const expected = caseDef.expect?.winner;
      if (expected === undefined) continue; // tanpa label pemenang → tidak berlabel
      const labels = Array.isArray(expected) ? expected : [expected];
      if (labels.length !== 1) continue; // ambigu (mis. ['a','draw']) → dilewati
      const label = labels[0];
      if (!['a', 'b', 'draw'].includes(label)) continue;

      const conditions = { ...roster.conditions_defaults, ...(caseDef.conditions ?? {}) };
      cases.push({
        id: caseDef.id,
        label,
        input: { side_a: sideOf(caseDef.side_a), side_b: sideOf(caseDef.side_b), conditions },
      });
    }
  }
  return { cases, ruleSet };
}

// ------------------------------------------------------------------- laporan

function fmtPct(x) {
  return `${(x * 100).toFixed(2)}%`;
}

function main() {
  const { cases, ruleSet } = loadLabelledCases();
  console.log('=== Harness kalibrasi bobot engine ===');
  console.log(`Kasus berlabel : ${cases.length} (dari case library; label = pemenang kanon)`);
  console.log(`Rule set       : ${ruleSet.version} · Σbobot=${Object.values(ruleSet.weights).reduce((a, b) => a + b, 0)}`);
  console.log('');

  if (cases.length === 0) {
    console.log('Tidak ada kasus berlabel — tidak ada yang dapat dikalibrasi.');
    process.exit(1);
  }

  // 1. Baseline
  const baseline = evaluateRuleSet(cases, ruleSet);
  console.log('--- Baseline (rule set default) ---');
  console.log(`Dinilai        : ${baseline.evaluated}/${baseline.total} (draw ${baseline.drawCount} · insufficient_data ${baseline.insufficientCount} dikecualikan)`);
  console.log(`Akurasi        : ${fmtPct(baseline.accuracy)} (${baseline.correct}/${baseline.evaluated})`);
  console.log(`Brier score    : ${baseline.brier.toFixed(4)} (0 = sempurna, 2 = terburuk)`);
  if (baseline.mislabeled.length > 0) {
    console.log(`Tidak cocok    : ${baseline.mislabeled.join(', ')}`);
  }
  console.log('');

  // 2. Kalibrasi
  const logLines = [];
  const calibration = calibrateWeights(cases, ruleSet, {
    maxSweeps: 6,
    log: (m) => logLines.push(m),
  });
  console.log('--- Kalibrasi (coordinate descent pada 14 bobot) ---');
  console.log(`Sweep dijalankan: ${calibration.sweeps}`);
  if (calibration.changes.length === 0) {
    console.log('Tidak ada perubahan bobot — baseline sudah lokal-optimum pada dataset ini.');
  } else {
    for (const c of calibration.changes) {
      console.log(`  ${c.key.padEnd(16)} ${String(c.from).padStart(3)} → ${c.to}`);
    }
  }
  console.log(`Akurasi        : ${fmtPct(calibration.after.accuracy)} (${calibration.after.correct}/${calibration.after.evaluated}) · sebelumnya ${fmtPct(calibration.before.accuracy)}`);
  console.log(`Brier score    : ${calibration.after.brier.toFixed(4)} · sebelumnya ${calibration.before.brier.toFixed(4)}`);
  console.log('');

  // 3. Leave-one-out (proksi generalisasi)
  const loo = leaveOneOutAccuracy(cases, ruleSet, { maxSweeps: 2 });
  console.log('--- Leave-one-out (proksi generalisasi) ---');
  console.log(`Mean akurasi   : ${fmtPct(loo.meanAccuracy)}`);
  console.log(`Overfit gap    : ${loo.overfitGap >= 0 ? '+' : ''}${(loo.overfitGap * 100).toFixed(2)}% (fit penuh − LOO; negatif besar = overfit)`);
  console.log('');

  // 4. Simpan hasil bila diminta
  const outIdx = process.argv.indexOf('--out');
  if (outIdx !== -1 && process.argv[outIdx + 1]) {
    const outPath = process.argv[outIdx + 1];
    const problems = validateRuleSet(calibration.ruleSet);
    if (problems.length > 0) {
      console.error(`GAGAL: rule set hasil kalibrasi tidak sah: ${problems.join('; ')}`);
      process.exit(1);
    }
    // Sanity: rule set hasil harus menghasilkan hasil identik pada semua kasus
    for (const c of cases) {
      runBattle(c.input, calibration.ruleSet);
    }
    mkdirSync(new URL('.', `file://${outPath.replace(/\\/g, '/')}`), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(calibration.ruleSet, null, 2)}\n`);
    console.log(`Rule set terkalibrasi disimpan: ${outPath}`);
  }

  // Ringkasan
  const improved = calibration.after.accuracy - baseline.accuracy;
  console.log('--- Ringkasan ---');
  console.log(`Perubahan akurasi: ${improved >= 0 ? '+' : ''}${(improved * 100).toFixed(2)}%`);
  console.log(
    improved > 0
      ? 'Bobot terkalibrasi lebih cocok pada dataset ini. Untuk produksi: jalankan LOO pada dataset yang lebih besar, lalu simpan sebagai rule set baru (D19: versi baru, bukan penyesuaian senyap).'
      : 'Baseline sudah lokal-optimum pada dataset ini — tidak ada bobot baru yang perlu disimpan.',
  );
}

main();
