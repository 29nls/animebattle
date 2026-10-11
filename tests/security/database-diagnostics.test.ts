/**
 * Penjaga klasifikasi & sanitasi kegagalan database.
 *
 * Kenapa: `GET /api/health/ready` adalah probe anonim, dan satu-satunya cara
 * insiden 2026-10-10 (`SELF_SIGNED_CERT_IN_CHAIN`) dapat dipastikan adalah
 * mereproduksi koneksi dari mesin operator — karena endpoint itu hanya
 * menjawab `connection_failed`. Test ini mengunci tiga hal yang membuat
 * perbaikan itu bernilai **dan** tetap aman:
 *
 *  1. kategori dikenali dari `code` lebih dulu, bukan dari tebakan atas pesan;
 *  2. sesuatu yang benar-benar tidak dikenal menjadi `unclassified`, bukan
 *     dipaksa masuk kategori terdekat (kategori salah lebih berbahaya daripada
 *     tidak ada kategori);
 *  3. tidak ada jalur yang dapat membawa password/token/connection string utuh
 *     ke log server maupun ke respons probe.
 *
 * Jalankan: npm run test:security
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { DatabaseNotConfiguredError, setSqlClient } from '../../src/lib/db/client.ts';
import type { SqlClient } from '../../src/lib/db/client.ts';
import {
  classifyDatabaseError,
  redactSecrets,
  summarizeDatabaseFailure,
} from '../../src/lib/db/diagnostics.ts';

/** Connection string uji — bukan kredensial nyata, tetapi berbentuk seperti aslinya. */
const FAKE_URL = 'postgresql://postgres:rahasia-super-panjang@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres';

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('classifyDatabaseError', () => {
  it('mengenali kegagalan TLS, termasuk yang hanya berupa pesan', () => {
    assert.equal(
      classifyDatabaseError(withCode('self-signed certificate in certificate chain', 'SELF_SIGNED_CERT_IN_CHAIN')),
      'tls_untrusted',
    );
    // Node pada sebagian versi melaporkan kegagalan TLS tanpa `code`.
    assert.equal(classifyDatabaseError(new Error('self-signed certificate in certificate chain')), 'tls_untrusted');
    assert.equal(classifyDatabaseError(withCode('x', 'CERT_HAS_EXPIRED')), 'tls_expired');
    assert.equal(classifyDatabaseError(withCode('x', 'ERR_TLS_CERT_ALTNAME_INVALID')), 'tls_hostname_mismatch');
  });

  it('mengenali masalah jaringan dengan kategori yang tepat', () => {
    assert.equal(classifyDatabaseError(withCode('getaddrinfo ENOTFOUND host', 'ENOTFOUND')), 'dns');
    assert.equal(classifyDatabaseError(withCode('connect ECONNREFUSED 10.0.0.5:6543', 'ECONNREFUSED')), 'refused');
    assert.equal(classifyDatabaseError(withCode('read ECONNRESET', 'ECONNRESET')), 'reset');
    assert.equal(classifyDatabaseError(withCode('connect ETIMEDOUT 1.2.3.4:5432', 'ETIMEDOUT')), 'timeout');
    assert.equal(classifyDatabaseError(withCode('connect ENETUNREACH', 'ENETUNREACH')), 'unreachable');
  });

  it('mengenali SQLSTATE: kredensial, skema, batas koneksi, kelas 08', () => {
    assert.equal(classifyDatabaseError(withCode('password authentication failed for user "postgres"', '28P01')), 'auth');
    assert.equal(classifyDatabaseError(withCode('database "app" does not exist', '3D000')), 'database_missing');
    assert.equal(classifyDatabaseError(withCode('relation "characters" does not exist', '42P01')), 'schema_missing');
    assert.equal(classifyDatabaseError(withCode('too many clients already', '53300')), 'connection_limit');
    assert.equal(classifyDatabaseError(withCode('the database system is starting up', '57P03')), 'server_unavailable');
    assert.equal(classifyDatabaseError(withCode('unexpected EOF on client connection', '08006')), 'connection_lost');
  });

  it('membedakan konfigurasi hilang dari kegagalan koneksi', () => {
    assert.equal(classifyDatabaseError(new DatabaseNotConfiguredError('DATABASE_URL', 'hint')), 'not_configured');
  });

  it('`code` menang atas pesan yang menyesatkan', () => {
    // Pesan menyebut "certificate", tetapi kodenya jelas penolakan kredensial:
    // kategori harus mengikuti kode, bukan kata yang kebetulan muncul.
    assert.equal(classifyDatabaseError(withCode('certificate rejected: authentication failed', '28P01')), 'auth');
  });

  it('tidak menebak untuk error yang tidak dikenal', () => {
    assert.equal(classifyDatabaseError(new Error('sesuatu yang belum pernah kami lihat')), 'unclassified');
    assert.equal(classifyDatabaseError(undefined), 'unclassified');
    // "does not exist" tanpa SQLSTATE tidak cukup untuk menuduh skema hilang.
    assert.equal(classifyDatabaseError(new Error('column "notes" does not exist')), 'unclassified');
  });
});

describe('redactSecrets', () => {
  it('menghapus kredensial berbentuk URL apa pun', () => {
    const text = `gagal connect ke ${FAKE_URL} (timeout)`;
    const cleaned = redactSecrets(text, {});
    assert.doesNotMatch(cleaned, /rahasia-super-panjang/);
    assert.doesNotMatch(cleaned, /postgres:rahasia/);
    assert.match(cleaned, /postgresql:\/\/\*\*\*/);
    assert.match(cleaned, /timeout/);
  });

  it('menghapus nilai variabel rahasia yang dikutip tanpa bentuk URL', () => {
    const cleaned = redactSecrets('Bearer abcdefghijklmnop tidak diterima', { CRON_SECRET: 'abcdefghijklmnop' });
    assert.equal(cleaned, 'Bearer *** tidak diterima');
  });

  it('menghapus PEM satu-baris dengan escape literal', () => {
    const pem = '-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----';
    const cleaned = redactSecrets(`CA cacat: ${pem}`, { DATABASE_CA_CERT: pem });
    assert.doesNotMatch(cleaned, /BEGIN CERTIFICATE/);
  });

  it('tidak merusak teks biasa, tetapi selalu menyensor secret yang disetel', () => {
    const message = 'password authentication failed for user "postgres"';
    assert.equal(redactSecrets(message, {}), message);
    // DATABASE_URL sebagai literal tidak menyensor kata umum di pesan driver —
    // pesan itu tidak memuat kredensial, dan operator perlu membacanya utuh.
    assert.equal(redactSecrets(message, { DATABASE_URL: FAKE_URL }), message);
    assert.equal(redactSecrets('tidak ada rahasia di sini', {}), 'tidak ada rahasia di sini');
    // Token yang pendek pun disensor: panjang bukan alasan membocorkan bearer.
    assert.equal(redactSecrets('kunci abc123 ditolak', { CRON_SECRET: 'abc123' }), 'kunci *** ditolak');
  });
});

describe('summarizeDatabaseFailure', () => {
  it('tidak pernah membawa kredensial, hanya host:port', () => {
    const env = { DATABASE_URL: FAKE_URL, CRON_SECRET: 'secret-cron-yang-panjang' };
    const summary = summarizeDatabaseFailure(
      withCode(`connect ECONNREFUSED ke ${FAKE_URL}`, 'ECONNREFUSED'),
      env,
    );
    const serialized = JSON.stringify(summary);
    assert.doesNotMatch(serialized, /rahasia-super-panjang/);
    assert.doesNotMatch(serialized, /secret-cron-yang-panjang/);
    // URL boleh disebut sebagai skema, tetapi tidak pernah dengan isinya:
    // setelah skema harus langsung `***`, bukan host/kredensial.
    assert.doesNotMatch(serialized, /postgresql:\/\/(?!\*\*\*)/);
    assert.equal(serialized.includes(FAKE_URL), false, 'connection string utuh tidak boleh ikut');
    assert.equal(summary.category, 'refused');
    assert.equal(summary.target, 'aws-0-ap-northeast-2.pooler.supabase.com:6543');
    assert.equal(summary.code, 'ECONNREFUSED');
    assert.ok(summary.message.length <= 400, 'pesan dibatasi agar log tetap terbaca');
  });

  it('mempertahankan errno/syscall untuk triase lanjutan', () => {
    const error = Object.assign(new Error('connect ETIMEDOUT'), {
      code: 'ETIMEDOUT',
      errno: -4039,
      syscall: 'connect',
    });
    const summary = summarizeDatabaseFailure(error, {});
    assert.equal(summary.errno, -4039);
    assert.equal(summary.syscall, 'connect');
    assert.equal(summary.name, 'Error');
  });
});

describe('health/ready menerbitkan kategori, bukan pesan driver', () => {
  const originalError = console.error;

  beforeEach(() => {
    console.error = () => {};
  });

  afterEach(() => {
    console.error = originalError;
    setSqlClient(null);
    delete process.env.DATABASE_URL;
  });

  it('kegagalan TLS → 503 dengan reason tls_untrusted dan tanpa kredensial', async () => {
    const { GET: readyGet } = await import('../../app/api/health/ready/route.ts');
    process.env.DATABASE_URL = FAKE_URL;
    const client: SqlClient = {
      query: async () => {
        throw withCode(`self-signed certificate in certificate chain (${FAKE_URL})`, 'SELF_SIGNED_CERT_IN_CHAIN');
      },
    };
    setSqlClient(client);

    const response = await readyGet();
    assert.equal(response.status, 503);
    const body = (await response.json()) as { status: string; database: string; reason: string };
    assert.equal(body.status, 'unhealthy');
    assert.equal(body.database, 'connection_failed');
    assert.equal(body.reason, 'tls_untrusted');

    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /self-signed|certificate chain|SELF_SIGNED/);
    assert.doesNotMatch(serialized, /rahasia-super-panjang/);
    assert.doesNotMatch(serialized, /pooler\.supabase\.com/);
  });

  it('kategori tetap terbit untuk penyebab non-TLS (mis. batas koneksi)', async () => {
    const { GET: readyGet } = await import('../../app/api/health/ready/route.ts');
    setSqlClient({
      query: async () => {
        throw withCode('too many clients already', '53300');
      },
    });

    const response = await readyGet();
    const body = (await response.json()) as { reason: string };
    assert.equal(response.status, 503);
    assert.equal(body.reason, 'connection_limit');
  });
});
