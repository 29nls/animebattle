/**
 * Penjaga konfigurasi TLS database.
 *
 * Kenapa: produksi menjawab `Gagal memuat data: self-signed certificate in
 * certificate chain`. Penyebabnya Supabase memakai CA privat, `sslmode=verify-full`
 * memverifikasi terhadap CA bawaan Node, dan `sslrootcert` di URL **tidak dibaca
 * postgres.js** — sehingga menyediakan CA harus lewat opsi driver. Test ini
 * mengunci tiga hal: CA benar-benar diteruskan sebagai `ssl.ca`, fungsi ini tidak
 * pernah melonggarkan verifikasi (tidak ada `rejectUnauthorized` dari kode kita),
 * dan CA bawaan (`supabase-ca.ts`) hanya berlaku untuk host Supabase — inilah
 * yang membuat deployment Vercel bekerja tanpa variabel lingkungan.
 *
 * Jalankan: npm run test:security
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { databaseSslOptions } from '../../src/lib/db/client.ts';
import { SUPABASE_ROOT_2021_CA } from '../../src/lib/db/supabase-ca.ts';

/** Host Supabase nyata (pooler) — jalur CA bawaan hanya berlaku untuk host ini. */
const SUPABASE_URL =
  'postgres://u:p@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=verify-full';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';

test('tanpa CA pada host non-Supabase, opsi TLS tidak disentuh (sslmode di URL yang menentukan)', () => {
  assert.deepEqual(databaseSslOptions('postgres://u:p@h:5432/db', {}), {});
  assert.deepEqual(databaseSslOptions('postgres://u:p@h:5432/db?sslmode=verify-full', {}), {});
  assert.deepEqual(databaseSslOptions('postgres://u:p@h:5432/db', { DATABASE_CA_CERT: '   ' }), {});
});

test('DATABASE_CA_CERT diteruskan sebagai ssl.ca, spasi pinggir dipangkas', () => {
  const options = databaseSslOptions('postgres://u:p@h:5432/db', { DATABASE_CA_CERT: `  ${PEM}  ` });
  // Dipangkas seluruhnya (termasuk newline penutup): tls menerima PEM tanpa
  // newline terakhir, dan nilai yang persis sama membuat perbandingan mudah.
  assert.deepEqual(options, { ssl: { ca: PEM.trim() } });
});

test('DATABASE_CA_CERT satu-baris dengan `\\n` literal dibuka menjadi PEM utuh', () => {
  // Bentuk yang dihasilkan dashboard/CI yang tidak menerima newline.
  const oneLine = PEM.trim().replace(/\n/g, '\\n');
  assert.deepEqual(databaseSslOptions('postgres://u:p@h:5432/db', { DATABASE_CA_CERT: oneLine }), {
    ssl: { ca: PEM.trim() },
  });
});

test('DATABASE_CA_CERT yang dibungkus tanda kutip tetap diterima', () => {
  assert.deepEqual(
    databaseSslOptions('postgres://u:p@h:5432/db', { DATABASE_CA_CERT: `"${PEM.trim()}"` }),
    { ssl: { ca: PEM.trim() } },
  );
});

test('CA cacat (PEM terpotong) diabaikan, bukan diteruskan ke TLS', () => {
  // Bentuk nyata dari kesalahan ini: PEM multi-baris di .env tanpa tanda kutip,
  // sehingga dotenv hanya membaca baris pertama (tanpa kepala/ekor PEM).
  const truncated = 'MIIDxDCCAqygAwIBAgIUJ5p8QzZPqX0mYt3f9f4O2o1p3KcwDQYJKoZIhvcNAQEL';
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (message: string) => warnings.push(String(message));
  let options: { ssl?: { ca: string } };
  try {
    options = databaseSslOptions('postgres://u:p@h:5432/db?sslmode=verify-full', {
      DATABASE_CA_CERT: truncated,
    });
  } finally {
    console.warn = original;
  }

  assert.deepEqual(options, {}, 'PEM cacat tidak boleh dikirim sebagai ca');
  assert.equal(warnings.length, 1, 'penyebabnya harus terlihat di log server');
  assert.match(warnings[0] ?? '', /DATABASE_CA_CERT/);
});

test('CA tidak pernah melonggarkan verifikasi', () => {
  const options = databaseSslOptions('postgres://u:p@h:5432/db?sslmode=verify-full', {
    DATABASE_CA_CERT: PEM,
  });
  assert.deepEqual(Object.keys(options.ssl ?? {}), ['ca'], 'hanya `ca` yang boleh diisi kode kita');
  assert.doesNotMatch(JSON.stringify(options), /rejectUnauthorized/);
});

test('sslrootcert pada URL dibaca sebagai berkas CA (perilaku libpq)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'animebattle-ca-'));
  try {
    const file = join(dir, 'global-root.crt');
    writeFileSync(file, PEM, 'utf8');
    const url = `postgres://u:p@h:5432/db?sslmode=verify-full&sslrootcert=${encodeURIComponent(file)}`;
    assert.deepEqual(databaseSslOptions(url, {}), { ssl: { ca: PEM } });
    // Berkas dibaca apa adanya — tidak dipangkas seperti DATABASE_CA_CERT.
    assert.equal(databaseSslOptions(url, {}).ssl?.ca?.endsWith('\n'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sslrootcert yang tidak ada diabaikan tanpa melempar pada host non-Supabase', () => {
  const missing = join(tmpdir(), 'animebattle-ca-tidak-ada.crt');
  const url = `postgres://u:p@h:5432/db?sslmode=verify-full&sslrootcert=${encodeURIComponent(missing)}`;
  assert.deepEqual(databaseSslOptions(url, {}), {});
});

test('sslrootcert=system bukan berkas: diperlakukan sebagai penanda CA sistem', () => {
  assert.deepEqual(databaseSslOptions('postgres://u:p@h:5432/db?sslrootcert=system', {}), {});
});

test('DATABASE_CA_CERT menang atas sslrootcert', () => {
  const url = `postgres://u:p@h:5432/db?sslrootcert=${encodeURIComponent(join(tmpdir(), 'apa-saja.crt'))}`;
  assert.deepEqual(databaseSslOptions(url, { DATABASE_CA_CERT: PEM }), { ssl: { ca: PEM.trim() } });
});

test('URL yang tidak dapat diurai tidak melempar', () => {
  assert.deepEqual(databaseSslOptions('bukan-url', {}), {});
  assert.deepEqual(databaseSslOptions('', {}), {});
});

test('host Supabase tanpa CA eksplisit mendapat root CA bawaan (verifikasi tetap penuh)', () => {
  const ca = databaseSslOptions(SUPABASE_URL, {}).ssl?.ca;
  assert.ok(Array.isArray(ca), 'harus berupa daftar CA');
  assert.ok(ca.includes(SUPABASE_ROOT_2021_CA), 'root Supabase harus ada di daftar');
  assert.doesNotMatch(JSON.stringify({ ca }), /rejectUnauthorized/);
});

test('path sslrootcert milik mesin lain tidak mematikan host Supabase', () => {
  // Persis kasus Vercel: `DATABASE_URL` disalin dari .env lokal sehingga membawa
  // `sslrootcert=C:/Users/...` — berkas itu tidak ada di runner.
  const missing = join(tmpdir(), 'animebattle-ca-tidak-ada-di-runner.crt');
  const url = `${SUPABASE_URL}&sslrootcert=${encodeURIComponent(missing)}`;
  assert.ok(Array.isArray(databaseSslOptions(url, {}).ssl?.ca));
});

test('host non-Supabase tidak pernah diberi CA bawaan', () => {
  assert.deepEqual(databaseSslOptions('postgres://u:p@db.example.com:5432/app?sslmode=verify-full', {}), {});
});

test('sslmode longgar yang dipilih operator tidak ditimpa CA bawaan', () => {
  const url = 'postgres://u:p@db.abcdefgh.supabase.co:5432/postgres?sslmode=require';
  assert.deepEqual(databaseSslOptions(url, {}), {});
});

test('CA bawaan adalah root Supabase yang sah (self-signed, CA:true, fingerprint cocok)', () => {
  const cert = new X509Certificate(SUPABASE_ROOT_2021_CA);
  assert.equal(cert.ca, true);
  assert.match(cert.subject, /Supabase Root 2021 CA/);
  assert.equal(cert.subject, cert.issuer, 'root CA menandatangani dirinya sendiri');
  assert.equal(
    createHash('sha256').update(cert.raw).digest('hex'),
    '807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa',
    'fingerprint harus cocok dengan yang tercatat di supabase-ca.ts',
  );
});
