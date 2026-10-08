/**
 * Integration test kontrak error route anonim — klasifikasi & non-kebocoran.
 *
 * Dua hal yang dikunci di sini:
 *  1. Gangguan database (konektivitas/TLS) dijawab **503 `UNAVAILABLE`**, bukan
 *     500 `INTERNAL`. 500 berarti "bug kami", dan itu menyesatkan klien,
 *     dashboard, sekaligus alerting.
 *  2. Pesan driver **tidak pernah** diteruskan ke pemanggil anonim. Sebelum
 *     perubahan ini, `/api/search` mengembalikan pesan mentah seperti
 *     "self-signed certificate in certificate chain" apa adanya — membocorkan
 *     topologi dan keadaan infrastruktur ke siapa pun yang memanggil endpoint.
 *
 * Database tidak disentuh: klien diinjeksi lewat `setSqlClient` dan selalu
 * melempar, sehingga test ini berjalan tanpa Postgres.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  DatabaseNotConfiguredError,
  isDatabaseUnavailable,
  setSqlClient,
} from '../../src/lib/db/client.ts';
import type { SqlClient } from '../../src/lib/db/client.ts';
import type { NextRequest } from 'next/server';

const { GET: searchGet } = await import('../../app/api/search/route.ts');
const { GET: readyGet } = await import('../../app/api/health/ready/route.ts');

/**
 * Search handler membaca `request.nextUrl.searchParams` (properti NextRequest),
 * jadi test cukup menyediakan bagian itu — bukan NextRequest sungguhan, dan
 * bukan `Request` polos yang tidak punya `nextUrl`.
 */
function searchRequest(query: string): NextRequest {
  return { nextUrl: new URL(`http://localhost/api/search?q=${encodeURIComponent(query)}`) } as unknown as NextRequest;
}

function failingClient(error: unknown): SqlClient {
  return {
    query: async () => {
      throw error;
    },
  };
}

/** Error konektivitas seperti yang dilempar driver saat host tidak menjawab. */
function connectivityError(): Error {
  return Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:6543'), { code: 'ECONNREFUSED' });
}

describe('isDatabaseUnavailable', () => {
  it('mengenali konfigurasi hilang, kode konektivitas, SQLSTATE kelas 08, dan TLS', () => {
    assert.equal(isDatabaseUnavailable(new DatabaseNotConfiguredError('DATABASE_URL', 'hint')), true);
    assert.equal(isDatabaseUnavailable(connectivityError()), true);
    assert.equal(isDatabaseUnavailable(Object.assign(new Error('x'), { code: '08006' })), true);
    assert.equal(
      isDatabaseUnavailable(new Error('self-signed certificate in certificate chain')),
      true,
    );
  });

  it('tidak menuduh bug kode sebagai gangguan database', () => {
    assert.equal(isDatabaseUnavailable(new Error('relation "characters" does not exist')), false);
    assert.equal(isDatabaseUnavailable(Object.assign(new Error('syntax error'), { code: '42601' })), false);
    assert.equal(isDatabaseUnavailable(undefined), false);
  });
});

describe('kontrak error route anonim', () => {
  const originalError = console.error;

  beforeEach(() => {
    // Detail error memang di-log di server; test menyenyapkan agar keluaran
    // suite tetap terbaca (yang diuji adalah apa yang **dikirim ke klien**).
    console.error = () => {};
  });

  afterEach(() => {
    console.error = originalError;
    setSqlClient(null);
    delete process.env.DATABASE_URL;
  });

  it('search: gangguan konektivitas → 503 UNAVAILABLE, pesan generik', async () => {
    setSqlClient(failingClient(connectivityError()));
    const response = await searchGet(searchRequest('goku'));
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'UNAVAILABLE');
    assert.doesNotMatch(body.error.message, /ECONNREFUSED|10\.0\.0\.5|6543/);
  });

  it('search: bug tak terduga → 500 INTERNAL, tanpa detail query', async () => {
    setSqlClient(failingClient(new Error('relation "characters" does not exist')));
    const response = await searchGet(searchRequest('goku'));
    assert.equal(response.status, 500);
    const body = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'INTERNAL');
    assert.doesNotMatch(body.error.message, /relation|characters/);
  });

  it('search: database belum dikonfigurasi → 503 UNAVAILABLE dengan petunjuk operasional', async () => {
    setSqlClient(null);
    delete process.env.DATABASE_URL;
    const response = await searchGet(searchRequest('goku'));
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'UNAVAILABLE');
    assert.match(body.error.message, /Database belum dikonfigurasi/);
  });

  // `/api/health/ready` sengaja memakai dokumen status (`status`/`database`),
  // bukan envelope `{ error: { code } }`: probe infrastruktur membaca kedua
  // field itu (APPENDICES G baris 44). Kontrak bentuknya karena itu berbeda,
  // tetapi aturan non-kebocoran tetap sama — pesan driver hanya untuk log.
  it('health/ready: gangguan konektivitas → 503 tanpa pesan driver', async () => {
    setSqlClient(
      failingClient(Object.assign(new Error('self-signed certificate in certificate chain'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' })),
    );
    const response = await readyGet();
    assert.equal(response.status, 503);
    const body = (await response.json()) as { status: string; database: string; error: string };
    assert.equal(body.status, 'unhealthy');
    assert.equal(body.database, 'connection_failed');
    assert.doesNotMatch(JSON.stringify(body), /self-signed|certificate chain|SELF_SIGNED/);
  });

  it('health/ready: setiap respons tidak dapat di-cache (no-store)', async () => {
    setSqlClient(failingClient(connectivityError()));
    const failed = await readyGet();
    assert.equal(failed.headers.get('cache-control'), 'no-store');

    setSqlClient({ query: async () => [{ ok: 1 }] });
    const ok = await readyGet();
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
  });

  it('health/ready: database belum dikonfigurasi → 503 not_configured dengan nama env', async () => {
    setSqlClient(null);
    delete process.env.DATABASE_URL;
    const response = await readyGet();
    assert.equal(response.status, 503);
    const body = (await response.json()) as { status: string; database: string; hint: string };
    assert.equal(body.status, 'not_configured');
    assert.match(body.database, /DATABASE_URL/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});
