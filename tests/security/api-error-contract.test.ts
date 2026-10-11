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
const { GET: suggestGet } = await import('../../app/api/search/suggest/route.ts');
const { GET: readyGet } = await import('../../app/api/health/ready/route.ts');

/**
 * Search handler membaca `request.nextUrl.searchParams` (properti NextRequest),
 * jadi test cukup menyediakan bagian itu — bukan NextRequest sungguhan, dan
 * bukan `Request` polos yang tidak punya `nextUrl`.
 */
function searchRequest(query: string): NextRequest {
  return { nextUrl: new URL(`http://localhost/api/search?q=${encodeURIComponent(query)}`) } as unknown as NextRequest;
}

/** Permintaan dengan query string apa adanya — dipakai menguji penolakan parameter. */
function searchRequestRaw(queryString: string): NextRequest {
  return { nextUrl: new URL(`http://localhost/api/search?${queryString}`) } as unknown as NextRequest;
}

function suggestRequest(queryString: string): NextRequest {
  return { nextUrl: new URL(`http://localhost/api/search/suggest?${queryString}`) } as unknown as NextRequest;
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

  // Bentuk respons daftar kini beramplop (`{ data, page, per_page, total, has_more }`)
  // dan `total` dihitung database, bukan dari panjang halaman — sehingga
  // `has_more` benar pada halaman yang kebetulan kosong.
  it('search: halaman hasil memakai amplop daftar dengan total dari database', async () => {
    setSqlClient({
      query: async () => [
        {
          payload: {
            total: 42,
            rows: [
              {
                id: '00000000-0000-0000-0000-0000000000a1',
                slug: 'genos',
                name: 'Genos',
                native_name: null,
                verse_slug: 'one-punch-man',
                verse_name: 'One-Punch Man',
                tier_code: '7-A',
                data_completeness: 'partial',
                popularity_score: 10,
                score: 0.95,
              },
            ],
          },
        },
      ],
    });
    const response = await searchGet(searchRequestRaw('q=genos&per_page=20&page=2'));
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      data: Array<{ slug: string }>;
      page: number;
      per_page: number;
      total: number;
      has_more: boolean;
    };
    assert.equal(body.data[0]?.slug, 'genos');
    assert.equal(body.page, 2);
    assert.equal(body.per_page, 20);
    assert.equal(body.total, 42);
    assert.equal(body.has_more, true, '2 × 20 < 42');
  });

  it('search: parameter di luar kontrak ditolak 400 sebelum database disentuh', async () => {
    // Klien yang mengirim parameter tak sah tidak boleh menyentuh database:
    // klien di sini akan melempar bila dipanggil, jadi 400 membuktikan urutannya.
    setSqlClient({
      query: async () => {
        throw new Error('database tidak boleh disentuh untuk permintaan tak sah');
      },
    });

    for (const [queryString, pattern] of [
      ['q=goku&types=character,verse', /hanya mencari karakter/],
      ['q=goku&sort=name', /tidak dikenal: sort/],
      ['q=goku&per_page=37', /20, 50, 100, 200/],
      ['q=goku&page=0', /page harus bilangan bulat/],
    ] as const) {
      const response = await searchGet(searchRequestRaw(queryString));
      assert.equal(response.status, 400, `${queryString} harus 400`);
      const body = (await response.json()) as { error: { code: string; message: string } };
      assert.equal(body.error.code, 'INVALID_INPUT');
      assert.match(body.error.message, pattern);
    }
  });

  it('search: kueri kosong menjawab amplop kosong, bukan seluruh katalog', async () => {
    setSqlClient({
      query: async () => {
        throw new Error('kueri kosong tidak perlu menyentuh database');
      },
    });
    const response = await searchGet(searchRequestRaw('q='));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data: unknown[]; total: number; has_more: boolean };
    assert.deepEqual(body.data, []);
    assert.equal(body.total, 0);
    assert.equal(body.has_more, false);
  });

  it('search/suggest: kueri wajib, parameter lain ditolak', async () => {
    const missing = await suggestGet(suggestRequest('q='));
    assert.equal(missing.status, 400);
    const missingBody = (await missing.json()) as { error: { code: string; message: string } };
    assert.equal(missingBody.error.code, 'INVALID_INPUT');
    assert.match(missingBody.error.message, /q wajib diisi/);

    const extra = await suggestGet(suggestRequest('q=sa&page=2'));
    assert.equal(extra.status, 400);
    const extraBody = (await extra.json()) as { error: { message: string } };
    assert.match(extraBody.error.message, /tidak dikenal: page/);
  });

  it('search/suggest: gangguan database → 503 tanpa pesan driver', async () => {
    setSqlClient(failingClient(connectivityError()));
    const response = await suggestGet(suggestRequest('q=sa'));
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'UNAVAILABLE');
    assert.doesNotMatch(body.error.message, /ECONNREFUSED|10\.0\.0\.5|6543/);
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
    const body = (await response.json()) as {
      status: string;
      database: string;
      reason: string;
      error: string;
    };
    assert.equal(body.status, 'unhealthy');
    assert.equal(body.database, 'connection_failed');
    // Kategori diterbitkan supaya insiden dapat ditriase tanpa mereproduksi
    // koneksi dari mesin operator — tetapi tetap tanpa satu kata pun dari driver.
    assert.equal(body.reason, 'tls_untrusted');
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
