/**
 * AC-26 pada endpoint publik: `POST /api/battle/simulate` dibatasi 30/menit/IP.
 *
 * Yang dikunci di sini adalah **perilaku route**, bukan isi fungsi SQL (yang
 * diuji terpisah di `tests/web/database-queries.test.ts`): permintaan ke-31
 * dalam jendela yang sama harus 429 dengan `RATE_LIMITED`, `retry-after`, dan
 * `details.retry_after_ms` — bentuk yang sama dengan guard admin.
 *
 * Klien database dipalsukan: `rate_limit_hit` dijawab dari penghitung di memori,
 * dan query lain sengaja gagal. Kegagalan itu tidak masalah bagi test ini —
 * yang diperiksa adalah bahwa 30 permintaan pertama **tidak** dijawab 429,
 * sedangkan yang ke-31 dijawab 429 sebelum menyentuh jalur simulasi.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { setSqlClient, type SqlClient } from '../../src/lib/db/client.ts';

const { POST: simulatePost } = await import('../../app/api/battle/simulate/route.ts');

/** Klien dengan hitungan jendela tetap di memori, meniru `rate_limit_hit`. */
function rateLimitClient(limit: number): SqlClient {
  let hits = 0;
  return {
    async query<T>(text: string): Promise<T[]> {
      if (text.includes('rate_limit_hit')) {
        hits += 1;
        const allowed = hits <= limit;
        return [
          {
            allowed,
            remaining: Math.max(limit - hits, 0),
            retry_after_ms: allowed ? 0 : 30_000,
          },
        ] as T[];
      }
      throw new Error('jalur simulasi tidak dipakai pada test kuota');
    },
  };
}

function simulateRequest(): Request {
  return new Request('http://localhost/api/battle/simulate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.55' },
    body: JSON.stringify({
      side_a_version_id: '00000000-0000-0000-0000-0000000000a1',
      side_b_version_id: '00000000-0000-0000-0000-0000000000b2',
    }),
  });
}

describe('POST /api/battle/simulate — kuota 30/menit (AC-26)', () => {
  const originalError = console.error;

  beforeEach(() => {
    // Jalur data sengaja gagal di test ini; senyapkan log-nya.
    console.error = () => {};
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    console.error = originalError;
    setSqlClient(null);
  });

  it('permintaan ke-31 dijawab 429 dengan retry-after dan details.retry_after_ms', async () => {
    setSqlClient(rateLimitClient(30));

    for (let i = 1; i <= 30; i += 1) {
      const response = await simulatePost(simulateRequest());
      assert.notEqual(response.status, 429, `permintaan ke-${i} tidak boleh dibatasi`);
    }

    const blocked = await simulatePost(simulateRequest());
    assert.equal(blocked.status, 429);

    const body = (await blocked.json()) as {
      error: { code: string; details: { retry_after_ms: number } };
    };
    assert.equal(body.error.code, 'RATE_LIMITED');
    assert.ok(body.error.details.retry_after_ms > 0);
    assert.equal(blocked.headers.get('retry-after'), '30');
  });

  it('body cacat dijawab 400 tanpa menghabiskan kuota', async () => {
    setSqlClient(rateLimitClient(30));

    const invalid = await simulatePost(
      new Request('http://localhost/api/battle/simulate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.55' },
        body: JSON.stringify({ side_a_version_id: 'hanya-satu' }),
      }),
    );
    assert.equal(invalid.status, 400);

    // Kuota masih utuh: 30 permintaan sah berikutnya tetap lolos.
    for (let i = 1; i <= 30; i += 1) {
      const response = await simulatePost(simulateRequest());
      assert.notEqual(response.status, 429, `permintaan sah ke-${i} tidak boleh dibatasi`);
    }
  });
});
