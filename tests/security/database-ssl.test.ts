/**
 * Penjaga konfigurasi TLS database.
 *
 * Kenapa: produksi menjawab `Gagal memuat data: self-signed certificate in
 * certificate chain`. Penyebabnya Supabase memakai CA privat, `sslmode=verify-full`
 * memverifikasi terhadap CA bawaan Node, dan `sslrootcert` di URL **tidak dibaca
 * postgres.js** — sehingga menyediakan CA harus lewat opsi driver. Test ini
 * mengunci dua hal sekaligus: CA benar-benar diteruskan sebagai `ssl.ca`, dan
 * fungsi ini tidak pernah melonggarkan verifikasi (tidak ada `rejectUnauthorized`
 * yang datang dari kode kita).
 *
 * Jalankan: npm run test:security
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { databaseSslOptions } from '../../src/lib/db/client.ts';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';

test('tanpa CA, opsi TLS tidak disentuh (sslmode di URL yang menentukan)', () => {
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

test('sslrootcert yang tidak ada diabaikan tanpa melempar (tidak menyesatkan)', () => {
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
