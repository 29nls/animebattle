/**
 * Uji query baca halaman web di atas **skema sungguhan** (PGlite + docs/schema.sql).
 *
 * Kenapa ada: `tests/ingestion/` membuktikan jalur tulis, tetapi query baca
 * halaman (`src/features/**`) hanya bertemu database di deployment. Itulah cara
 * empat kolom yang tidak ada di `docs/schema.sql` — `sources.url`,
 * `character_abilities.activation_speed`, `statistics.scale_rank`, dan
 * `character_sources.fetched_at` — lolos sampai kontak pertama dengan database
 * terisi (2026-10-10): halaman detail karakter menjawab panel "Database belum
 * terhubung" padahal daftar karakter baik-baik saja.
 *
 * Berkas ini menutup celah itu: satu dataset kecil ditulis lewat jalur produksi
 * (`applyDataset`, bukan INSERT buatan test, supaya trigger tier dan
 * `recompute_completeness` juga berjalan), lalu **setiap query baca** yang
 * dipakai halaman dijalankan terhadapnya — daftar & detail karakter, pencarian
 * FTS/trigram (`search_characters`), daftar & detail verse, atribusi
 * (`character_sources`), dan `battle_dataset` lewat jalur simulasi.
 *
 * Konsekuensi kontrak: menambah kolom ke query halaman tanpa menambahnya ke
 * `docs/schema.sql` (atau sebaliknya) akan gagal di sini, bukan di produksi.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

import type { SqlClient } from '../../src/lib/db/client.ts';
import { loadSourceBySlug } from '../../src/services/ingestion/sources.ts';
import { applyDataset } from '../../src/services/ingestion/upsert.ts';
import type { DatasetEnvelope } from '../../src/services/ingestion/dataset.ts';
import { simulateFromVersions } from '../../src/features/battle/simulate.ts';
import {
  countCharacters,
  listCharacters,
  searchCharacters,
} from '../../src/features/characters/queries.ts';
import {
  getCharacterBySlug,
  listCharacterForms,
  listCharacterSources,
  listFormAbilities,
  listFormResistances,
  listFormStatistics,
} from '../../src/features/characters/detail-queries.ts';
import {
  countVerses,
  getVerseBySlug,
  listVerseCharacters,
  listVerses,
} from '../../src/features/verses/queries.ts';
import type { BattleConditions, RuleSet } from '../../src/services/battle/types.ts';

const resolveDoc = (name: string): string =>
  fileURLToPath(new URL(`../../docs/${name}`, import.meta.url));

const SOURCE_SLUG = 'admin-dataset-import';
const PROVENANCE_URL = 'dataset://web-fixture/1';

const CONDITIONS: BattleConditions = {
  mode: 'standard',
  speed_equalized: false,
  starting_distance_rank: null,
  battlefield: 'neutral',
  knowledge_level: 'partial',
  prep_time: 'none',
  win_condition: 'incapacitation',
};

const ruleSet = JSON.parse(
  readFileSync(new URL('../../src/services/battle/fixtures/rule-set.default.json', import.meta.url), 'utf8'),
) as RuleSet;

function fixtureDataset(): DatasetEnvelope {
  return {
    parser_version: 'dataset-json@1.0.0',
    source_slug: SOURCE_SLUG,
    source_url: PROVENANCE_URL,
    verse: {
      slug: 'fixture-verse',
      name: 'Fixture Verse',
      description: 'Verse sintetis untuk uji query halaman.',
      origin_media: 'manga',
    },
    characters: [
      {
        slug: 'fixture-hero',
        name: 'Fixture Hero',
        native_name: null,
        description: 'Karakter sintetis untuk uji query halaman.',
        classification: 'swordsman',
        origin: 'Fixture Verse',
        media_type: 'manga',
        source_url: PROVENANCE_URL,
        forms: [
          {
            slug: 'first-form',
            name: 'Fixture Hero (First Form)',
            era: 'First arc',
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
            abilities: [
              {
                category_slug: 'time-manipulation',
                slug: 'fixture-time-stop',
                name: 'Time Stop',
                proficiency: 'master',
                evidence_text: 'Menghentikan waktu selama lima detik.',
                confidence: 0.9,
              },
            ],
            resistances: [
              {
                category_slug: 'time-manipulation',
                level: 2,
                evidence_text: 'Menahan manipulasi waktu.',
                confidence: 0.7,
              },
            ],
          },
          {
            slug: 'second-form',
            name: 'Fixture Hero (Second Form)',
            era: 'Final arc',
            description: null,
            form_order: 2,
            is_default: false,
            tier_code: null,
            statistics: [
              {
                metric: 'attack_potency',
                raw_text: 'Large Island level',
                qualifier: 'at_least',
                confidence: 0.85,
                scale_code: 'island',
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

const db = await PGlite.create({ extensions: { pg_trgm, unaccent, pgcrypto } });
let sql: SqlClient;
/** `id` dua form — dipakai jalur simulasi dan diisi sekali di `before`. */
let versionIds: { first: string; second: string };

before(async () => {
  await db.exec(readFileSync(resolveDoc('schema.sql'), 'utf8'));
  await db.exec(readFileSync(resolveDoc('seed.sql'), 'utf8'));
  sql = {
    async query<T>(text: string, params?: readonly unknown[]): Promise<T[]> {
      const result = await db.query(text, params as unknown[]);
      return result.rows as T[];
    },
  };

  // Jalur tulis produksi, bukan INSERT buatan test: trigger tier →
  // `character_versions.tier_id` dan `recompute_completeness()` ikut berjalan.
  const source = await loadSourceBySlug(sql, SOURCE_SLUG);
  assert.ok(source, `sumber ${SOURCE_SLUG} harus ter-seed`);
  const report = await applyDataset(
    {
      sql,
      source,
      jobId: '00000000-0000-0000-0000-0000000000f1',
      parserVersion: 'dataset-json@1.0.0',
      dryRun: false,
      provenanceUrl: PROVENANCE_URL,
    },
    fixtureDataset(),
  );
  assert.equal(report.failed, 0, `impor fixture gagal: ${JSON.stringify(report.failures)}`);

  const versions = await sql.query<{ slug: string; id: string }>(
    `select slug, id from character_versions where slug in ('first-form', 'second-form')`,
  );
  versionIds = {
    first: versions.find((row) => row.slug === 'first-form')!.id,
    second: versions.find((row) => row.slug === 'second-form')!.id,
  };
});

describe('query daftar karakter di atas skema sungguhan', () => {
  it('listCharacters + countCharacters mengembalikan baris impor', async () => {
    const rows = await listCharacters(sql);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.slug, 'fixture-hero');
    assert.equal(rows[0]!.name, 'Fixture Hero');
    assert.equal(await countCharacters(sql), 1);
  });

  it('searchCharacters melewati RPC search_characters (FTS + trigram)', async () => {
    const hits = await searchCharacters(sql, 'fixture hero');
    assert.ok(hits.length >= 1, 'pencarian harus menemukan karakter yang baru diimpor');
    assert.equal(hits[0]!.slug, 'fixture-hero');
    assert.equal(hits[0]!.tier_code, '5-B');
  });
});

describe('query detail karakter di atas skema sungguhan', () => {
  it('getCharacterBySlug + listCharacterForms memuat verse dan tier', async () => {
    const character = await getCharacterBySlug(sql, 'fixture-hero');
    assert.ok(character);
    assert.equal(character.verse_slug, 'fixture-verse');

    const forms = await listCharacterForms(sql, character.id);
    assert.equal(forms.length, 2);
    assert.equal(forms[0]!.slug, 'first-form');
    // Tier diisi trigger dari statistik `metric: 'tier'` — bukan kolom dataset.
    assert.equal(forms[0]!.tier_code, '5-B');
    assert.equal(forms[1]!.tier_code, null);
  });

  it('listFormStatistics memetakan scale_rank dari stat_scales dan sumber dari sources', async () => {
    const statistics = await listFormStatistics(sql, versionIds.first);
    const byMetric = new Map(statistics.map((stat) => [stat.metric, stat]));

    assert.equal(byMetric.get('tier')!.raw_text, '5-B');
    const attackPotency = byMetric.get('attack_potency')!;
    assert.equal(attackPotency.raw_text, 'Island level');
    assert.equal(typeof attackPotency.scale_rank, 'number');
    assert.equal(attackPotency.source_name, 'Admin Dataset Import');
    assert.equal(byMetric.get('speed')!.qualifier, 'possibly');
  });

  it('listFormAbilities membaca properti katalog abilities dan evidence_text', async () => {
    const abilities = await listFormAbilities(sql, versionIds.first);
    assert.equal(abilities.length, 1);
    const ability = abilities[0]!;
    assert.equal(ability.ability_name, 'Time Stop');
    assert.equal(ability.category_slug, 'time-manipulation');
    assert.equal(ability.proficiency, 'master');
    assert.match(ability.evidence ?? '', /Menghentikan waktu/);
    // `activation_speed` milik katalog `abilities`; form pemakai mewarisinya.
    assert.equal(typeof ability.activation_speed, 'string');
  });

  it('listFormResistances membaca level_label dan evidence_text', async () => {
    const resistances = await listFormResistances(sql, versionIds.first);
    assert.equal(resistances.length, 1);
    assert.equal(resistances[0]!.resistance_type_name.length > 0, true);
    assert.equal(resistances[0]!.level, 2);
    assert.equal(resistances[0]!.level_label, 'moderate');
    assert.equal(resistances[0]!.verification_status, 'imported');
    assert.match(resistances[0]!.evidence ?? '', /menahan manipulasi waktu/i);
  });

  it('listCharacterSources menampilkan atribusi yang ditulis pipeline (G3)', async () => {
    const character = await getCharacterBySlug(sql, 'fixture-hero');
    const sources = await listCharacterSources(sql, character!.id);
    assert.equal(sources.length, 1);
    assert.equal(sources[0]!.source_name, 'Admin Dataset Import');
    assert.equal(sources[0]!.source_url, PROVENANCE_URL);
    assert.ok(sources[0]!.fetched_at, 'waktu impor harus terisi (imported_at)');
    assert.equal(sources[0]!.verification_status, 'imported');
  });
});

describe('query halaman verse di atas skema sungguhan', () => {
  it('listVerses + countVerses menghitung karakter dari characters.verse_id', async () => {
    const verses = await listVerses(sql);
    assert.equal(verses.length, 1);
    assert.equal(verses[0]!.slug, 'fixture-verse');
    assert.equal(verses[0]!.character_count, 1);
    assert.equal(verses[0]!.media_type, 'manga');
    assert.equal(await countVerses(sql), 1);
  });

  it('getVerseBySlug + listVerseCharacters memuat tier form default', async () => {
    const verse = await getVerseBySlug(sql, 'fixture-verse');
    assert.ok(verse);
    assert.equal(verse.character_count, 1);

    const characters = await listVerseCharacters(sql, verse.id);
    assert.equal(characters.length, 1);
    assert.equal(characters[0]!.slug, 'fixture-hero');
    assert.equal(characters[0]!.tier_code, '5-B');
  });
});

describe('jalur pertarungan di atas skema sungguhan', () => {
  it('simulateFromVersions memuat kedua sisi lewat battle_dataset', async () => {
    // Tidak melempar sudah membuktikan `battle_dataset(uuid[])` cocok dengan
    // baris yang ditulis pipeline; kelengkapan metrik tetap milik uji engine.
    const result = await simulateFromVersions(sql, {
      side_a_version_id: versionIds.first,
      side_b_version_id: versionIds.second,
      conditions: CONDITIONS,
      rule_set: ruleSet,
    });
    assert.ok(['a', 'b', 'draw', 'insufficient_data'].includes(result.winner));
    assert.equal(typeof result.input_hash, 'string');
  });
});
