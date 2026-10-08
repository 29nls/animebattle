/**
 * Harness kalibrasi bobot engine (PRD §17.1, D19).
 *
 * Fungsi di sini MURNI — tanpa I/O, tanpa RNG (aturan zona engine, PRD §39).
 * Pemanggil (scripts/calibrate-weights.mjs, atau admin tooling masa depan)
 * memuat dataset berlabel dan menyerahkannya sebagai argumen.
 *
 * Cara kerja:
 *  - `evaluateRuleSet` menjalankan `runBattle` pada setiap kasus berlabel dan
 *    mengukur akurasi pemenang + Brier score. Kasus `insufficient_data`/`draw`
 *    tidak dihukum — tidak ada pemenang yang dapat diprediksi di sana (PRD
 *    §16.3 Layer 0 dan §8.5 melarang menebak).
 *  - `calibrateWeights` melakukan coordinate descent bulat pada bobot: untuk
 *    setiap kunci, coba ±delta sambil menjaga Σ = 100 eksak (kompensasi pada
 *    kunci kedua yang paling tidak merugikan). Hanya bobot yang dioptimasi —
 *    konstanta dan aturan hax tetap milik admin (D2, D15).
 *  - `leaveOneOutAccuracy` melaporkan overfit: fit penuh yang jauh lebih baik
 *    dari LOO berarti dataset terlalu kecil, bukan engine yang membaik.
 *
 * Label adalah PEMENANG KANON yang dinyatakan manusia (sumber terpercaya),
 * bukan output engine. Dataset produksi nantinya berasal dari battle history
 * yang dikurasi; offline, case library `src/services/battle/cases/` dipakai
 * sebagai proksi berlabel.
 */

import { runBattle } from './engine.ts';
import { WEIGHT_KEYS, validateRuleSet } from './rule-set.ts';
import type { BattleInput, RuleSet, WeightKey } from './types.ts';

/** Satu kasus berlabel: label = pemenang menurut sumber kanon terpercaya. */
export interface LabelledBattleCase {
  id: string;
  /** Pemenang menurut label. `draw` sah namun dikecualikan dari skor. */
  label: 'a' | 'b' | 'draw';
  input: BattleInput;
}

export interface EvaluationReport {
  total: number;
  /**
   * Kasus yang dinilai: label a/b dipertemukan dengan pemenang a/b, dan
   * label draw dipertemukan dengan hasil draw. Kasus `insufficient_data`
   * dikecualikan seluruhnya (tidak ada prediksi yang dapat dibuat).
   */
  evaluated: number;
  correct: number;
  /** correct/evaluated; 0 bila tidak ada kasus yang dinilai. Selalu ≤ 1. */
  accuracy: number;
  /** Mean squared error probabilitas (target 0,5 untuk draw); 0 bila kosong. */
  brier: number;
  drawCount: number;
  insufficientCount: number;
  /** Id kasus dengan label yang tidak cocok (untuk audit, terurut). */
  mislabeled: string[];
}

/** Skor Brier maksimum yang mungkin (kedua sisi salah total → 2·1²). */
export const BRIER_MAX = 2;

/** Jalankan seluruh dataset terhadap satu rule set, tanpa mengubah apa pun. */
export function evaluateRuleSet(cases: readonly LabelledBattleCase[], ruleSet: RuleSet): EvaluationReport {
  let evaluated = 0;
  let correct = 0;
  let brierSum = 0;
  let drawCount = 0;
  let insufficientCount = 0;
  const mislabeled: string[] = [];

  for (const item of cases) {
    const result = runBattle(item.input, ruleSet);
    if (result.winner === 'insufficient_data') {
      insufficientCount += 1;
      continue;
    }

    const predictedDraw = result.winner === 'draw';
    if (predictedDraw || item.label === 'draw') drawCount += 1;

    // Prediksi draw adalah klaim yang dapat salah, jadi ikut penyebut:
    // label draw ↔ hasil draw = benar; label a/b ↔ hasil draw (atau
    // sebaliknya) = salah, karena menimbulkan/menyembunyikan pemenang.
    if (predictedDraw !== (item.label === 'draw')) mislabeled.push(item.id);

    evaluated += 1;
    const yA = item.label === 'draw' ? 0.5 : item.label === 'a' ? 1 : 0;
    const p = predictedDraw ? 0.5 : result.win_probability.a;
    brierSum += (p - yA) ** 2 + (1 - p - (1 - yA)) ** 2;
    if (predictedDraw === (item.label === 'draw') && !predictedDraw && result.winner === item.label) {
      correct += 1;
    } else if (predictedDraw && item.label === 'draw') {
      correct += 1;
    }
  }

  return {
    total: cases.length,
    evaluated,
    correct,
    accuracy: evaluated === 0 ? 0 : correct / evaluated,
    brier: evaluated === 0 ? 0 : brierSum / evaluated,
    drawCount,
    insufficientCount,
    mislabeled: [...new Set(mislabeled)].sort(),
  };
}

export interface CalibrationOptions {
  /** Jumlah sweep coordinate-descent maksimum (default 4). */
  maxSweeps?: number;
  /** Langkah ± per kandidat (default 2; Σ dijaga 100 lewat kompensasi). */
  step?: number;
  /** Delta minimum yang masih dicoba; sweep berhenti bila tidak ada perbaikan. */
  minStep?: number;
  /** Logger opsional untuk jejak sweep (script memakainya). */
  log?: (message: string) => void;
}

export interface CalibrationResult {
  ruleSet: RuleSet;
  before: EvaluationReport;
  after: EvaluationReport;
  /** Riwayat akurasi per sweep, termasuk baseline di indeks 0. */
  history: number[];
  sweeps: number;
  changes: Array<{ key: WeightKey; from: number; to: number }>;
}

function cloneRuleSet(ruleSet: RuleSet, version: string): RuleSet {
  return {
    ...ruleSet,
    version,
    weights: { ...ruleSet.weights },
    // Konstanta & hax_rules tidak disentuh kalibrasi: itu domain admin (D2).
    constants: { ...ruleSet.constants },
    hax_rules: [...ruleSet.hax_rules],
  };
}

/**
 * Cari kunci kompensator terbaik untuk menjaga Σ = 100: kunci dengan bobot
 * tertinggi yang masih punya ruang ≥ 0 setelah dikurangi delta. Deterministik.
 */
function compensatorFor(weights: Record<WeightKey, number>, moved: WeightKey, delta: number): WeightKey | null {
  let best: WeightKey | null = null;
  for (const key of WEIGHT_KEYS) {
    if (key === moved) continue;
    const w = weights[key];
    if (w - delta >= 0 && (best === null || w > weights[best])) best = key;
  }
  return best;
}

function score(weights: Record<WeightKey, number>, base: RuleSet, cases: readonly LabelledBattleCase[]): number {
  const candidate: RuleSet = { ...base, weights };
  // Kandidat yang gagal validasi (Σ ≠ 100 dsb.) langsung dianggap terburuk.
  if (validateRuleSet(candidate).length > 0) return -1;
  return evaluateRuleSet(cases, candidate).accuracy;
}

/**
 * Coordinate descent bulat pada bobot. Menjamin:
 *  - Σ bobot = 100 eksak setiap langkah (kompensator terbesar),
 *  - akurasi training tidak pernah turun (kandidat diambil hanya bila >),
 *  - deterministik penuh (urutan kunci dari WEIGHT_KEYS, tie-break pertama).
 */
export function calibrateWeights(
  cases: readonly LabelledBattleCase[],
  ruleSet: RuleSet,
  options: CalibrationOptions = {},
): CalibrationResult {
  const maxSweeps = options.maxSweeps ?? 4;
  const minStep = options.minStep ?? 1;
  const log = options.log ?? (() => {});

  const before = evaluateRuleSet(cases, ruleSet);
  const working = cloneRuleSet(ruleSet, `${ruleSet.version}-calibrated`);
  const history: number[] = [before.accuracy];
  const changes: CalibrationResult['changes'] = [];
  if (cases.length === 0) {
    return { ruleSet: working, before, after: before, history, sweeps: 0, changes };
  }

  let best = before.accuracy;
  let step = options.step ?? 2;
  let sweep = 0;
  for (; sweep < maxSweeps && step >= minStep; sweep += 1) {
    let improvedThisSweep = false;
    for (const key of WEIGHT_KEYS) {
      for (const direction of [1, -1] as const) {
        const delta = step * direction;
        const moved = working.weights[key];
        const target = moved + delta;
        if (target < 0) continue;
        const compKey = compensatorFor(working.weights, key, delta);
        if (compKey === null) continue;
        const comp = working.weights[compKey];

        const candidate = { ...working.weights, [key]: target, [compKey]: comp - delta };
        const candidateScore = score(candidate, working, cases);
        if (candidateScore > best) {
          working.weights[key] = target;
          working.weights[compKey] = comp - delta;
          best = candidateScore;
          improvedThisSweep = true;
          changes.push({
            key,
            from: moved,
            to: target,
          });
          log(`  ${key}: ${moved} → ${target} (kompensasi ${compKey}: ${comp} → ${comp - delta}) · akurasi ${candidateScore.toFixed(4)}`);
        }
      }
    }
    history.push(best);
    log(`sweep ${sweep + 1}: akurasi terbaik ${best.toFixed(4)}`);
    if (!improvedThisSweep) {
      // Tidak ada perbaikan pada langkah ini — perkecil langkah sekali, lalu
      // berhenti bila sudah mencapai langkah minimum.
      if (step <= minStep) break;
      step = Math.max(minStep, Math.floor(step / 2));
    }
  }

  const final: RuleSet = { ...working };
  const problems = validateRuleSet(final);
  if (problems.length > 0) {
    // Kontrak: kalibrasi tidak boleh menghasilkan rule set yang ditolak engine.
    throw new Error(`kalibrasi menghasilkan rule set tidak sah: ${problems.join('; ')}`);
  }
  return { ruleSet: final, before, after: evaluateRuleSet(cases, final), history, sweeps: sweep, changes };
}

export interface LeaveOneOutRow {
  excludedId: string;
  evaluated: number;
  correct: number;
  accuracy: number;
}

export interface LeaveOneOutReport {
  rows: LeaveOneOutRow[];
  /** Mean akurasi LOO; proksi honest estimate generalisasi. */
  meanAccuracy: number;
  /** meanAccuracy − akurasi fit penuh; negatif besar = tanda overfit. */
  overfitGap: number;
}

/**
 * Leave-one-out: untuk setiap kasus, fit ulang bobot tanpa kasus itu, lalu
 * evaluasi pada kasus yang dibuang. O(n·fit) — dataset produksi sebaiknya
 * di-stratify sebelum dipakai penuh.
 */
export function leaveOneOutAccuracy(
  cases: readonly LabelledBattleCase[],
  ruleSet: RuleSet,
  options: CalibrationOptions = {},
): LeaveOneOutReport {
  const rows: LeaveOneOutRow[] = [];
  for (let i = 0; i < cases.length; i += 1) {
    const held = cases[i];
    const rest = [...cases.slice(0, i), ...cases.slice(i + 1)];
    const fit = calibrateWeights(rest, ruleSet, { ...options, log: () => {} });
    const report = evaluateRuleSet([held], fit.ruleSet);
    rows.push({
      excludedId: held.id,
      evaluated: report.evaluated,
      correct: report.correct,
      accuracy: report.accuracy,
    });
  }
  const meanAccuracy =
    rows.length === 0 ? 0 : rows.reduce((acc, r) => acc + r.accuracy, 0) / rows.length;
  const fullFit = evaluateRuleSet(cases, ruleSet);
  const fullTrained = calibrateWeights(cases, ruleSet, { ...options, log: () => {} });
  return {
    rows,
    meanAccuracy,
    overfitGap: meanAccuracy - fullTrained.after.accuracy,
  };
}
