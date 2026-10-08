#!/usr/bin/env node
/**
 * Pemeriksa batas arsitektur.
 *
 *   npm run check:architecture
 *
 * Lint biasa menjawab "apakah kode sekarang melanggar?". Skrip ini menjawab dua
 * pertanyaan yang lebih penting, dan keduanya tidak dapat dijawab lint:
 *
 *   1. **Apakah aturannya benar-benar menggigit?** Fixture yang sengaja melanggar
 *      harus tertangkap dengan rule id dan jumlah yang tepat. Aturan yang tidak
 *      pernah menangkap apa pun tidak dapat dibedakan dari aturan yang salah tulis.
 *   2. **Apakah aturannya masih menjaga hal yang benar?** Empat invarian:
 *      cakupan zona, jalur impor ingestion, kelengkapan klasifikasi tabel, dan
 *      kesamaan daftar enum route dengan tipe engine.
 *
 * Aturan yang diuji di sini dirakit oleh `tools/architecture/eslint-rules.mjs` —
 * fungsi yang sama yang dipakai `eslint.config.mjs`. Jadi yang diuji adalah yang
 * benar-benar dijalankan, bukan salinannya.
 *
 * Keluar dengan status 1 bila ada satu pemeriksaan pun gagal.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { parser as tsParser } from 'typescript-eslint';

import eslintConfig from '../eslint.config.mjs';
import {
  languageOptions,
  rulesForZone,
  selectStarOnlyRules,
} from '../tools/architecture/eslint-rules.mjs';
import { matchesZone } from '../tools/architecture/glob.mjs';
import { LARGE_TABLES, SMALL_TABLES } from '../tools/architecture/large-tables.mjs';
import { INGESTION_ALLOWED_FILES, ZONES } from '../tools/architecture/zones.mjs';
import architecture from '../tools/eslint-plugin-architecture/index.mjs';
import { EXPECTED, INGESTION_ZONE_MATRIX } from '../tests/architecture/fixtures/expected.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const rel = (path) => relative(root, path).replace(/\\/g, '/');

let passed = 0;
const failures = [];

function check(id, ok, detail = '') {
  if (ok) {
    passed += 1;
  } else {
    failures.push(`${id}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * Fixture meniru susunan direktori nyata, sehingga konfigurasi zona untuk fixture
 * diturunkan dari konfigurasi zona asli — bukan ditulis ulang. Kalau zona asli
 * berubah (mis. `app/api/cron/**` berhenti menjadi pengecualian), perubahan itu
 * langsung tercermin pada apa yang diuji di sini.
 *
 * Alasan fixture harus meniru susunan nyata: larangan ingestion diuji lewat
 * jalur relatif (`../../services/ingestion/...`), dan jalur relatif hanya
 * menghasilkan pola yang benar bila struktur direktorinya benar.
 */
const FIXTURE_ROOT = 'tests/architecture/fixtures/';

const fixtureConfig = [
  { ignores: ['**/node_modules/**'] },
  ...ZONES.map((zone) => ({
    files: zone.files.map((pattern) => `${FIXTURE_ROOT}${pattern}`),
    ignores: (zone.ignores ?? []).map((pattern) => `${FIXTURE_ROOT}${pattern}`),
    languageOptions: { parser: tsParser, parserOptions: languageOptions },
    plugins: { architecture },
    // Akar zona digeser ke direktori fixture, agar aturan "impor relatif tidak
    // boleh keluar zona" diuji pada batas yang benar-benar ada di fixture.
    rules: rulesForZone(zone, zone.root ? `${FIXTURE_ROOT}${zone.root}` : undefined),
  })),
  {
    files: [`${FIXTURE_ROOT}select-star/**/*.ts`],
    languageOptions: { parser: tsParser, parserOptions: languageOptions },
    plugins: { architecture },
    rules: selectStarOnlyRules(),
  },
];

/** Mengubah hasil lint menjadi peta `berkas → { ruleId: jumlah }`. */
function tally(results) {
  const map = new Map();
  for (const result of results) {
    const counts = {};
    for (const message of result.messages) {
      if (message.severity !== 2 || !message.ruleId) continue;
      counts[message.ruleId] = (counts[message.ruleId] ?? 0) + 1;
    }
    map.set(rel(result.filePath), counts);
  }
  return map;
}

function sortedEntries(counts) {
  return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
}

function describe(counts) {
  const entries = sortedEntries(counts);
  return entries.length === 0 ? '(bersih)' : entries.map(([id, n]) => `${id}×${n}`).join(', ');
}

// ---------------------------------------------------------------- fixture
const fixtureEslint = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  overrideConfig: fixtureConfig,
});

const fixtureFiles = Object.keys(EXPECTED);
const fixtureResults = tally(await fixtureEslint.lintFiles(fixtureFiles));

for (const [file, expected] of Object.entries(EXPECTED)) {
  const actual = fixtureResults.get(file) ?? {};
  const actualEntries = sortedEntries(actual);
  const expectedEntries = sortedEntries(expected);
  const same =
    actualEntries.length === expectedEntries.length &&
    actualEntries.every(([id, n], i) => expectedEntries[i][0] === id && expectedEntries[i][1] === n);

  check(`fixture ${file}`, same, `diharapkan ${describe(expected)}, didapat ${describe(actual)}`);
}

// Fixture yang tidak punya harapan tidak diuji apa pun — itu lubang, bukan kelalaian kecil.
const fixtureDir = join(root, 'tests/architecture/fixtures');
function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
const allFixtures = walk(fixtureDir)
  .map((path) => rel(path))
  // `.tsx` wajib ikut: fixture halaman (`app/page.tsx`) menguji bahwa zona
  // jalur request juga berlaku untuk berkas TSX; menyaring hanya `.ts` membuat
  // fixture TSX baru dapat hadir di disk tanpa pernah didaftarkan — persis
  // lubang yang invarian ini ada untuk menutupnya.
  .filter((path) => path.endsWith('.ts') || path.endsWith('.tsx'));
const undocumented = allFixtures.filter((path) => !(path in EXPECTED));
check(
  'invarian: setiap fixture punya harapan',
  undocumented.length === 0,
  undocumented.length > 0 ? `belum didaftarkan: ${undocumented.join(', ')}` : '',
);

// -------------------------------------------------------- kode produksi nyata
const realEslint = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  overrideConfig: eslintConfig,
  ignore: true,
});

const realFiles = walk(join(root, 'tests/architecture/fixtures')).length > 0
  ? ['app', 'src', 'worker'].flatMap((dir) => walk(join(root, dir)))
  : [];
const realTargets = realFiles
  .map((path) => rel(path))
  .filter((path) => path.endsWith('.ts') || path.endsWith('.tsx'));

const realResults = tally(await realEslint.lintFiles(realTargets));
const realViolations = [...realResults.entries()].filter(([, counts]) => Object.keys(counts).length > 0);
check(
  'kode nyata bebas pelanggaran batas',
  realViolations.length === 0,
  realViolations.map(([file, counts]) => `${file}: ${describe(counts)}`).join(' | '),
);
check('invarian: berkas produksi terdeteksi', realTargets.length >= 10, `didapat ${realTargets.length}`);

// ------------------------------------------- invarian 1: cakupan zona
const zoneCoverage = [];
for (const path of realTargets) {
  const zones = ZONES.filter((zone) => matchesZone(path, zone));
  zoneCoverage.push([path, zones.map((zone) => zone.name)]);
}

const unzoned = zoneCoverage.filter(([, zones]) => zones.length === 0).map(([path]) => path);
const overlapped = zoneCoverage
  .filter(([, zones]) => zones.length > 1)
  .map(([path, zones]) => `${path} (${zones.join(', ')})`);

check(
  'invarian: setiap berkas produksi masuk tepat satu zona',
  unzoned.length === 0 && overlapped.length === 0,
  [unzoned.length > 0 ? `tanpa zona: ${unzoned.join(', ')}` : '', overlapped.length > 0 ? `tumpang tindih: ${overlapped.join(', ')}` : '']
    .filter(Boolean)
    .join(' | '),
);

// ------------------------------------- invarian 2: impor ingestion (AC-25)
// Diperiksa langsung pada teks kode, bukan lewat ESLint, supaya klaimnya tidak
// bergantung pada konfigurasi lint yang sedang diuji kebenarannya.
const IMPORT_INGESTION = /(?:from|import)\s*\(?\s*['"][^'"]*services\/ingestion/;
const ingestionImporters = [];
for (const path of realTargets) {
  const text = readFileSync(join(root, path), 'utf8');
  if (IMPORT_INGESTION.test(text)) ingestionImporters.push(path);
}

const disallowed = ingestionImporters.filter(
  (path) => !INGESTION_ALLOWED_FILES.some((pattern) => matchesZone(path, { files: [pattern] })),
);
check(
  'invarian AC-25: ingestion hanya diimpor dari jalur yang diizinkan',
  disallowed.length === 0,
  disallowed.length > 0 ? `di luar izin: ${disallowed.join(', ')}` : '',
);
check(
  'invarian AC-25: ada berkas yang benar-benar mengimpor ingestion',
  ingestionImporters.length > 0,
  'tidak ada satu pun — berarti aturannya tidak sedang menguji apa pun',
);

// Matriks per-zona dinilai dari EFEK, bukan dari ada/tidaknya entri `deny`:
// aturan engine menolak ingestion lewat `allowedNodeModules`, bukan lewat `deny`,
// sehingga heuristik berbasis `deny` akan salah menyimpulkan bahwa engine boleh
// memuat ingestion. Yang benar-benar ingin diketahui adalah apa yang terjadi saat
// berkas itu dilinting.
const matrixProblems = [];
for (const [file, expected] of Object.entries(INGESTION_ZONE_MATRIX)) {
  const counts = fixtureResults.get(file) ?? {};
  const reports = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const actual = reports > 0 ? 'blocked' : 'allowed';
  if (actual !== expected) {
    matrixProblems.push(`${file}: diharapkan ${expected}, didapat ${actual} (${describe(counts)})`);
  }
}
check(
  'invarian AC-25: matriks per-zona sesuai harapan',
  matrixProblems.length === 0,
  matrixProblems.join(' | '),
);

const allowedByEffect = Object.entries(INGESTION_ZONE_MATRIX)
  .filter(([, verdict]) => verdict === 'allowed')
  .map(([file]) => file.replace(FIXTURE_ROOT, ''));
check(
  'invarian AC-25: yang boleh memuat ingestion hanya worker & cron',
  allowedByEffect.every(
    (path) => path.startsWith('worker/') || path.startsWith('app/api/cron/'),
  ) && allowedByEffect.length === 2,
  `daftar yang diizinkan: ${allowedByEffect.join(', ')}`,
);

// ---------------------------- invarian 3: klasifikasi tabel vs docs/schema.sql
const schema = readFileSync(join(root, 'docs/schema.sql'), 'utf8');
const schemaTables = [
  ...schema.matchAll(/^create table(?: if not exists)?\s+([a-z_]+)/gim),
  ...schema.matchAll(/^create materialized view\s+([a-z_]+)/gim),
].map((match) => match[1]);

const largeNames = Object.keys(LARGE_TABLES);
const smallNames = Object.keys(SMALL_TABLES);
const classified = [...largeNames, ...smallNames];
const duplicated = classified.filter((name, index) => classified.indexOf(name) !== index);
const unclassified = schemaTables.filter((name) => !classified.includes(name));
const phantom = classified.filter((name) => !schemaTables.includes(name));
const reasonless = Object.entries({ ...LARGE_TABLES, ...SMALL_TABLES })
  .filter(([, reason]) => typeof reason !== 'string' || reason.trim().length < 20)
  .map(([name]) => name);

check(
  'invarian: setiap tabel di schema diklasifikasikan besar/kecil',
  unclassified.length === 0 && phantom.length === 0 && duplicated.length === 0,
  [
    unclassified.length > 0 ? `belum diklasifikasi: ${unclassified.join(', ')}` : '',
    phantom.length > 0 ? `tidak ada di schema: ${phantom.join(', ')}` : '',
    duplicated.length > 0 ? `ganda: ${duplicated.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' | '),
);
check(
  'invarian: setiap klasifikasi punya alasan',
  reasonless.length === 0,
  reasonless.length > 0 ? `tanpa alasan: ${reasonless.join(', ')}` : '',
);
check(
  'invarian: jumlah tabel + MV cocok dengan klaim PRD',
  schemaTables.length === 40,
  `didapat ${schemaTables.length}, PRD §22 menyebut 37 tabel + 3 MV`,
);

// ----------------------- invarian 4: daftar enum route = tipe engine
// Komentar di route mengklaim daftar ini dijaga uji. Klaim itu harus benar.
const typesSource = readFileSync(join(root, 'src/services/battle/types.ts'), 'utf8');
const routeSource = readFileSync(join(root, 'app/api/battle/simulate/route.ts'), 'utf8');

const ENGINE_TYPES = {
  BattleMode: 'MODES',
  Battlefield: 'BATTLEFIELDS',
  KnowledgeLevel: 'KNOWLEDGE',
  PrepTime: 'PREP',
  WinCondition: 'WIN_CONDITIONS',
};

for (const [typeName, constName] of Object.entries(ENGINE_TYPES)) {
  const typeMatch = new RegExp(`export type ${typeName} =([^;]+);`).exec(typesSource);
  const listMatch = new RegExp(`const ${constName} = \\[([^\\]]+)\\]`).exec(routeSource);

  if (!typeMatch || !listMatch) {
    check(`invarian enum ${typeName}`, false, 'tipe atau daftar route tidak ditemukan');
    continue;
  }

  const parse = (text) => [...text.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort();
  const engineValues = parse(typeMatch[1]);
  const routeValues = parse(listMatch[1]);

  check(
    `invarian enum ${typeName} ↔ ${constName}`,
    engineValues.join(',') === routeValues.join(','),
    `engine [${engineValues.join(', ')}] vs route [${routeValues.join(', ')}]`,
  );
}

// ------------------------------------------------------------------ hasil
console.log('=== Batas arsitektur ===\n');
console.log(`Berkas produksi diperiksa : ${realTargets.length}`);
console.log(`Fixture diperiksa         : ${allFixtures.length}`);
console.log(`Zona                      : ${ZONES.map((zone) => zone.name).join(', ')}`);
console.log(`Tabel besar               : ${largeNames.length} (kecil: ${smallNames.length})`);
console.log();

if (failures.length > 0) {
  console.log('GAGAL:');
  for (const failure of failures) console.log(`  FAIL  ${failure}`);
  console.log();
}

console.log(`Total: ${passed + failures.length} · lulus ${passed} · gagal ${failures.length}`);
process.exit(failures.length === 0 ? 0 : 1);
