/**
 * Uji metrik homepage di atas **skema sungguhan** (PGlite + docs/schema.sql).
 *
 * Kenapa ada: homepage pernah mengiklankan "lebih dari 10.000 karakter" saat
 * produksi berisi 3 karakter, dan bagian *Popular Battles* dirender sebagai
 * tiga kartu skeleton berlabel "Menunggu data mv_battle_popularity" — placeholder
 * tanpa akhir. Keduanya tidak dapat ditangkap test unit biasa karena tidak ada
 * kode yang salah: yang salah adalah **angka yang tidak dibaca dari mana pun**.
 *
 * Empat keadaan yang dikunci di sini, semuanya pernah atau mungkin terjadi:
 *
 *  1. **Katalog kosong** → nol yang sah (bukan angka aspirasional).
 *  2. **Katalog terisi** → angka sama dengan baris yang benar-benar ada.
 *  3. **Database belum dikonfigurasi / query gagal** → hasil `failed`, sehingga
 *     halaman menampilkan keadaan "belum tersedia" — bukan nol (yang terbaca
 *     seperti katalog kosong) dan bukan angka dataset demo.
 *  4. **Belum ada hasil pertarungan tersimpan** → `mv_battle_popularity` kosong
 *     dan halaman menyatakan belum ada data, bukan menunggu.
 *
 * Ditambah penjaga sumber halaman: teks klaim jumlah yang di-hardcode tidak boleh
 * kembali, apa pun yang terjadi pada modul metriknya.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

import { attemptLoad } from '../../src/features/data-source.ts';
import {
  countCatalog,
  listPopularBattles,
  listRecentImports,
  loadHomeMetrics,
} from '../../src/features/home/metrics.ts';
import { applyDataset } from '../../src/services/ingestion/upsert.ts';
import { loadSourceBySlug } from '../../src/services/ingestion/sources.ts';
import { setSqlClient, type SqlClient } from '../../src/lib/db/client.ts';
import type { DatasetEnvelope } from '../../src/services/ingestion/dataset.ts';

const resolveDoc = (name: string): string =>
  fileURLToPath(new URL(`../../docs/${name}`, import.meta.url));

const SOURCE_SLUG = 'admin-dataset-import';
const PROVENANCE_URL = 'dataset://home-metrics/1';

const db = await PGlite.create({ extensions: { pg_trgm, unaccent, pgcrypto } });

let sql: SqlClient;

/** Envelope minimal: satu verse + satu karakter dengan satu form. */
function fixtureDataset(slug: string, name: string): DatasetEnvelope {
  return {
    parser_version: 'dataset-json@1.0.0',
    source_slug: SOURCE_SLUG,
    source_url: PROVENANCE_URL,
    license: 'CC BY-SA 4.0 (Fixture Wiki)',
    license_url: 'https://fixture.test/license',
    attribution: 'Angka fixture dikutip dari Fixture Wiki.',
    verse: {
      slug: 'home-metrics-verse',
      name: 'Home Metrics Verse',
      description: 'Verse sintetis untuk uji metrik homepage.',
      origin_media: 'manga',
    },
    characters: [
      {
        slug,
        name,
        native_name: null,
        description: null,
        classification: null,
        origin: 'Home Metrics Verse',
        media_type: 'manga',
        source_url: PROVENANCE_URL,
        forms: [
          {
            slug: 'default',
            name: `${name} (Default)`,
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
              {
                metric: 'speed',
                raw_text: 'Massively FTL+',
                qualifier: 'possibly',
                confidence: 0.72,
                scale_code: 'mftl_plus',
              },
            ],
            abilities: [],
            resistances: [],
          },
        ],
      },
    ],
  };
}

/** Menulis karakter lewat jalur produksi (`applyDataset`), bukan INSERT buatan test. */
async function insertFixtureCharacter(slug: string, name: string): Promise<void> {
  const source = await loadSourceBySlug(sql, SOURCE_SLUG);
  assert.ok(source, `sumber ${SOURCE_SLUG} harus ter-seed`);
  const dataset = fixtureDataset(slug, name);
  const report = await applyDataset(
    {
      sql,
      source,
      // UUID sah tetapi tidak menyentuh baris `ingestion_jobs` mana pun: fixture
      // ini menguji query baca, bukan lifecycle job.
      jobId: '00000000-0000-0000-0000-0000000000f1',
      parserVersion: 'dataset-json@1.0.0',
      dryRun: false,
      provenanceUrl: PROVENANCE_URL,
      license: dataset.license,
      licenseUrl: dataset.license_url,
      attribution: dataset.attribution,
    },
    dataset,
  );
  assert.equal(report.failed, 0, `impor fixture gagal: ${JSON.stringify(report.failures)}`);
}

before(async () => {
  await db.exec(readFileSync(resolveDoc('schema.sql'), 'utf8'));
  await db.exec(readFileSync(resolveDoc('seed.sql'), 'utf8'));
  sql = {
    async query<T>(text: string, params?: readonly unknown[]): Promise<T[]> {
      const result = await db.query(text, params as unknown[]);
      return result.rows as T[];
    },
  };
});

describe('metrik homepage di atas database terisi', () => {
  it('katalog kosong menjawab nol yang sah, bukan angka aspirasional', async () => {
    const counts = await countCatalog(sql);
    assert.equal(counts.characters, 0);
    assert.equal(counts.forms, 0);
    assert.equal(counts.verses, 0);
    // Ability/resistensi berasal dari seed katalog: yang diperiksa hanya bahwa
    // keduanya terbaca sebagai angka utuh, bukan ditebak sebagai nol atau satu.
    assert.equal(Number.isInteger(counts.abilities), true);
    assert.equal(Number.isInteger(counts.resistances), true);
  });

  it('impor belum tercatat → daftar kosong (bukan kartu menunggu)', async () => {
    assert.deepEqual(await listRecentImports(sql), []);
  });

  it('belum ada hasil pertarungan tersimpan → matchup kosong', async () => {
    assert.deepEqual(await listPopularBattles(sql), []);
  });

  it('menghitung karakter/form/verse dari baris yang benar-benar ada', async () => {
    await insertFixtureCharacter('home-fixture-hero', 'Home Fixture Hero');
    const counts = await countCatalog(sql);
    assert.equal(counts.characters, 1);
    assert.equal(counts.forms, 1);
    assert.equal(counts.verses, 1);

    // Form yang di-soft-delete tidak boleh ikut dihitung: angka homepage harus
    // sama dengan jumlah form yang tampil di halaman karakter.
    await db.exec(`update character_versions set deleted_at = now()`);
    assert.equal((await countCatalog(sql)).forms, 0);
    await db.exec(`update character_versions set deleted_at = null`);
  });

  it('impor terakhir dibaca dari ingestion_jobs, termasuk yang gagal', async () => {
    await db.exec(`
      insert into ingestion_jobs (scope, status, records_found, records_created, records_updated, records_failed, completed_at)
      values ('import_dataset', 'completed', 60, 6, 0, 0, now() - interval '2 hours'),
             ('import_dataset', 'partial',   60, 0, 5, 1, now() - interval '1 hour'),
             ('manual_run',    'pending',     0, 0, 0, 0, null)
    `);
    const imports = await listRecentImports(sql);
    assert.equal(imports.length, 2, 'job pending tidak boleh tampil sebagai impor terakhir');
    assert.equal(imports[0]?.status, 'partial', 'diurutkan menurut waktu selesai terbaru');
    assert.equal(imports[0]?.records_failed, 1);
    assert.equal(imports[1]?.records_created, 6);
    // Bentuk waktunya berbeda antar driver (postgres.js dinormalisasi menjadi
    // string ISO oleh `lib/db/client.ts`, PGlite mengembalikan `Date`), dan
    // pemformatnya harus menerima keduanya — itu yang diuji, bukan tipenya.
    const finished = new Date(imports[0]?.finished_at as string | Date);
    assert.equal(Number.isNaN(finished.getTime()), false);
  });

  it('matchup populer dihitung dari battle_results, bukan skor karangan', async () => {
    const versionIds = await sql.query<{ id: string }>(
      `select cv.id
         from character_versions cv
         join characters c on c.id = cv.character_id
        where c.slug = 'home-fixture-hero'`,
    );
    await insertFixtureCharacter('home-fixture-rival', 'Home Fixture Rival');
    const rivalIds = await sql.query<{ id: string }>(
      `select cv.id
         from character_versions cv
         join characters c on c.id = cv.character_id
        where c.slug = 'home-fixture-rival'`,
    );
    const conditions = await sql.query<{ id: string }>(
      `insert into battle_conditions (conditions_hash) values ('home-metrics-fixture') returning id`,
    );
    const battles = await sql.query<{ id: string }>(
      `insert into battles (slug, side_a_version_id, side_b_version_id, conditions_id)
       values ('home-fixture-hero-vs-rival', $1, $2, $3) returning id`,
      [versionIds[0]?.id, rivalIds[0]?.id, conditions[0]?.id],
    );
    await sql.query(
      `insert into battle_results (battle_id, winner, win_probability_a, win_probability_b, confidence,
                                   difficulty, battle_length, primary_reason, input_hash, engine_version,
                                   rule_set_version, rule_set_id)
       select $1, 'a', 0.6, 0.4, 0.5, 'mid', 'medium', 'fixture', 'home-metrics-fixture-hash',
              'battle-engine@1.0.0', rs.version, rs.id
         from battle_rule_sets rs where rs.version = '1.0.0'`,
      [battles[0]?.id],
    );
    await db.exec(`refresh materialized view mv_battle_popularity`);

    const popular = await listPopularBattles(sql);
    assert.equal(popular.length, 1);
    assert.equal(popular[0]?.side_a_character, 'Home Fixture Hero');
    assert.equal(popular[0]?.side_b_character, 'Home Fixture Rival');
    assert.equal(popular[0]?.simulations, 1);
  });
});

describe('metrik homepage ketika database tidak tersedia', () => {
  it('database belum dikonfigurasi → failed, bukan nol dan bukan data demo', async () => {
    const previousDemo = process.env.ALLOW_DEMO_DATA;
    const previousUrl = process.env.DATABASE_URL;
    process.env.ALLOW_DEMO_DATA = '1';
    delete process.env.DATABASE_URL;
    setSqlClient(null);
    try {
      const outcome = await attemptLoad(() => loadHomeMetrics());
      assert.equal(outcome.status, 'failed');
      if (outcome.status === 'failed') {
        assert.match(outcome.message, /Database belum dikonfigurasi/);
      }
    } finally {
      if (previousDemo === undefined) delete process.env.ALLOW_DEMO_DATA;
      else process.env.ALLOW_DEMO_DATA = previousDemo;
      if (previousUrl !== undefined) process.env.DATABASE_URL = previousUrl;
    }
  });

  it('query gagal di tengah jalan → failed, halaman menampilkan keadaan belum tersedia', async () => {
    setSqlClient({
      query: async () => {
        throw Object.assign(new Error('relation "mv_battle_popularity" does not exist'), { code: '42P01' });
      },
    });
    try {
      const outcome = await attemptLoad(() => loadHomeMetrics());
      assert.equal(outcome.status, 'failed');
      if (outcome.status === 'failed') {
        assert.match(outcome.message, /Gagal memuat data/);
        assert.match(outcome.message, /docs\/schema\.sql/);
      }
    } finally {
      setSqlClient(null);
    }
  });
});

describe('penjaga sumber halaman', () => {
  const pageSource = readFileSync(
    fileURLToPath(new URL('../../app/page.tsx', import.meta.url)),
    'utf8',
  );

  it('tidak lagi memuat klaim jumlah katalog yang di-hardcode', () => {
    assert.doesNotMatch(pageSource, /10[.,]?000/);
    assert.doesNotMatch(pageSource, /\b(ribuan|thousands)\b/i);
    assert.doesNotMatch(pageSource, /Lebih dari/i);
  });

  it('tidak lagi menunggu materialized view dengan skeleton', () => {
    assert.doesNotMatch(pageSource, /Menunggu data/);
    assert.doesNotMatch(pageSource, /skeleton/);
  });

  it('membaca angka dari modul metrik, bukan dari konstanta', () => {
    assert.match(pageSource, /loadHomeMetrics/);
    assert.match(pageSource, /NUMBER\.format/);
  });
});
