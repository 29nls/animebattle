/**
 * Guard regresi untuk konfigurasi Lighthouse CI (AC-21, AC-22, AC-23 / PRD §29.1, §35.2).
 *
 * Kontrak yang dijaga:
 *   - kelima assertion tetap `error` (tidak diturunkan diam-diam ke `warn`);
 *   - agregasi `optimistic` dipatok eksplisit (best-of-3; pilihan sadar untuk
 *     varians run — lihat PRD §35.2; pengetatan ke `median` adalah follow-up);
 *   - anggaran script tetap 150.000 B — hasil kalibrasi AC-23 (D22) yang
 *     menggantikan target 120 KB yang mustahil dicapai (PRD §35.2);
 *   - pengukuran tetap pada profil mobile default Lighthouse
 *     (tanpa `settings.preset: "desktop"` yang menonaktifkan emulasi §29.1);
 *   - audit tetap mencakup lima URL template pada port tetap.
 *
 * Jalankan: npm run test:lighthouse-config
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = JSON.parse(
  readFileSync(new URL('../../.lighthouserc.json', import.meta.url), 'utf8'),
);

const ERROR_ASSERTIONS = [
  'categories:performance',
  'categories:seo',
  'categories:accessibility',
  'categories:best-practices',
  'resource-summary:script:size',
];

test('AC-21/22/23 ditegakkan sebagai error, bukan warn', () => {
  for (const key of ERROR_ASSERTIONS) {
    assert.equal(config.ci.assert.assertions[key]?.[0], 'error', `${key} harus berstatus error`);
    assert.equal(
      config.ci.assert.assertions[key]?.[1]?.aggregationMethod,
      'optimistic',
      `${key} harus memakai agregasi optimistic eksplisit`,
    );
  }
});

test('anggaran script adalah 150.000 B hasil kalibrasi AC-23 (PRD §35.2)', () => {
  assert.equal(
    config.ci.assert.assertions['resource-summary:script:size'][1].maxNumericValue,
    150000,
  );
});

test('pengukuran memakai profil mobile default Lighthouse', () => {
  assert.equal(
    config.ci.collect.settings?.preset,
    undefined,
    'preset desktop menonaktifkan emulasi mobile yang ditargetkan §29.1',
  );
});

test('audit mencakup lima URL template di port tetap 3000', () => {
  const { url, startServerCommand } = config.ci.collect;
  assert.equal(url.length, 5);
  assert.ok(
    url.every((u) => u.startsWith('http://localhost:3000/')),
    'semua URL audit harus loopback pada port 3000',
  );
  assert.ok(startServerCommand.includes('-p 3000'), 'startServerCommand harus mengikat port 3000');
});
