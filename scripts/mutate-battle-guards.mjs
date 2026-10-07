#!/usr/bin/env node
/**
 * Uji mutasi guard case library — membuktikan runner benar-benar MENOLAK library
 * yang rusak, bukan hanya lulus pada library yang sehat (AC-36).
 *
 *   npm run check:battle-guards
 *
 * Cara kerja: setiap mutasi diterapkan ke satu berkas kasus di disk, runner
 * dijalankan sebagai proses terpisah, dan hasilnya harus non-zero. Berkas
 * SELALU dipulihkan (termasuk saat proses gagal atau diinterupsi), dan
 * pemulihan diverifikasi dengan membandingkan sha256 isi berkas.
 *
 * Keluar dengan status 1 bila ada satu mutasi pun lolos tanpa ditolak.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const casesDir = fileURLToPath(new URL('../src/services/battle/cases/', import.meta.url));
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** `expect` → matcher output runner (string = substring, RegExp = test). */
function matcher(expected) {
  return typeof expected === 'string'
    ? { test: (s) => s.includes(expected), describe: expected }
    : { test: (s) => expected.test(s), describe: String(expected) };
}

/**
 * Daftar mutasi: setiap satu harus menghasilkan penolakan yang spesifik.
 *
 * `expect` boleh berupa RegExp, string (dicari sebagai substring), atau fungsi
 * `(parsedCase) => RegExp | string` bila penolakan yang benar bergantung pada isi
 * berkas hasil mutasi (mis. id kasusnya). Memakai RegExp longgar seperti /FAIL/
 * tidak cukup: penolakan bisa datang dari pemeriksaan lain yang kebetulan gagal,
 * sehingga mutasi akan dianggap tertangkap padahal guard yang diuji tidak menggigit.
 */
const MUTATIONS = [
  {
    label: 'id kasus duplikat',
    file: 'dominance.json',
    expect: /id kasus duplikat/,
    apply(c) {
      c.cases[1].id = c.cases[0].id;
    },
  },
  {
    label: 'kasus tanpa expect',
    file: 'speed.json',
    expect: /tanpa harapan \(expect\)/,
    apply(c) {
      delete c.cases[0].expect;
    },
  },
  {
    label: 'side_a === side_b',
    file: 'hax.json',
    expect: /side_a === side_b/,
    apply(c) {
      c.cases[0].side_b = c.cases[0].side_a;
    },
  },
  {
    label: 'rujukan sisi tidak ada di roster',
    file: 'incomplete.json',
    expect: /fixture tidak dapat dimuat/,
    apply(c) {
      c.cases[0].side_b = 'sisi_yang_tidak_pernah_ada';
    },
  },
  {
    label: 'ekspektasi dibalik (regresi engine tidak boleh lolos)',
    file: 'qualifiers.json',
    // Bukan sekadar /FAIL/: runner harus menyebut KASUS yang gagal. Kalau tidak,
    // penolakan bisa datang dari pemeriksaan lain dan mutasi ini lolos secara palsu.
    expect: (c) => c.cases[0].id,
    apply(c) {
      const w = c.cases[0].expect.winner;
      c.cases[0].expect.winner = Array.isArray(w)
        ? w.map((x) => (x === 'a' ? 'b' : 'a'))
        : w === 'a'
          ? 'b'
          : 'a';
    },
  },
  {
    label: 'kategori kasus dihapus (cakupan tidak lagi terwakili)',
    file: 'conditions.json',
    expect: /kategori "conditions" terwakili/,
    apply(c) {
      for (const k of c.cases) k.category = 'speed';
    },
  },
];

let leaked = 0;
const rows = [];

for (const mut of MUTATIONS) {
  const path = `${casesDir}${mut.file}`;
  const original = readFileSync(path, 'utf8');
  const before = sha256(original);
  let verdict;
  let detail = '';

  try {
    const parsed = JSON.parse(original);
    mut.apply(parsed);
    const expected = matcher(typeof mut.expect === 'function' ? mut.expect(parsed) : mut.expect);
    writeFileSync(path, JSON.stringify(parsed, null, 2));

    const run = spawnSync(process.execPath, ['scripts/run-battle-cases.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;

    if (run.status === 0) {
      leaked += 1;
      verdict = 'BOCOR';
      detail = 'runner menerima library yang rusak';
    } else if (!expected.test(output)) {
      leaked += 1;
      verdict = 'SALAH ALASAN';
      detail = `ditolak, tetapi bukan karena "${expected.describe}"`;
    } else {
      verdict = 'OK';
      detail = `ditolak (exit ${run.status}) — "${expected.describe}"`;
    }
  } catch (err) {
    leaked += 1;
    verdict = 'ERROR';
    detail = String(err?.message ?? err).split('\n')[0] ?? '';
  } finally {
    writeFileSync(path, original);
    const after = sha256(readFileSync(path, 'utf8'));
    if (after !== before) {
      leaked += 1;
      rows.push([mut.label, 'GAGAL PULIH', `${mut.file} tidak kembali ke isi semula`]);
      continue;
    }
  }

  rows.push([mut.label, verdict, detail]);
}

const width = Math.max(...rows.map((r) => r[0].length));
console.log('=== Uji mutasi guard case library ===\n');
for (const [label, verdict, detail] of rows) {
  console.log(`${verdict.padEnd(12)} ${label.padEnd(width)}  ${detail}`);
}
console.log(`\nTotal: ${rows.length} mutasi · tertangkap ${rows.length - leaked} · bocor ${leaked}`);
console.log(
  leaked === 0
    ? 'Setiap cara merusak library tertangkap dengan alasan yang benar, dan semua berkas pulih utuh.'
    : 'ADA GUARD YANG BOCOR — perbaiki runner sebelum mempercayai case library.',
);

process.exit(leaked === 0 ? 0 : 1);
