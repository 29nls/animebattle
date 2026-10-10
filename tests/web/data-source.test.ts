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

import {
  GENERIC_UNAVAILABLE_MESSAGE,
  attemptLoad,
  describeLoadFailure,
  visibleFailureMessage,
} from '../../src/features/data-source.ts';
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

test('dua kegagalan yang tindakannya jelas mendapat saran, sisanya tidak ditebak', () => {
  // Produksi pernah berhenti di sini: CA privat Supabase vs sslmode=verify-full.
  const tls = describeLoadFailure(
    Object.assign(new Error('self-signed certificate in certificate chain'), {
      code: 'SELF_SIGNED_CERT_IN_CHAIN',
    }),
  );
  assert.match(tls, /^Gagal memuat data: self-signed certificate/);
  assert.match(tls, /DATABASE_CA_CERT/);
  assert.match(tls, /host Supabase/, 'saran menyebut CA Supabase yang sudah menjadi bawaan');
  assert.doesNotMatch(tls, /sslmode=require/, 'sslmode=require bukan saran: itu mematikan verifikasi');

  // Database terjangkau, tetapi skema belum diterapkan di sana (kode SQLSTATE 42P01).
  const noSchema = describeLoadFailure(
    Object.assign(new Error('relation "characters" does not exist'), { code: '42P01' }),
  );
  assert.match(noSchema, /^Gagal memuat data: relation "characters" does not exist/);
  assert.match(noSchema, /schema\.sql/);

  // Tanpa kode/pesan yang dikenali: pesan mentah, tanpa tebakan.
  const unknown = describeLoadFailure(new Error('connection terminated unexpectedly'));
  assert.equal(unknown, 'Gagal memuat data: connection terminated unexpectedly');
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

test('pengunjung anonim tidak menerima detail infrastruktur', () => {
  const detail = describeLoadFailure(
    Object.assign(new Error('self-signed certificate in certificate chain'), {
      code: 'SELF_SIGNED_CERT_IN_CHAIN',
    }),
  );
  const anonymous = visibleFailureMessage(detail, false);

  assert.equal(anonymous, GENERIC_UNAVAILABLE_MESSAGE);
  for (const bocor of ['DATABASE_URL', 'DATABASE_CA_CERT', 'sslmode', 'schema.sql', 'characters', 'self-signed']) {
    assert.doesNotMatch(anonymous, new RegExp(bocor), `pesan anonim membocorkan: ${bocor}`);
  }
  assert.equal(visibleFailureMessage(detail, true), detail, 'operator tetap menerima detail lengkap');
});

test('blok instruksi operator di panel tidak dirender untuk pengunjung anonim', () => {
  const source = readFileSync(
    new URL('../../src/components/database-unavailable.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /viewerIsOperator &&/, 'instruksi env (DATABASE_URL/ALLOW_DEMO_DATA) harus digerbangi viewerIsOperator');
  assert.match(
    source,
    /visibleFailureMessage\(detail, viewerIsOperator\)/,
    'teks panel harus dipilih lewat visibleFailureMessage',
  );
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
    assert.match(
      source,
      /viewerIsOperator=\{await isAdminAuthenticated\(\)\}/,
      `${page}: panel harus tahu apakah penontonnya operator (detail infrastruktur bukan untuk pengunjung anonim)`,
    );
    assert.match(source, /detail=\{/, `${page}: detail teknis diteruskan sebagai prop, bukan dirender langsung`);
    assert.doesNotMatch(
      source,
      /catch \(error\) \{\s*failure\s*=/,
      `${page}: pemetaan pesan galat dilakukan satu kali di features/data-source.ts`,
    );
  }
});
