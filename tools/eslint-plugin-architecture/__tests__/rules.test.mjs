/**
 * Uji unit aturan batas arsitektur.
 *
 *   npm run test:lint-rules
 *
 * Setiap kasus `invalid` di sini adalah janji yang dapat dieksekusi: kalau aturan
 * berhenti menggigit, uji ini gagal — dan itu terjadi tanpa perlu menjalankan
 * lint pada seluruh repo.
 *
 * Beberapa kasus sengaja merupakan **regresi bug nyata yang ditemukan saat
 * pemeriksaan pertama**, ditandai `REGRESI:`:
 *   1. `engine-purity` menuduh impor relatif yang sah di dalam zona engine,
 *      karena membandingkan jalur absolut dengan akar zona yang relatif.
 *   2. `boundary-import` tidak melihat impor ingestion lewat jalur **relatif**,
 *      sehingga larangan berbasis nama modul hanya menangkap bentuk alias.
 *   3. `no-select-star` melewatkan bintang yang dipindahkan ke konstanta lokal
 *      pada rantai builder, sementara bentuk yang sama pada SQL template
 *      tertangkap — aturan yang tidak konsisten dengan dirinya sendiri.
 */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { RuleTester } from 'eslint';
import { parser as tsParser } from 'typescript-eslint';

import boundaryImport from '../rules/boundary-import.mjs';
import enginePurity from '../rules/engine-purity.mjs';
import noSelectStar from '../rules/no-select-star.mjs';

/**
 * Zona engine diuji pada jalur yang **absolut di platform ini**, bukan pada
 * jalur contoh bergaya POSIX saja: `engine-purity` membandingkan jalur hasil
 * resolusi dengan akar zona, dan perbandingan itu hanya bermakna kalau keduanya
 * memakai basis yang sama. Uji yang memakai jalur palsu akan memberi hasil
 * berbeda di Windows dan Linux — dan uji yang berbeda hasil antar platform tidak
 * membuktikan apa pun.
 */
const BATTLE_ROOT = resolve('/repo/src/services/battle');
const battleFile = (name) => `${BATTLE_ROOT.replaceAll('\\', '/')}/${name}`;

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  },
});

const LARGE_TABLES = {
  characters: 'tabel utama; 10k–100k baris dan kolom berat',
  statistics: '±13 baris per form',
  battle_results: 'satu baris per battles × versi rule set',
};

const ENGINE_OPTIONS = {
  zone: 'engine',
  allowedNodeModules: { 'node:crypto': ['createHash'] },
  denyGlobals: ['fetch', 'process', 'console', 'Date', 'crypto'],
  denyMembers: ['Math.random'],
  zoneRoot: BATTLE_ROOT,
};

const BOUNDARY_OPTIONS = {
  zone: 'web-request',
  deny: [{ pattern: 'services/ingestion', reason: 'ingestion off-request', prd: 'AC-25' }],
};

test('no-select-star: bentuk yang harus ditolak dan yang harus lolos', () => {
  tester.run('no-select-star', noSelectStar, {
    valid: [
      // Kolom eksplisit.
      { code: 'const q = `select id, slug from characters limit $1`;', options: [{ largeTables: LARGE_TABLES }] },
      // count(*) tidak mengambil kolom apa pun.
      { code: 'const q = `select count(*)::text from characters`;', options: [{ largeTables: LARGE_TABLES }] },
      // Perkalian, bukan bintang daftar kolom.
      { code: 'const q = `select popularity * 2 from characters`;', options: [{ largeTables: LARGE_TABLES }] },
      // Tabel kecil: sengaja boleh dibaca utuh.
      { code: 'const q = `select * from tiers`;', options: [{ largeTables: LARGE_TABLES }] },
      // Pemanggilan fungsi: kolomnya ditetapkan tanda tangan, bukan tabel.
      { code: 'const q = `select * from public.search_characters($1)`;', options: [{ largeTables: LARGE_TABLES }] },
      // Daftar kolom dinamis tanpa bintang yang terlihat — batas yang diakui.
      { code: 'const cols = ["id"].join(","); const q = `select ${cols} from characters`;', options: [{ largeTables: LARGE_TABLES }] },
      { code: 'db.from("characters").select("id, slug, name")', options: [{ largeTables: LARGE_TABLES }] },
    ],
    invalid: [
      {
        code: 'const q = `select * from characters`;',
        options: [{ largeTables: LARGE_TABLES }],
        errors: [{ messageId: 'largeTable' }],
      },
      {
        code: 'const q = "select c.* from characters c";',
        options: [{ largeTables: LARGE_TABLES }],
        errors: [{ messageId: 'largeTable' }],
      },
      {
        code: 'const q = `select id, * from battle_results`;',
        options: [{ largeTables: LARGE_TABLES }],
        errors: [{ messageId: 'largeTable' }],
      },
      {
        code: 'db.from("statistics").select("*")',
        options: [{ largeTables: LARGE_TABLES }],
        errors: [{ messageId: 'largeTable' }],
      },
      {
        // Tabelnya tidak dapat ditentukan → tetap dilaporkan.
        code: 'const q = `select * from (select id from statistics) t`;',
        options: [{ largeTables: LARGE_TABLES }],
        errors: [{ messageId: 'unverifiable' }],
      },
      {
        // REGRESI 3: bintang lewat konstanta pada rantai builder.
        code: 'const columns = "*"; db.from("battle_results").select(columns);',
        options: [{ largeTables: LARGE_TABLES }],
        errors: [{ messageId: 'largeTable' }],
      },
      {
        code: 'const columns = "*"; const q = `select ${columns} from characters`;',
        options: [{ largeTables: LARGE_TABLES }],
        errors: [{ messageId: 'largeTable' }],
      },
      {
        code: 'const wide = "*, id"; db.from("statistics").select(wide);',
        options: [{ largeTables: LARGE_TABLES }],
        errors: [{ messageId: 'largeTable' }],
      },
    ],
  });
});

test('boundary-import: larangan lintas zona', () => {
  tester.run('boundary-import', boundaryImport, {
    valid: [
      // Impor relatif ke modul antrian: cara yang sah memicu ingestion.
      {
        code: 'import { enqueueIngestionJob } from "../../services/queue/ingestion-jobs.ts";',
        filename: '/repo/src/features/admin/run.ts',
        options: [BOUNDARY_OPTIONS],
      },
      // Zona yang mengizinkan ingestion.
      {
        code: 'import { runIngestionJob } from "@/services/ingestion/pipeline.ts";',
        filename: '/repo/worker/ingest.ts',
        options: [{ zone: 'ingestion-worker' }],
      },
      {
        code: 'import { runIngestionJob } from "@/services/ingestion/pipeline.ts";',
        filename: '/repo/app/api/cron/sync/route.ts',
        options: [{ zone: 'scheduled-worker' }],
      },
    ],
    invalid: [
      {
        code: 'import { runIngestionJob } from "@/services/ingestion/pipeline.ts";',
        filename: '/repo/src/features/battle/simulate.ts',
        options: [BOUNDARY_OPTIONS],
        errors: [{ messageId: 'denied' }],
      },
      {
        // REGRESI 2: bentuk relatif yang sebelumnya lolos sepenuhnya.
        code: 'import { runIngestionJob } from "../../services/ingestion/pipeline.ts";',
        filename: '/repo/src/features/battle/simulate.ts',
        options: [BOUNDARY_OPTIONS],
        errors: [{ messageId: 'denied' }],
      },
      {
        code: 'const mod = await import("../../services/ingestion/pipeline.ts");',
        filename: '/repo/src/features/battle/simulate.ts',
        options: [BOUNDARY_OPTIONS],
        errors: [{ messageId: 'denied' }],
      },
      {
        // Zona Node: alias `@/` tidak dikenali saat runtime.
        code: 'import type { SqlClient } from "@/lib/db/client.ts";',
        filename: '/repo/src/lib/queue.ts',
        options: [{ zone: 'node-runtime', relativeImportsOnly: true }],
        errors: [{ messageId: 'aliasForbidden' }],
      },
    ],
  });
});

test('engine-purity: engine bebas I/O dan deterministik', () => {
  tester.run('engine-purity', enginePurity, {
    valid: [
      // REGRESI 1: impor relatif yang sah di dalam zona engine.
      {
        code: 'import { clamp } from "./metrics.ts";\nimport type { SideData } from "./types.ts";',
        filename: battleFile('engine.ts'),
        options: [ENGINE_OPTIONS],
      },
      // Satu-satunya modul eksternal yang diizinkan, dengan anggotanya.
      {
        code: "import { createHash } from 'node:crypto';",
        filename: battleFile('stable-json.ts'),
        options: [ENGINE_OPTIONS],
      },
      // Anggota `Math` yang murni tetap boleh.
      {
        code: 'export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);',
        filename: battleFile('metrics.ts'),
        options: [ENGINE_OPTIONS],
      },
      // Global yang ditutup-tutupi nama lokal bukan pelanggaran.
      {
        code: 'export function f(Date: number): number { return Date; }',
        filename: battleFile('gates.ts'),
        options: [ENGINE_OPTIONS],
      },
    ],
    invalid: [
      {
        code: "import { readFileSync } from 'node:fs';",
        filename: battleFile('io.ts'),
        options: [ENGINE_OPTIONS],
        errors: [{ messageId: 'externalImport' }],
      },
      {
        code: "import { resolve } from '@/lib/db/client.ts';",
        filename: battleFile('io.ts'),
        options: [ENGINE_OPTIONS],
        errors: [{ messageId: 'externalImport' }],
      },
      {
        // Modul yang diizinkan, anggota yang tidak.
        code: "import { randomUUID } from 'node:crypto';",
        filename: battleFile('id.ts'),
        options: [ENGINE_OPTIONS],
        errors: [{ messageId: 'unlistedMember' }],
      },
      {
        code: "import * as crypto from 'node:crypto';",
        filename: battleFile('id.ts'),
        options: [ENGINE_OPTIONS],
        errors: [{ messageId: 'wildcardImport' }],
      },
      {
        // Impor relatif yang keluar dari zona: diam-diam menarik modul lain.
        code: "import { runIngestionJob } from '../ingestion/pipeline.ts';",
        filename: battleFile('engine.ts'),
        options: [ENGINE_OPTIONS],
        errors: [{ messageId: 'outsideZone' }],
      },
      {
        code: 'export function now(): number { return Date.now(); }',
        filename: battleFile('meta.ts'),
        options: [ENGINE_OPTIONS],
        errors: [{ messageId: 'deniedGlobal' }],
      },
      {
        code: 'export const noise = () => Math.random();',
        filename: battleFile('meta.ts'),
        options: [ENGINE_OPTIONS],
        errors: [{ messageId: 'deniedMember' }],
      },
      {
        code: 'export function log(msg: string): void { console.log(msg); }',
        filename: battleFile('meta.ts'),
        options: [ENGINE_OPTIONS],
        errors: [{ messageId: 'deniedGlobal' }],
      },
      {
        code: 'export const env = process.env.NODE_ENV;',
        filename: battleFile('meta.ts'),
        options: [ENGINE_OPTIONS],
        errors: [{ messageId: 'deniedGlobal' }],
      },
    ],
  });

  // RuleTester melempar saat ada kasus gagal; mencapai baris ini berarti semua lulus.
  assert.ok(true);
});
