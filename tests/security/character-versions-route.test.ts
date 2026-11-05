/**
 * Kontrak `GET /api/characters/:slug/versions` — endpoint form untuk combobox.
 *
 * Tiga hal yang dikunci:
 *  1. Slug divalidasi **sebelum** database disentuh, sehingga permintaan cacat
 *     tidak membebani pool koneksi dan tidak menghabiskan kuota.
 *  2. Karakter yang tidak ada dijawab 404, bukan `200 { data: [] }`. Daftar
 *     kosong membuat combobox tampak "karakter ada tetapi tidak punya form".
 *  3. Respons sukses boleh di-cache edge (600 s) sedangkan galat tidak.
 *
 * Database dipalsukan lewat `setSqlClient`: `rate_limit_hit` selalu mengizinkan,
 * dan query form dijawab dari fixture. Tidak ada Postgres yang dibutuhkan.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { setSqlClient, type SqlClient } from '../../src/lib/db/client.ts';
import type { NextRequest } from 'next/server';

const { GET: versionsGet } = await import('../../app/api/characters/[slug]/versions/route.ts');

/** Request palsu: route hanya membaca header, bukan `nextUrl`. */
function versionsRequest(slug: string, ip = '203.0.113.7'): NextRequest {
  return {
    headers: new Headers({ 'x-forwarded-for': ip }),
  } as unknown as NextRequest;
}

function context(slug: string): { params: Promise<{ slug: string }> } {
  return { params: Promise.resolve({ slug }) };
}

interface FakeOptions {
  /** Baris yang dikembalikan query form; `null` = karakter tidak ada. */
  forms?: Array<{ form_slug: string; form_name: string; era: string | null; tier_code: string | null }>;
  /** Jumlah permintaan yang diizinkan sebelum 429. */
  limit?: number;
  /** Bila diisi, query selain `rate_limit_hit` melempar error ini. */
  failWith?: unknown;
}

function fakeClient(options: FakeOptions = {}): SqlClient {
  let hits = 0;
  const limit = options.limit ?? 120;
  return {
    async query<T>(text: string): Promise<T[]> {
      if (text.includes('rate_limit_hit')) {
        hits += 1;
        const allowed = hits <= limit;
        return [
          { allowed, remaining: Math.max(limit - hits, 0), retry_after_ms: allowed ? 0 : 45_000 },
        ] as T[];
      }
      if (options.failWith !== undefined) throw options.failWith;
      if (text.includes('from characters c')) {
        const forms = options.forms ?? [];
        return forms.map((row) => ({ character_name: 'Fixture Hero', ...row })) as T[];
      }
      throw new Error(`query tak terduga: ${text.slice(0, 40)}`);
    },
  };
}

const FORMS = [
  { form_slug: 'first-form', form_name: 'Fixture Hero (First Form)', era: 'First arc', tier_code: '5-B' },
  { form_slug: 'second-form', form_name: 'Fixture Hero (Second Form)', era: 'Final arc', tier_code: null },
];

describe('GET /api/characters/:slug/versions', () => {
  const originalError = console.error;

  beforeEach(() => {
    console.error = () => {};
  });

  afterEach(() => {
    console.error = originalError;
    setSqlClient(null);
  });

  it('menjawab daftar form satu karakter dengan cache edge 600 detik', async () => {
    setSqlClient(fakeClient({ forms: FORMS }));

    const response = await versionsGet(versionsRequest('fixture-hero'), context('fixture-hero'));
    assert.equal(response.status, 200);

    const body = (await response.json()) as {
      character: { slug: string; name: string };
      data: Array<{ value: string; label: string; tier_code: string | null }>;
    };
    assert.equal(body.character.slug, 'fixture-hero');
    assert.equal(body.character.name, 'Fixture Hero');
    assert.deepEqual(
      body.data.map((option) => option.value),
      ['fixture-hero/first-form', 'fixture-hero/second-form'],
    );
    assert.equal(body.data[0]!.tier_code, '5-B');

    const cache = response.headers.get('cache-control') ?? '';
    assert.match(cache, /s-maxage=600/);
    assert.match(cache, /stale-while-revalidate=3600/);
  });

  it('slug tidak sah ditolak 400 tanpa menyentuh database', async () => {
    // Klien yang melempar bila dipanggil: 400 harus diputuskan sebelum query.
    setSqlClient(fakeClient({ failWith: new Error('database tidak boleh disentuh') }));

    for (const slug of ['Fixture-Hero', '-awal', 'akhir-', 'dua--strip', 'spasi ada', 'a'.repeat(121)]) {
      const response = await versionsGet(versionsRequest(slug), context(slug));
      assert.equal(response.status, 400, `slug ${JSON.stringify(slug.slice(0, 12))}`);
      const body = (await response.json()) as { error: { code: string } };
      assert.equal(body.error.code, 'INVALID_INPUT');
    }
  });

  it('karakter yang tidak ada dijawab 404, bukan daftar kosong', async () => {
    setSqlClient(fakeClient({ forms: [] }));

    const response = await versionsGet(versionsRequest('tidak-ada'), context('tidak-ada'));
    assert.equal(response.status, 404);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.equal(response.headers.get('cache-control'), null);
  });

  it('gangguan database → 503 tanpa membocorkan pesan driver', async () => {
    setSqlClient(
      fakeClient({
        failWith: Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:6543'), {
          code: 'ECONNREFUSED',
        }),
      }),
    );

    const response = await versionsGet(versionsRequest('fixture-hero'), context('fixture-hero'));
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'UNAVAILABLE');
    assert.doesNotMatch(body.error.message, /ECONNREFUSED|10\.0\.0\.5|6543/);
  });

  it('permintaan ke-121 dalam jendela yang sama dijawab 429', async () => {
    setSqlClient(fakeClient({ forms: FORMS, limit: 120 }));

    for (let i = 1; i <= 120; i += 1) {
      const response = await versionsGet(versionsRequest('fixture-hero'), context('fixture-hero'));
      assert.notEqual(response.status, 429, `permintaan ke-${i} tidak boleh dibatasi`);
    }

    const blocked = await versionsGet(versionsRequest('fixture-hero'), context('fixture-hero'));
    assert.equal(blocked.status, 429);
    const body = (await blocked.json()) as {
      error: { code: string; details: { retry_after_ms: number } };
    };
    assert.equal(body.error.code, 'RATE_LIMITED');
    assert.equal(blocked.headers.get('retry-after'), '45');
  });
});
