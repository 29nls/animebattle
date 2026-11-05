/**
 * Atribusi sumber di atas skema sungguhan (PGlite + docs/schema.sql).
 *
 * Setiap halaman data wajib menampilkan sumber dan lisensinya. Yang diuji di
 * sini bukan tampilan, melainkan bahan tampilannya: lisensi dari envelope impor
 * menang atas registry, dan empat keadaan (`database`, `demo`, `unavailable`,
 * `failed`) tidak boleh saling tertukar. Keadaan yang tertukar membuat halaman
 * berbohong — misalnya database rusak tampil sebagai "tidak ada sumber".
 *
 * Jalankan: npm run test:web
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

import { setSqlClient, type SqlClient } from '../../src/lib/db/client.ts';
import { loadSourceBySlug } from '../../src/services/ingestion/sources.ts';
import { applyDataset } from '../../src/services/ingestion/upsert.ts';
import { listAttribution, loadAttribution } from '../../src/features/attribution/queries.ts';

const resolveDoc = (name: string): string =>
  fileURLToPath(new URL(`../../docs/${name}`, import.meta.url));

const SOURCE_SLUG = 'admin-dataset-import';
const PROVENANCE_URL = 'dataset://attribution-fixture/1';
const LICENSE = 'CC BY-SA 4.0 (Atribusi Fixture)';
const LICENSE_URL = 'https://fixture.test/attribution-license';
const ATTRIBUTION = 'Angka fixture dikutip dari Atribusi Fixture.';

const db = await PGlite.create({ extensions: { pg_trgm, unaccent, pgcrypto } });
let sql: SqlClient;

const dataset = {
  parser_version: 'dataset-json@1.0.0',
  source_slug: SOURCE_SLUG,
  source_url: PROVENANCE_URL,
  license: LICENSE,
  license_url: LICENSE_URL,
  attribution: ATTRIBUTION,
  verse: {
    slug: 'attribution-verse',
    name: 'Attribution Verse',
    description: 'Verse sintetis untuk uji atribusi.',
    origin_media: 'manga',
  },
  characters: [
    {
      slug: 'attribution-hero',
      name: 'Attribution Hero',
      native_name: null,
      description: null,
      classification: null,
      origin: 'Attribution Verse',
      media_type: 'manga',
      source_url: PROVENANCE_URL,
      forms: [
        {
          slug: 'base',
          name: 'Attribution Hero (Base)',
          era: null,
          description: null,
          form_order: 1,
          is_default: true,
          tier_code: '5-B',
          statistics: [
            {
              metric: 'attack_potency',
              raw_text: 'Island level',
              qualifier: 'exact',
              confidence: 0.8,
              scale_code: 'island',
            },
          ],
          abilities: [],
          resistances: [],
        },
      ],
    },
  ],
} satisfies import('../../src/services/ingestion/dataset.ts').DatasetEnvelope;

before(async () => {
  await db.exec(readFileSync(resolveDoc('schema.sql'), 'utf8'));
  await db.exec(readFileSync(resolveDoc('seed.sql'), 'utf8'));
  sql = {
    async query<T>(text: string, params?: readonly unknown[]): Promise<T[]> {
      const result = await db.query(text, params as unknown[]);
      return result.rows as T[];
    },
  };

  const source = await loadSourceBySlug(sql, SOURCE_SLUG);
  assert.ok(source, `sumber ${SOURCE_SLUG} harus ter-seed`);
  const report = await applyDataset(
    {
      sql,
      source,
      jobId: '00000000-0000-0000-0000-0000000000f3',
      parserVersion: 'dataset-json@1.0.0',
      dryRun: false,
      provenanceUrl: PROVENANCE_URL,
      license: LICENSE,
      licenseUrl: LICENSE_URL,
      attribution: ATTRIBUTION,
    },
    dataset,
  );
  assert.equal(report.failed, 0, `impor fixture gagal: ${JSON.stringify(report.failures)}`);
});

async function withEnvironment<T>(
  env: { DATABASE_URL?: string; ALLOW_DEMO_DATA?: string },
  run: () => Promise<T>,
): Promise<T> {
  const previous = {
    DATABASE_URL: process.env.DATABASE_URL,
    ALLOW_DEMO_DATA: process.env.ALLOW_DEMO_DATA,
  };
  for (const key of ['DATABASE_URL', 'ALLOW_DEMO_DATA'] as const) {
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const key of ['DATABASE_URL', 'ALLOW_DEMO_DATA'] as const) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('listAttribution', () => {
  it('membaca lisensi dan atribusi dari impor, bukan menebaknya', async () => {
    const rows = await listAttribution(sql);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.ok(row);
    assert.equal(row.license, LICENSE);
    assert.equal(row.license_url, LICENSE_URL);
    assert.equal(row.attribution_text, ATTRIBUTION);
    assert.ok(row.source_name.length > 0);
    // URL sumber berasal dari registry (`base_url`); seed memakai skema
    // `about:dataset` untuk impor terkelola, jadi yang diuji adalah bentuknya
    // dapat ditampilkan, bukan skema protokol tertentu.
    assert.ok(row.source_url && /^(https?:|about:)/.test(row.source_url));
  });

  it('tidak menggandakan sumber yang sama untuk setiap karakter', async () => {
    const rows = await listAttribution(sql, 50);
    const keys = rows.map((row) => `${row.source_name}|${row.license ?? ''}`);
    assert.equal(new Set(keys).size, keys.length);
  });

  it('menormalkan limit ke rentang 1–50', async () => {
    assert.equal((await listAttribution(sql, 0)).length, 1, 'limit 0 dinormalkan ke 1');
    assert.equal((await listAttribution(sql, 1)).length, 1);
    assert.equal((await listAttribution(sql, 50)).length, 1);
  });
});

describe('loadAttribution', () => {
  it('database terkonfigurasi dan query berhasil → status database', async () => {
    await withEnvironment({ DATABASE_URL: 'postgres://fixture' }, async () => {
      setSqlClient(sql);
      try {
        const attribution = await loadAttribution();
        assert.equal(attribution.status, 'database');
        assert.equal(attribution.rows.length, 1);
        assert.equal(attribution.rows[0]?.license, LICENSE);
      } finally {
        setSqlClient(null);
      }
    });
  });

  it('database belum dikonfigurasi + demo aktif → status demo, bukan "tidak ada sumber"', async () => {
    await withEnvironment({ ALLOW_DEMO_DATA: '1' }, async () => {
      setSqlClient(null);
      const attribution = await loadAttribution();
      assert.equal(attribution.status, 'demo');
      assert.deepEqual(attribution.rows, []);
    });
  });

  it('database belum dikonfigurasi tanpa demo → status unavailable', async () => {
    await withEnvironment({}, async () => {
      setSqlClient(null);
      const attribution = await loadAttribution();
      assert.equal(attribution.status, 'unavailable');
      assert.deepEqual(attribution.rows, []);
    });
  });

  it('query gagal → status failed tanpa melempar, halaman tetap dapat dirender', async () => {
    await withEnvironment({ DATABASE_URL: 'postgres://fixture' }, async () => {
      const originalError = console.error;
      console.error = () => {};
      setSqlClient({
        query: async () => {
          throw new Error('relation "character_sources" does not exist');
        },
      });
      try {
        const attribution = await loadAttribution();
        assert.equal(attribution.status, 'failed');
        assert.deepEqual(attribution.rows, []);
      } finally {
        setSqlClient(null);
        console.error = originalError;
      }
    });
  });
});
