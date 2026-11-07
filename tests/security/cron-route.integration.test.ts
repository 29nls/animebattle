/**
 * Integration test rute cron — membuktikan kontrak fail-closed pada level handler.
 *
 * Endpoint `GET /api/cron/sync` adalah satu-satunya jalur request yang sah
 * mengerjakan antrian ingestion (zona `scheduled-worker`, PRD §39), sehingga
 * kegagalan otentikasinya berakibat langsung: antrian dapat dikerjakan oleh
 * pihak lain, atau berhenti tanpa terlihat. Karena itu kontraknya diuji di sini,
 * bukan hanya diuji manual lewat `curl`.
 *
 * Yang dibuktikan, dengan `Request` nyata dan TANPA database:
 *  1. Tanpa `CRON_SECRET` → 503 untuk SEMUA penelepon (fail-closed).
 *  2. Kredensial salah/absen → 401, termasuk perbandingan timing-safe terhadap
 *     secret dengan panjang berbeda (sha256 menyamakan panjang sebelum
 *     `timingSafeEqual`, sehingga tidak melempar).
 *  3. `DATABASE_URL` hilang → 503 JSON, bukan 500 ber-body kosong.
 *  4. Database tidak dapat dihubungi → 503 JSON dengan pesan yang tidak
 *     membocorkan host/port driver.
 *
 * Butir 3–4 adalah regresi insiden nyata: run 42089541289 membalas `HTTP 500`
 * dengan body 0 byte, sehingga penjadwal tidak dapat membedakan "database mati"
 * dari "proses crash".
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { setSqlClient } from '../../src/lib/db/client.ts';

const ENV_KEY = 'CRON_SECRET';
const SECRET = 'rahasia-cron-uji';

const { GET: cronGet } = await import('../../app/api/cron/sync/route.ts');

function cronRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/cron/sync', { headers });
}

describe('integration — GET /api/cron/sync', () => {
  beforeEach(() => {
    delete process.env[ENV_KEY];
    delete process.env.DATABASE_URL;
  });
  afterEach(() => {
    delete process.env[ENV_KEY];
    delete process.env.DATABASE_URL;
    setSqlClient(null);
  });

  it('503 fail-closed tanpa CRON_SECRET — sebelum menyentuh DB', async () => {
    const response = await cronGet(cronRequest());
    assert.equal(response.status, 503);
    const data = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(data.error.code, 'UNAVAILABLE');
    assert.match(data.error.message, /CRON_SECRET belum dikonfigurasi/);
  });

  it('401 dengan secret salah (panjang berbeda — jalur timing-safe)', async () => {
    process.env[ENV_KEY] = 'rahasia-cron-yang-panjang';
    const response = await cronGet(cronRequest({ authorization: 'Bearer pendek' }));
    assert.equal(response.status, 401);
    const data = (await response.json()) as { error: { code: string } };
    assert.equal(data.error.code, 'UNAUTHORIZED');
  });

  it('401 tanpa header dan dengan skema selain Bearer', async () => {
    process.env[ENV_KEY] = 'rahasia-cron';
    const noHeader = await cronGet(cronRequest());
    assert.equal(noHeader.status, 401);
    const basic = await cronGet(cronRequest({ authorization: 'Basic rahasia-cron' }));
    assert.equal(basic.status, 401);
  });

  it('503 JSON bila DATABASE_URL hilang — bukan 500 ber-body kosong', async () => {
    process.env[ENV_KEY] = SECRET;
    // Klien tidak disuntikkan dan DATABASE_URL sudah dihapus di beforeEach,
    // sehingga `getSqlClient()` melempar DatabaseNotConfiguredError.
    const response = await cronGet(cronRequest({ authorization: `Bearer ${SECRET}` }));
    assert.equal(response.status, 503);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    const data = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(data.error.code, 'UNAVAILABLE');
    assert.match(data.error.message, /DATABASE_URL/);
  });

  it('503 JSON bila database tidak dapat dihubungi, tanpa membocorkan detail driver', async () => {
    process.env[ENV_KEY] = SECRET;
    // Meniru postgres.js saat host menolak koneksi: `code` konektivitas Node.
    const refused = Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:5432'), {
      code: 'ECONNREFUSED',
    });
    setSqlClient({
      query: async () => {
        throw refused;
      },
    });

    const response = await cronGet(cronRequest({ authorization: `Bearer ${SECRET}` }));
    assert.equal(response.status, 503);
    const raw = await response.text();
    assert.doesNotMatch(raw, /ECONNREFUSED|10\.1\.2\.3|5432/);
    const data = JSON.parse(raw) as { error: { code: string; message: string } };
    assert.equal(data.error.code, 'UNAVAILABLE');
    assert.match(data.error.message, /Database tidak dapat dihubungi/);
  });
});
