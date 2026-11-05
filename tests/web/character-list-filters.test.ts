/**
 * Filter `/characters` di atas skema sungguhan (PGlite + docs/schema.sql).
 *
 * Test ini menutup celah yang tidak terlihat di test parser: filter verse/media
 * dan pencarian harus benar-benar sampai ke SQL, dan `total` harus mengikuti
 * filter yang sama dengan baris. Sebelum perubahan UI, jalur database
 * mengabaikan `q`; halaman akan menampilkan seluruh katalog sambil memberi tahu
 * pengguna bahwa tidak ada hasil — atau sebaliknya.
 *
 * Data ditulis lewat jalur produksi (`applyDataset`) agar trigger tier dan
 * completeness ikut berjalan, bukan INSERT buatan test.
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
import type { DatasetEnvelope } from '../../src/services/ingestion/dataset.ts';
import {
  countCharacters,
  loadCharacterList,
} from '../../src/features/characters/queries.ts';

const resolveDoc = (name: string): string =>
  fileURLToPath(new URL(`../../docs/${name}`, import.meta.url));

const SOURCE_SLUG = 'admin-dataset-import';
const PROVENANCE_URL = 'dataset://character-list-fixture/1';
const LICENSE = 'CC BY-SA 4.0 (Character List Fixture)';

const db = await PGlite.create({ extensions: { pg_trgm, unaccent, pgcrypto } });
let sql: SqlClient;

function dataset(input: {
  characterSlug: string;
  characterName: string;
  verseSlug: string;
  verseName: string;
  media: 'manga' | 'anime';
}): DatasetEnvelope {
  return {
    parser_version: 'dataset-json@1.0.0',
    source_slug: SOURCE_SLUG,
    source_url: PROVENANCE_URL,
    license: LICENSE,
    license_url: 'https://fixture.test/license',
    attribution: 'Data fixture untuk pengujian filter daftar karakter.',
    verse: {
      slug: input.verseSlug,
      name: input.verseName,
      description: `Verse sintetis ${input.verseName}.`,
      origin_media: input.media,
    },
    characters: [
      {
        slug: input.characterSlug,
        name: input.characterName,
        native_name: null,
        description: `Karakter sintetis ${input.characterName}.`,
        classification: null,
        origin: input.verseName,
        media_type: input.media,
        source_url: PROVENANCE_URL,
        forms: [
          {
            slug: 'base',
            name: `${input.characterName} (Base)`,
            era: null,
            description: null,
            form_order: 1,
            is_default: true,
            tier_code: '5-B',
            statistics: [
              {
                metric: 'attack_potency',
                raw_text: 'City level',
                qualifier: 'exact',
                confidence: 0.8,
                scale_code: 'city',
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

async function insert(input: Parameters<typeof dataset>[0]): Promise<void> {
  const source = await loadSourceBySlug(sql, SOURCE_SLUG);
  assert.ok(source, `sumber ${SOURCE_SLUG} harus ter-seed`);
  const envelope = dataset(input);
  const report = await applyDataset(
    {
      sql,
      source,
      jobId: '00000000-0000-0000-0000-0000000000f2',
      parserVersion: 'dataset-json@1.0.0',
      dryRun: false,
      provenanceUrl: PROVENANCE_URL,
      license: envelope.license,
      licenseUrl: envelope.license_url,
      attribution: envelope.attribution,
    },
    envelope,
  );
  assert.equal(report.failed, 0, `impor fixture gagal: ${JSON.stringify(report.failures)}`);
}

/** Pemilih membaca `DATABASE_URL` langsung dari env; klien disuntikkan. */
async function asDatabase<T>(run: () => Promise<T>): Promise<T> {
  const previousUrl = process.env.DATABASE_URL;
  const previousDemo = process.env.ALLOW_DEMO_DATA;
  process.env.DATABASE_URL = 'postgres://fixture';
  delete process.env.ALLOW_DEMO_DATA;
  setSqlClient(sql);
  try {
    return await run();
  } finally {
    setSqlClient(null);
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousDemo === undefined) delete process.env.ALLOW_DEMO_DATA;
    else process.env.ALLOW_DEMO_DATA = previousDemo;
  }
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

  await insert({
    characterSlug: 'alpha-hero',
    characterName: 'Alpha Hero',
    verseSlug: 'alpha-verse',
    verseName: 'Alpha Verse',
    media: 'manga',
  });
  await insert({
    characterSlug: 'beta-hero',
    characterName: 'Beta Hero',
    verseSlug: 'beta-verse',
    verseName: 'Beta Verse',
    media: 'anime',
  });
});

describe('daftar karakter: filter verse dan media', () => {
  it('menyaring menurut slug verse dan mengembalikan total yang sama', async () => {
    await asDatabase(async () => {
      const result = await loadCharacterList({ verseSlug: 'alpha-verse' });
      assert.equal(result.source, 'database');
      assert.equal(result.total, 1);
      assert.deepEqual(
        result.rows.map((row) => row.slug),
        ['alpha-hero'],
      );
      assert.equal(result.rows[0]?.verse_slug, 'alpha-verse');
      assert.equal(result.rows[0]?.verse_name, 'Alpha Verse');
    });
  });

  it('menyaring menurut media tanpa memuat verse lain', async () => {
    await asDatabase(async () => {
      const result = await loadCharacterList({ media: 'anime' });
      assert.equal(result.total, 1);
      assert.deepEqual(
        result.rows.map((row) => row.slug),
        ['beta-hero'],
      );
    });
  });

  it('menggabungkan filter verse dan media dengan AND, bukan OR', async () => {
    await asDatabase(async () => {
      const result = await loadCharacterList({ verseSlug: 'alpha-verse', media: 'anime' });
      assert.equal(result.total, 0);
      assert.deepEqual(result.rows, []);
      assert.equal(await countCharacters(sql, { verseSlug: 'alpha-verse', media: 'anime' }), 0);
    });
  });

  it('pagination berfilter tetap membawa filter dan tidak mengulang baris', async () => {
    await asDatabase(async () => {
      const first = await loadCharacterList({ limit: 1, offset: 0 });
      const second = await loadCharacterList({ limit: 1, offset: 1 });
      assert.equal(first.total, 2);
      assert.equal(second.total, 2);
      assert.equal(first.rows.length, 1);
      assert.equal(second.rows.length, 1);
      assert.notEqual(first.rows[0]?.slug, second.rows[0]?.slug);
      // Urutan tie-breaker nama: Alpha sebelum Beta pada popularitas yang sama.
      assert.equal(first.rows[0]?.slug, 'alpha-hero');
      assert.equal(second.rows[0]?.slug, 'beta-hero');
    });
  });

  it('filter yang tidak cocok menjawab kosong dengan total nol', async () => {
    await asDatabase(async () => {
      const result = await loadCharacterList({ verseSlug: 'tidak-ada' });
      assert.equal(result.total, 0);
      assert.deepEqual(result.rows, []);
    });
  });
});

describe('daftar karakter: pencarian', () => {
  it('q memakai RPC pencarian dan benar-benar menyaring hasil', async () => {
    await asDatabase(async () => {
      const result = await loadCharacterList({ query: 'Alpha' });
      assert.equal(result.source, 'database');
      assert.equal(result.total, 1);
      assert.deepEqual(
        result.rows.map((row) => row.slug),
        ['alpha-hero'],
      );
      assert.equal(result.rows[0]?.verse_name, 'Alpha Verse');
    });
  });

  it('q yang tidak menemukan apa pun menjawab kosong, bukan seluruh katalog', async () => {
    await asDatabase(async () => {
      const result = await loadCharacterList({ query: 'zzzz-tidak-ada' });
      assert.equal(result.total, 0);
      assert.deepEqual(result.rows, []);
    });
  });

  it('q dan filter verse digabung, bukan saling menimpa', async () => {
    await asDatabase(async () => {
      const matching = await loadCharacterList({ query: 'Hero', verseSlug: 'alpha-verse' });
      assert.equal(matching.total, 1);
      assert.equal(matching.rows[0]?.slug, 'alpha-hero');

      const mismatching = await loadCharacterList({ query: 'Alpha', verseSlug: 'beta-verse' });
      assert.equal(mismatching.total, 0);
      assert.deepEqual(mismatching.rows, []);
    });
  });

  it('q kosong memakai jalur daftar, bukan RPC yang menjawab kosong', async () => {
    await asDatabase(async () => {
      const result = await loadCharacterList({ query: '   ' });
      assert.equal(result.total, 2);
      assert.equal(result.rows.length, 2);
    });
  });
});
