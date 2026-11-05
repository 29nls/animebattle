import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

import { setSqlClient } from '../../src/lib/db/client.ts';
import { parseLegalReport } from '../../src/features/legal/takedown.ts';
import { POST } from '../../app/api/legal/takedown/route.ts';

const SCHEMA = readFileSync(fileURLToPath(new URL('../../docs/schema.sql', import.meta.url)), 'utf8');

let db: PGlite;

const VALID = {
  kind: 'takedown',
  name: 'Pemegang Hak',
  email: 'legal@example.test',
  url: 'https://animebattle.example/character/contoh',
  description: 'Konten ini menggunakan karya saya tanpa izin dan atribusi.',
  good_faith: true,
};

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/legal/takedown', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
      'x-forwarded-for': '203.0.113.71',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function rows(): Promise<Array<Record<string, unknown>>> {
  const result = await db.query(`select ticket_code, kind, status from animebattle.legal_reports`);
  return result.rows as Array<Record<string, unknown>>;
}

before(async () => {
  db = await PGlite.create({ extensions: { pg_trgm, unaccent, pgcrypto } });
  await db.exec(SCHEMA);
  setSqlClient({
    query: async <T>(text: string, params?: readonly unknown[]) => {
      const result = await db.query(text, params as unknown[]);
      return result.rows as T[];
    },
  });
});

after(async () => {
  setSqlClient(null);
  await db.close();
});

describe('validasi laporan legal', () => {
  it('menerima laporan lengkap dan menolak iktikad baik yang tidak dicentang', () => {
    const ok = parseLegalReport(VALID);
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.value.url, VALID.url);

    const denied = parseLegalReport({ ...VALID, good_faith: false });
    assert.equal(denied.ok, false);
  });

  it('menolak honeypot dan URL dengan kredensial', () => {
    assert.equal(parseLegalReport({ ...VALID, website: 'spam' }).ok, false);
    assert.equal(parseLegalReport({ ...VALID, url: 'https://user:pass@example.test/x' }).ok, false);
  });
});

describe('POST /api/legal/takedown', () => {
  it('menyimpan tiket, mengembalikan kode, dan status awal new', async () => {
    const response = await POST(request(VALID));
    assert.equal(response.status, 201);
    const body = (await response.json()) as { data: { ticket_code: string; created_at: string } };
    assert.match(body.data.ticket_code, /^AB-[A-Z0-9]{10}$/);
    assert.ok(body.data.created_at);

    const stored = await rows();
    assert.equal(stored.length, 1);
    assert.equal(stored[0]!.status, 'new');
    assert.equal(stored[0]!.kind, 'takedown');
  });

  it('menolak Origin lintas situs dan laporan tanpa pernyataan', async () => {
    const before = (await rows()).length;
    const cross = await POST(request(VALID, { origin: 'https://evil.example' }));
    assert.equal(cross.status, 403);

    const invalid = await POST(request({ ...VALID, good_faith: false }));
    assert.equal(invalid.status, 400);
    assert.equal((await rows()).length, before);
  });

  it('membatasi lima laporan per jam per IP dengan 429', async () => {
    await db.exec(`delete from animebattle.rate_limit_windows`);
    const ip = '198.51.100.44';
    for (let i = 0; i < 5; i += 1) {
      const response = await POST(request(VALID, { 'x-forwarded-for': ip }));
      assert.equal(response.status, 201, `laporan ke-${i + 1}`);
    }
    const blocked = await POST(request(VALID, { 'x-forwarded-for': ip }));
    assert.equal(blocked.status, 429);
    const body = (await blocked.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'RATE_LIMITED');
  });
});
