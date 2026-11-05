/**
 * `app/sitemap.ts` — hanya halaman statis + matchup **populer**.
 *
 * Kenapa ini perlu dikunci: permalink matchup dibuat untuk setiap pasangan form
 * yang pernah disimulasikan, dan jumlahnya tumbuh kombinatorial. Sitemap yang
 * mendaftarkan semuanya akan membanjiri indeks dengan halaman hasil yang tidak
 * pernah dibuka siapa pun. Test ini memastikan daftar matchup benar-benar
 * berasal dari `mv_battle_popularity` (lewat `listPopularMatchups`), bukan dari
 * tabel `battles`.
 *
 * Database dipalsukan: `listPopularMatchups` menjalankan satu query ke
 * `mv_battle_popularity`, dan itulah satu-satunya query yang dijawab di sini.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { setSqlClient, type SqlClient } from '../../src/lib/db/client.ts';

const { default: sitemap } = await import('../../app/sitemap.ts');

function popularClient(rows: Array<{ slug: string; simulations: number }>): SqlClient {
  return {
    async query<T>(text: string): Promise<T[]> {
      assert.match(text, /mv_battle_popularity/, 'sitemap harus membaca MV, bukan tabel battles');
      return rows.map((row) => ({
        matchup_key: row.slug,
        simulations: row.simulations,
        share_count: 0,
        last_simulated_at: '2026-11-01T00:00:00.000Z',
      })) as T[];
    },
  };
}

const POPULAR_SLUG = 'saitama/post-balding-vs-genos/post-elder-centipede';

describe('sitemap: matchup populer saja', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const originalDatabase = process.env.DATABASE_URL;
  const originalError = console.error;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://animebattle.example';
    process.env.DATABASE_URL = 'postgres://fixture.test/db';
    console.error = () => {};
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = originalUrl;
    if (originalDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabase;
    console.error = originalError;
    setSqlClient(null);
  });

  it('menambahkan permalink matchup populer setelah halaman statis', async () => {
    setSqlClient(popularClient([{ slug: POPULAR_SLUG, simulations: 12 }]));

    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    assert.equal(urls[0], 'https://animebattle.example');
    assert.ok(urls.includes('https://animebattle.example/versus'));
    assert.equal(urls.at(-1), `https://animebattle.example/versus/${POPULAR_SLUG}`);

    const matchup = entries.at(-1)!;
    assert.equal(
      new Date(matchup.lastModified as Date).toISOString(),
      '2026-11-01T00:00:00.000Z',
    );
    assert.equal(matchup.changeFrequency, 'weekly');
    // Prioritas matchup lebih rendah dari halaman katalog: ini halaman hasil,
    // bukan pintu masuk utama situs.
    assert.ok(matchup.priority! < 0.8);
  });

  it('sitemap tetap sah saat database belum dikonfigurasi, tanpa log galat', async () => {
    delete process.env.DATABASE_URL;
    let logged = false;
    console.error = () => {
      logged = true;
    };

    const entries = await sitemap();
    assert.equal(entries.some((entry) => entry.url.includes('/versus/')), false);
    assert.ok(entries.length >= 7, 'halaman statis tetap terdaftar');
    assert.equal(logged, false, 'database kosong bukan kegagalan yang perlu dicatat');
  });

  it('kegagalan membaca MV tidak menjatuhkan sitemap, tetapi dicatat', async () => {
    let message = '';
    console.error = (...args: unknown[]) => {
      message = args.map(String).join(' ');
    };
    setSqlClient({
      query: async () => {
        throw Object.assign(new Error('relation "mv_battle_popularity" does not exist'), {
          code: '42P01',
        });
      },
    });

    const entries = await sitemap();
    assert.ok(entries.length >= 7);
    assert.match(message, /\[sitemap\]/);
    assert.match(message, /mv_battle_popularity/);
  });
});
