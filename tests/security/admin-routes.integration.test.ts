/**
 * Integration test rute admin — membuktikan kontrak keamanan pada level
 * handler Next.js, bukan hanya unit modulnya.
 *
 * Yang dibuktikan di sini, dengan Request nyata dan TANPA database (route
 * wajib menolak sebelum menyentuh DB):
 *  1. Tanpa secret terkonfigurasi → 503 untuk SEMUA penelepon (fail-closed).
 *  2. Secret salah → 401.
 *  3. Secret benar → lolos guard; pada rute ingest, rute baru menyentuh DB.
 *     DB tidak dikonfigurasi → 503 berasal dari DatabaseNotConfiguredError,
 *     yang membuktikan guard LULUS sebelum penolakan DB (urutan yang benar).
 *  4. Rate limit 429 menempel pada rute saat auth lolos.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const ENV_KEY = 'ADMIN_INGESTION_SECRET';

const { POST: runPost } = await import('../../app/api/admin/ingestion/run/route.ts');
const { POST: importPost } = await import('../../app/api/admin/ingestion/import/route.ts');
const { GET: metricsGet } = await import('../../app/api/admin/metrics/route.ts');

function jsonRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('integration — admin ingestion/run', () => {
  beforeEach(() => {
    delete process.env[ENV_KEY];
    delete process.env.DATABASE_URL;
  });
  afterEach(() => {
    delete process.env[ENV_KEY];
    delete process.env.DATABASE_URL;
  });

  it('503 fail-closed tanpa secret — tanpa menyentuh DB', async () => {
    const response = await runPost(jsonRequest('http://localhost/api/admin/ingestion/run', { scope: 'manual_run' }));
    assert.equal(response.status, 503);
    const data = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(data.error.code, 'UNAVAILABLE');
    assert.match(data.error.message, /belum dikonfigurasi/);
  });

  it('401 dengan secret salah', async () => {
    process.env[ENV_KEY] = 'benar';
    const response = await runPost(jsonRequest('http://localhost/api/admin/ingestion/run', { scope: 'manual_run' }, { authorization: 'Bearer salah' }));
    assert.equal(response.status, 401);
  });

  it('guard lolos dulu, baru DB menolak (503 dari DatabaseNotConfiguredError)', async () => {
    process.env[ENV_KEY] = 'benar';
    const response = await runPost(
      jsonRequest('http://localhost/api/admin/ingestion/run', { scope: 'manual_run' }, { authorization: 'Bearer benar' }),
    );
    assert.equal(response.status, 503);
    const data = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(data.error.code, 'UNAVAILABLE');
    // Pesan berasal dari DB client, bukan guard — artinya auth sudah lewat.
    assert.doesNotMatch(data.error.message, /belum dikonfigurasi; rute admin/);
    assert.match(data.error.message, /Database belum dikonfigurasi/);
  });

  it('429 setelah melewati batas 6 permintaan valid', async () => {
    process.env[ENV_KEY] = 'benar';
    let last: Response | undefined;
    for (let i = 0; i < 7; i += 1) {
      last = await runPost(
        jsonRequest('http://localhost/api/admin/ingestion/run', { scope: 'manual_run' }, { authorization: 'Bearer benar' }),
      );
    }
    assert.equal(last!.status, 429);
    assert.ok((last!.headers.get('retry-after') ?? '') !== '');
    const data = (await last!.json()) as {
      error: { code: string; message: string; details?: { retry_after_ms?: number } };
    };
    assert.equal(data.error.code, 'RATE_LIMITED');
    assert.ok((data.error.details?.retry_after_ms ?? 0) > 0);
  });
});

describe('integration — admin ingestion/import & admin/metrics', () => {
  beforeEach(() => {
    delete process.env[ENV_KEY];
    delete process.env.DATABASE_URL;
  });
  afterEach(() => {
    delete process.env[ENV_KEY];
    delete process.env.DATABASE_URL;
  });

  it('import: 503 fail-closed tanpa secret', async () => {
    const response = await importPost(jsonRequest('http://localhost/api/admin/ingestion/import', { scope: 'import_url' }));
    assert.equal(response.status, 503);
  });

  it('import: guard lolos → 503 berasal dari DB, bukan auth', async () => {
    process.env[ENV_KEY] = 'benar';
    const response = await importPost(
      jsonRequest('http://localhost/api/admin/ingestion/import', { scope: 'import_url' }, { authorization: 'Bearer benar' }),
    );
    assert.equal(response.status, 503);
    const data = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(data.error.code, 'UNAVAILABLE');
    assert.match(data.error.message, /Database belum dikonfigurasi/);
  });

  it('metrics: 503 tanpa secret (fail-closed), 401 dengan secret salah', async () => {
    const unauth = await metricsGet(new Request('http://localhost/api/admin/metrics'));
    assert.equal(unauth.status, 503); // fail-closed: tanpa secret, bahkan header pun tak relevan

    process.env[ENV_KEY] = 'benar';
    const wrong = await metricsGet(new Request('http://localhost/api/admin/metrics', { headers: { authorization: 'Bearer salah' } }));
    assert.equal(wrong.status, 401);
    const data = (await wrong.json()) as { error: { code: string } };
    assert.equal(data.error.code, 'UNAUTHORIZED');
  });

  it('metrics: guard lolos → 503 dari DB (urutan benar)', async () => {
    process.env[ENV_KEY] = 'benar';
    const response = await metricsGet(new Request('http://localhost/api/admin/metrics', { headers: { authorization: 'Bearer benar' } }));
    assert.equal(response.status, 503);
    const data = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(data.error.code, 'UNAVAILABLE');
    assert.match(data.error.message, /Database belum dikonfigurasi/);
  });
});
