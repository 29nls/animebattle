/**
 * Penjaga regresi untuk jalur pemuatan data di halaman server.
 *
 * Kenapa test ini ada: `npx lhci autorun` pernah gagal di `/verses` dengan
 * `ERRORED_DOCUMENT_REQUEST (Status code: 500)` — `DatabaseNotConfiguredError`
 * dari modul `queries.ts` fitur lolos ke runtime Next karena halaman
 * tidak menangkapnya. Halaman sendiri tidak dapat diuji di sini (berkasnya JSX
 * dan Node 24 menolak impor `.tsx`), jadi yang dikunci adalah mekanismenya:
 * `attemptLoad` harus mengubah galat menjadi hasil `failed` dengan pesan yang
 * dapat ditindaklanjuti, dan setiap halaman yang memuat data wajib melewatinya.
 *
 * Jalankan: npm run test:web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { attemptLoad, describeLoadFailure } from '../../src/features/data-source.ts';
import { loadCharacterList } from '../../src/features/characters/queries.ts';
import { DatabaseNotConfiguredError } from '../../src/lib/db/client.ts';

/** Halaman yang memanggil pemilih data dan karenanya dapat menjawab 500. */
const DATA_PAGES = [
  'app/characters/page.tsx',
  'app/character/[slug]/page.tsx',
  'app/verses/page.tsx',
  'app/verse/[slug]/page.tsx',
];

test('attemptLoad meneruskan keberhasilan apa adanya', async () => {
  const result = await attemptLoad(async () => ({ rows: [1, 2, 3], source: 'database' as const }));
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') throw new Error('tidak mungkin');
  assert.deepEqual(result.data.rows, [1, 2, 3]);
});

test('attemptLoad menyerap galat database menjadi hasil failed, tidak melempar', async () => {
  const result = await attemptLoad(async (): Promise<never> => {
    throw new DatabaseNotConfiguredError('DATABASE_URL', 'Isi DATABASE_URL pada .env.local');
  });

  assert.equal(result.status, 'failed', 'galat tidak boleh keluar dari attemptLoad');
  if (result.status !== 'failed') throw new Error('tidak mungkin');
  assert.match(result.message, /Database belum dikonfigurasi/);
  assert.match(result.message, /DATABASE_URL/);
});

test('describeLoadFailure menandai galat non-konfigurasi agar tetap terlihat', () => {
  assert.equal(
    describeLoadFailure(new Error('relation "verses" does not exist')),
    'Gagal memuat data: relation "verses" does not exist',
  );
  assert.equal(describeLoadFailure('bukan Error'), 'Gagal memuat data: bukan Error');
});

test('pemilih data yang menolak tetap menjadi halaman yang merender, bukan 500', async () => {
  const previousDemo = process.env.ALLOW_DEMO_DATA;
  const previousDatabase = process.env.DATABASE_URL;
  delete process.env.ALLOW_DEMO_DATA;
  delete process.env.DATABASE_URL;
  try {
    // Kontrak pemilih: database belum dikonfigurasi → menolak (bukan diam-diam
    // memakai data demo). Yang dijaga di sini adalah lapisan di atasnya.
    await assert.rejects(loadCharacterList(), (error) => error instanceof DatabaseNotConfiguredError);

    const outcome = await attemptLoad(() => loadCharacterList());
    assert.equal(outcome.status, 'failed');
    if (outcome.status !== 'failed') throw new Error('tidak mungkin');
    assert.match(outcome.message, /DATABASE_URL/);
  } finally {
    if (previousDemo === undefined) delete process.env.ALLOW_DEMO_DATA;
    else process.env.ALLOW_DEMO_DATA = previousDemo;
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
  }
});

test('setiap halaman pemuat data melewati attemptLoad dan menampilkan panel, bukan 500', () => {
  for (const page of DATA_PAGES) {
    const source = readFileSync(new URL(`../../${page}`, import.meta.url), 'utf8');
    assert.match(source, /attemptLoad\(/, `${page}: pemuatan data harus lewat attemptLoad`);
    assert.match(
      source,
      /DatabaseUnavailable/,
      `${page}: kegagalan database harus dirender sebagai panel, bukan dibiarkan menjadi 500`,
    );
    assert.doesNotMatch(
      source,
      /catch \(error\) \{\s*failure\s*=/,
      `${page}: pemetaan pesan galat dilakukan satu kali di features/data-source.ts`,
    );
  }
});
