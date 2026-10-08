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
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const ENV_KEY = 'CRON_SECRET';

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
});
