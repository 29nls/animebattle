/**
 * Uji pencarian berhalaman di atas **skema sungguhan** (PGlite + docs/schema.sql).
 *
 * Yang dikunci di sini adalah hal-hal yang tidak dapat diuji oleh test murni dan
 * pernah menjadi celah nyata:
 *
 *  1. **`total` tetap benar saat halamannya kosong.** `page=9` pada pencarian
 *     yang hanya punya 2 hasil harus menjawab `total = 2` dan `rows = []` — bukan
 *     `total = 0`. Inilah alasan RPC-nya mengembalikan `{ total, rows }` dalam satu
 *     dokumen, bukan setof baris dengan `count(*) over ()`.
 *  2. **Filter benar-benar menggigit.** `media`/`verse` yang tidak menyaring apa
 *     pun adalah filter palsu; di sini keduanya diuji pada data yang berbeda.
 *  3. **Nama asli (Kanji) dan alias dapat ditemukan.** Vector pencarian
 *     memberi bobot A pada `native_name` dan alias — properti itu hanya terbukti
 *     dengan menjalankan `to_tsvector`/trigram di database sungguhan.
 *  4. **Urutan deterministik**, sehingga `offset` antar-request tidak mengulang
 *     atau melewatkan baris.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

import { searchCharacterPage } from '../../src/features/characters/queries.ts';
import { applyDataset } from '../../src/services/ingestion/upsert.ts';
import { loadSourceBySlug } from '../../src/services/ingestion/sources.ts';
import { setSqlClient, type SqlClient } from '../../src/lib/db/client.ts';
import type { DatasetEnvelope } from '../../src/services/ingestion/dataset.ts';

const resolveDoc = (name: string): string =>
  fileURLToPath(new URL(`../../docs/${name}`, import.meta.url));

const SOURCE_SLUG = 'admin-dataset-import';

const db = await PGlite.create({ extensions: { pg_trgm, unaccent, pgcrypto } });
let sql: SqlClient;

const MANGA_VERSE = 'search-fixture-manga';
const ANIME_VERSE = 'search-fixture-anime';

/** Envelope satu karakter; `native_name` dipakai untuk menguji pencarian Kanji. */
function dataset(
  verse: { slug: string; name: string; media: 'manga' | 'anime' },
  character: { slug: string; name: string; native_name: string | null; media: 'manga' | 'anime' },
): DatasetEnvelope {
  return {
    parser_version: 'dataset-json@1.0.0',
    source_slug: SOURCE_SLUG,
    source_url: `dataset://search-fixture/${character.slug}`,
    license: 'CC BY-SA 4.0 (Fixture Wiki)',
    license_url: 'https://fixture.test/license',
    attribution: 'Angka fixture dikutip dari Fixture Wiki.',
    verse: {
      slug: verse.slug,
      name: verse.name,
      description: null,
      origin_media: verse.media,
    },
    characters: [
      {
        slug: character.slug,
        name: character.name,
        native_name: character.native_name,
        description: null,
        classification: null,
        origin: verse.name,
        media_type: character.media,
        source_url: `dataset://search-fixture/${character.slug}`,
        forms: [
          {
            slug: 'default',
            name: `${character.name} (Default)`,
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

async function importCharacter(envelope: DatasetEnvelope): Promise<void> {
  const source = await loadSourceBySlug(sql, SOURCE_SLUG);
  assert.ok(source, `sumber ${SOURCE_SLUG} harus ter-seed`);
  const report = await applyDataset(
    {
      sql,
      source,
      jobId: '00000000-0000-0000-0000-0000000000f2',
      parserVersion: 'dataset-json@1.0.0',
      dryRun: false,
      provenanceUrl: envelope.source_url,
      license: envelope.license,
      licenseUrl: envelope.license_url,
      attribution: envelope.attribution,
    },
    envelope,
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

  await importCharacter(
    dataset(
      { slug: MANGA_VERSE, name: 'Search Fixture Manga', media: 'manga' },
      { slug: 'sun-wukong', name: 'Sun Wukong', native_name: '孫悟空', media: 'manga' },
    ),
  );
  await importCharacter(
    dataset(
      { slug: ANIME_VERSE, name: 'Search Fixture Anime', media: 'anime' },
      { slug: 'monkey-king-junior', name: 'Monkey King Junior', native_name: null, media: 'anime' },
    ),
  );

  // Alias ditulis langsung: jalur impor dataset belum membawa daftar alias
  // (temuan terpisah, dicatat di laporan). Yang diuji di sini adalah sisi
  // pencariannya — `character_aliases.alias_norm` harus benar-benar cocok.
  await sql.query(
    `insert into character_aliases (character_id, alias, script)
     select c.id, 'The Great Sage', 'latin' from characters c where c.slug = 'sun-wukong'`,
  );
});

describe('pencarian berhalaman di atas skema sungguhan', () => {
  it('menemukan karakter lewat nama, dan melaporkan total yang benar', async () => {
    const page = await searchCharacterPage(sql, { query: 'sun wukong' });
    assert.equal(page.total, 1);
    assert.equal(page.rows[0]?.slug, 'sun-wukong');
    assert.equal(page.rows[0]?.verse_name, 'Search Fixture Manga');
    assert.equal(page.rows[0]?.tier_code, '5-B');
    assert.equal(typeof page.rows[0]?.score, 'number');
  });

  it('menemukan lewat nama asli Kanji (native_name)', async () => {
    const page = await searchCharacterPage(sql, { query: '孫悟空' });
    assert.equal(page.total, 1);
    assert.equal(page.rows[0]?.slug, 'sun-wukong');
  });

  it('menemukan lewat alias dan tahan typo ringan', async () => {
    const exact = await searchCharacterPage(sql, { query: 'The Great Sage' });
    assert.equal(exact.rows[0]?.slug, 'sun-wukong');

    // Trigram: satu huruf hilang tetap harus menemukan karakter yang sama
    // (bukan memperkenalkan karakter lain dari verse berbeda).
    const typo = await searchCharacterPage(sql, { query: 'The Great Sag' });
    assert.equal(typo.rows[0]?.slug, 'sun-wukong');
  });

  it('filter media dan verse benar-benar menyaring', async () => {
    // 'fixture' menjangkau kedua karakter lewat **nama verse** (bobot B di
    // search_vector) — satu kueri, dua verse, jadi filter punya sesuatu untuk
    // disaring. Kueri yang memang hanya cocok dengan satu karakter tidak dapat
    // membuktikan filter bekerja.
    const all = await searchCharacterPage(sql, { query: 'fixture' });
    assert.equal(all.total, 2, 'kueri ini menjangkau kedua karakter');

    const manga = await searchCharacterPage(sql, { query: 'fixture', media: 'manga' });
    assert.equal(manga.total, 1);
    assert.equal(manga.rows[0]?.slug, 'sun-wukong');

    const anime = await searchCharacterPage(sql, { query: 'fixture', media: 'anime' });
    assert.equal(anime.total, 1);
    assert.equal(anime.rows[0]?.slug, 'monkey-king-junior');

    const verse = await searchCharacterPage(sql, { query: 'fixture', verseSlug: ANIME_VERSE });
    assert.equal(verse.total, 1);
    assert.equal(verse.rows[0]?.verse_slug, ANIME_VERSE);

    const none = await searchCharacterPage(sql, {
      query: 'fixture',
      media: 'anime',
      verseSlug: MANGA_VERSE,
    });
    assert.equal(none.total, 0);
    assert.deepEqual(none.rows, []);
  });

  it('halaman kosong tetap melaporkan total yang sebenarnya', async () => {
    const beyond = await searchCharacterPage(sql, { query: 'fixture', page: 9, perPage: 20 });
    assert.deepEqual(beyond.rows, []);
    assert.equal(beyond.total, 2, 'total tidak boleh menjadi 0 hanya karena halamannya lewat');

    const first = await searchCharacterPage(sql, { query: 'fixture', page: 1, perPage: 20 });
    assert.equal(first.rows.length, 2);
    assert.equal(first.total, 2);
  });

  it('urutan stabil, sehingga halaman berikutnya tidak mengulang baris', async () => {
    const pageOne = await searchCharacterPage(sql, { query: 'fixture', page: 1, perPage: 20 });
    const repeat = await searchCharacterPage(sql, { query: 'fixture', page: 1, perPage: 20 });
    assert.deepEqual(
      pageOne.rows.map((row) => row.slug),
      repeat.rows.map((row) => row.slug),
      'kueri identik memberi urutan identik',
    );
  });

  it('prefiks pendek dan huruf besar tetap menemukan karakter (jalur autocomplete)', async () => {
    // "su" tidak lolos FTS maupun ambang trigram; tanpa cabang prefiks, kotak
    // saran tidak pernah mengembalikan apa pun untuk satu-dua huruf pertama.
    const prefix = await searchCharacterPage(sql, { query: 'su' });
    assert.equal(prefix.rows[0]?.slug, 'sun-wukong');

    // Needle dinormalisasi: "SuN" harus berperilaku sama dengan "sun".
    const mixedCase = await searchCharacterPage(sql, { query: 'SuN' });
    assert.equal(mixedCase.rows[0]?.slug, 'sun-wukong');
  });

  it('kueri kosong menjawab kosong, bukan seluruh katalog', async () => {
    const empty = await searchCharacterPage(sql, { query: '   ' });
    assert.equal(empty.total, 0);
    assert.deepEqual(empty.rows, []);
  });
});
