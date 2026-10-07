/**
 * Konfigurasi ESLint — dirakit dari aturan arsitektur, bukan ditulis manual.
 *
 * Zona, aturan per zona, dan daftar tabel besar dibaca dari `tools/architecture/`,
 * sehingga menambah zona atau mengubah klasifikasi tabel tidak menuntut
 * menyunting berkas ini. `scripts/check-architecture.mjs` memakai berkas data dan
 * fungsi perakit yang **sama**, sehingga yang diuji benar-benar yang dijalankan.
 *
 * Cakupan sengaja fokus pada batas arsitektur. Aturan gaya/format tidak dipasang
 * di sini: repo ini memakai `tsc --noEmit` sebagai penjaga tipe, dan ratusan
 * aturan kosmetik hanya akan membuat sinyal batas arsitektur tenggelam.
 */

import { parser as tsParser, plugin as tsPlugin } from 'typescript-eslint';

import { languageOptions, rulesForZone } from './tools/architecture/eslint-rules.mjs';
import { ZONES } from './tools/architecture/zones.mjs';
import architecture from './tools/eslint-plugin-architecture/index.mjs';

const language = {
  parser: tsParser,
  parserOptions: languageOptions,
};

const plugins = { architecture, '@typescript-eslint': tsPlugin };

export default [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'docs/**',
      'next-env.d.ts',
      // Fixture memang berisi pelanggaran yang disengaja. Ia diperiksa
      // `check:architecture` dengan konfigurasi eksplisit; kalau ikut lint biasa,
      // lint akan selalu merah dan tidak lagi dipercaya sebagai sinyal.
      'tests/architecture/fixtures/**',
    ],
  },

  // Satu blok per zona arsitektur. `ignores` di dalam blok ber-`files` bersifat
  // mempersempit blok itu saja — itulah cara endpoint cron dikecualikan dari
  // zona request tanpa mengecualikannya dari lint.
  ...ZONES.map((zone) => ({
    files: zone.files,
    ignores: zone.ignores ?? [],
    languageOptions: language,
    plugins,
    rules: rulesForZone(zone),
  })),

  // Berkas di luar semua zona tetap diperiksa soal `select *`: aturan itu berlaku
  // pada setiap query, bukan hanya query di direktori tertentu.
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ZONES.flatMap((zone) => zone.files),
    languageOptions: language,
    plugins,
    rules: rulesForZone({ name: 'unzoned' }),
  },
];
