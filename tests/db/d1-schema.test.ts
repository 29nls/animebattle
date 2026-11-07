/**
 * Skema D1 (`docs/schema.d1.sql`) dijalankan di SQLite sungguhan, lalu jalur
 * baca/tulis produksi dijalankan di atasnya lewat `createD1SqlClient`.
 *
 * Kenapa ada: skema D1 adalah terjemahan mesin dari `docs/schema.sql`, dan
 * terjemahan itu tidak dijaga oleh PGlite mana pun. Tanpa uji ini, satu
 * `CREATE TRIGGER` yang salah kurung atau satu kolom yang lupa dipetakan baru
 * terlihat setelah deploy — di halaman produksi, bukan di CI.
 *
 * Yang diuji sengaja jalur nyata, bukan INSERT buatan test:
 *   1. `applyDataset` (jalur tulis ingestion) → trigger `superseded`, cache
 *      kolom stat, `fp_key`, dan `data_completeness`.
 *   2. Query halaman: daftar & pencarian karakter, daftar verse.
 *   3. Antrian ingestion: enqueue → claim → gagal (backoff) → retry.
 *   4. Rate limit terdistribusi.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DatabaseSync } from 'node:sqlite';

import { createD1SqlClient, type D1DatabaseLike } from '../../src/lib/db/d1.ts';
import { setSqlClient, type SqlClient } from '../../src/lib/db/client.ts';
import { loadSourceBySlug } from '../../src/services/ingestion/sources.ts';
import { applyDataset } from '../../src/services/ingestion/upsert.ts';
import type { DatasetEnvelope } from '../../src/services/ingestion/dataset.ts';
import { countCharacters, listCharacters, searchCharacters } from '../../src/features/characters/queries.ts';
import { countVerses, listVerses } from '../../src/features/verses/queries.ts';
import { enqueueIngestionJob } from '../../src/services/queue/ingestion-jobs.ts';
import { simulateFromVersions } from '../../src/features/battle/simulate.ts';
import { readCachedBattle, saveBattle } from '../../src/features/battle/persistence.ts';
import { listPopularMatchups } from '../../src/features/battle/matchup-queries.ts';
import { loadBattleResult } from '../../src/features/battle/queries.ts';
import {
  countPickerForms,
  listPickerForms,
  loadPickerBootstrap,
} from '../../src/features/battle/picker-queries.ts';
import {
  getCharacterBySlug,
  listCharacterForms,
  listCharacterSources,
  listFormAbilities,
  listFormResistances,
  listFormStatistics,
} from '../../src/features/characters/detail-queries.ts';
import {
  getVerseBySlug,
  listVerseCharacters,
} from '../../src/features/verses/queries.ts';
import {
  getConflictSummary,
  getDashboardSummary,
  getSystemStats,
  listConflicts,
  listIngestionErrors,
  listIngestionJobs,
} from '../../src/features/admin/queries.ts';
import { listAuditLogs, recordAdminAudit } from '../../src/features/admin/audit.ts';
import type { BattleConditions, RuleSet } from '../../src/services/battle/types.ts';
import { claimNextPendingJob, markJobFailed } from '../../src/services/queue/job-lifecycle.ts';
import { checkDistributedRateLimit } from '../../src/lib/security/distributed-rate-limit.ts';

const resolveDoc = (name: string): string =>
  fileURLToPath(new URL(`../../docs/${name}`, import.meta.url));

const SOURCE_SLUG = 'admin-dataset-import';
const PROVENANCE_URL = 'dataset://d1-fixture/1';

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

/**
 * `node:sqlite` sebagai `D1DatabaseLike`.
 *
 * D1 dan `node:sqlite` sama-sama SQLite, jadi stub ini cukup untuk membuktikan
 * bahwa SQL yang dikirim klien dapat dijalankan — bukan sekadar bahwa stringnya
 * berbentuk benar. `all()` dipakai karena itulah satu-satunya metode yang
 * dipanggil `createD1SqlClient`.
 */
function createTestDatabase(): D1DatabaseLike {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(resolveDoc('schema.d1.sql'), 'utf8'));
  db.exec(readFileSync(resolveDoc('seed.d1.sql'), 'utf8'));

  return {
    prepare(text: string) {
      let params: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          params = values;
          return statement;
        },
        async all<T>() {
          const prepared = db.prepare(text);
          const rows =
            params.length > 0 ? prepared.all(...(params as never[])) : prepared.all();
          return { results: rows as T[] };
        },
      };
      return statement;
    },
  };
}

async function withInjectedClient<T>(run: () => Promise<T>): Promise<T> {
  setSqlClient(sql);
  try {
    return await run();
  } finally {
    setSqlClient(null);
  }
}

function fixtureDataset(): DatasetEnvelope {
  return {
    parser_version: 'dataset-json@1.0.0',
    source_slug: SOURCE_SLUG,
    source_url: PROVENANCE_URL,
    license: 'CC BY-SA 4.0 (Fixture Wiki)',
    license_url: 'https://fixture.test/license',
    attribution: 'Angka fixture dikutip dari Fixture Wiki.',
    verse: {
      slug: 'fixture-verse',
      name: 'Fixture Verse',
      description: 'Verse sintetis untuk uji D1.',
      origin_media: 'manga',
    },
    characters: [
      {
        slug: 'fixture-hero',
        name: 'Fixture Hero',
        native_name: null,
        description: 'Karakter sintetis untuk uji D1.',
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
              {
                metric: 'durability',
                raw_text: 'Island level',
                qualifier: 'exact',
                confidence: 0.78,
                scale_code: 'island',
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

let sql: SqlClient;
let versionIds: { first: string; second: string };

before(async () => {
  sql = createD1SqlClient(createTestDatabase());
  assert.equal(sql.dialect, 'sqlite');

  const source = await loadSourceBySlug(sql, SOURCE_SLUG);
  assert.ok(source, `sumber ${SOURCE_SLUG} harus ter-seed di docs/seed.d1.sql`);

  const dataset = fixtureDataset();
  const report = await applyDataset(
    {
      sql,
      source,
      jobId: '00000000-0000-0000-0000-0000000000f1',
      parserVersion: 'dataset-json@1.0.0',
      dryRun: false,
      provenanceUrl: PROVENANCE_URL,
      license: dataset.license,
      license_url: dataset.license_url,
      attribution: dataset.attribution,
    },
    dataset,
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

describe('skema D1: jalur tulis ingestion', () => {
  it('mengisi cache kolom stat dan tier dari trigger statistics', async () => {
    const rows = await sql.query<{
      tier_code: string | null;
      attack_potency_scale: string | null;
      speed_scale: string | null;
      data_completeness: string;
    }>(
      `select t.tier_code,
              ap.scale_code as attack_potency_scale,
              sp.scale_code as speed_scale,
              cv.data_completeness
         from character_versions cv
         left join tiers t on t.id = cv.tier_id
         left join stat_scales ap on ap.id = cv.attack_potency_scale_id
         left join stat_scales sp on sp.id = cv.speed_scale_id
        where cv.slug = 'first-form'`,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.tier_code, '5-B');
    assert.equal(rows[0]!.attack_potency_scale, 'island');
    assert.equal(rows[0]!.speed_scale, 'mftl_plus');
    // `recompute_completeness()` versi SQLite: 3 metrik inti dari 3 baris.
    assert.equal(rows[0]!.data_completeness, 'partial');
  });

  it('menghitung fp_key dan data_completeness karakter', async () => {
    const rows = await sql.query<{ fp_key: string; data_completeness: string }>(
      `select fp_key, data_completeness from characters where slug = 'fixture-hero'`,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.fp_key, 'fixture hero|fixture-verse');
    assert.equal(rows[0]!.data_completeness, 'partial');
  });

  it('menjalankan ulang dataset yang sama tidak menggandakan baris (AC-08)', async () => {
    const before = await sql.query<{ n: number }>('select count(*) as n from statistics');
    const source = await loadSourceBySlug(sql, SOURCE_SLUG);
    const report = await applyDataset(
      {
        sql,
        source: source!,
        jobId: '00000000-0000-0000-0000-0000000000f2',
        parserVersion: 'dataset-json@1.0.0',
        dryRun: false,
        provenanceUrl: PROVENANCE_URL,
        license: 'CC BY-SA 4.0 (Fixture Wiki)',
        license_url: 'https://fixture.test/license',
        attribution: 'Angka fixture dikutip dari Fixture Wiki.',
      },
      fixtureDataset(),
    );
    const after = await sql.query<{ n: number }>('select count(*) as n from statistics');
    assert.equal(report.failed, 0);
    assert.equal(report.created, 0, 'impor kedua tidak boleh membuat baris baru');
    assert.equal(Number(after[0]!.n), Number(before[0]!.n));
  });
});

describe('skema D1: query halaman', () => {
  it('listCharacters + countCharacters membaca baris impor', async () => {
    const rows = await listCharacters(sql);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.slug, 'fixture-hero');
    assert.equal(await countCharacters(sql), 1);
  });

  it('searchCharacters memakai jalur SQLite (tanpa FTS/trigram)', async () => {
    const hits = await searchCharacters(sql, 'fixture hero');
    assert.ok(hits.length >= 1, 'pencarian harus menemukan karakter yang baru diimpor');
    assert.equal(hits[0]!.slug, 'fixture-hero');
    assert.equal(hits[0]!.tier_code, '5-B');
  });

  it('listVerses + countVerses memuat verse impor', async () => {
    const verses = await listVerses(sql);
    assert.ok(verses.some((verse) => verse.slug === 'fixture-verse'));
    assert.equal(await countVerses(sql), 1);
  });
});

describe('skema D1: antrian ingestion', () => {
  it('enqueue → claim → gagal → backoff', async () => {
    const enqueued = await enqueueIngestionJob(sql, { scope: 'single_character', target_ref: 'fixture-hero' });
    assert.equal(enqueued.status, 'pending');

    const claimed = await claimNextPendingJob(sql);
    assert.ok(claimed, 'job yang baru masuk harus dapat diklaim');
    assert.equal(claimed.job_id, enqueued.job_id);
    assert.deepEqual(claimed.cursor, {});
    assert.equal(claimed.dry_run, false);

    await markJobFailed(sql, enqueued.job_id, 'parser meledak', { error_type: 'ParserError' });

    const rows = await sql.query<{ status: string; retry_count: number; next_attempt_at: string }>(
      `select status, retry_count, next_attempt_at from ingestion_jobs where id = $1`,
      [enqueued.job_id],
    );
    assert.equal(rows[0]!.status, 'pending');
    assert.equal(Number(rows[0]!.retry_count), 1);
    assert.ok(rows[0]!.next_attempt_at > new Date().toISOString(), 'backoff harus menunda percobaan berikutnya');
  });
});

describe('skema D1: rate limit terdistribusi', () => {
  it('menghitung jendela tetap dan menolak setelah batas', async () => {
    const options = { scope: 'd1-smoke', limit: 2, windowMs: 60_000, nowMs: 1_700_000_000_000 };
    const first = await checkDistributedRateLimit(sql, 'd1-smoke:ip', options);
    assert.equal(first.allowed, true);
    assert.equal(first.remaining, 1);

    const second = await checkDistributedRateLimit(sql, 'd1-smoke:ip', options);
    assert.equal(second.allowed, true);
    assert.equal(second.remaining, 0);

    const third = await checkDistributedRateLimit(sql, 'd1-smoke:ip', options);
    assert.equal(third.allowed, false);
    assert.ok(third.retryAfterMs > 0);
  });
});

describe('skema D1: query detail karakter & verse', () => {
  it('getCharacterBySlug + listCharacterForms memuat verse dan tier', async () => {
    const character = await getCharacterBySlug(sql, 'fixture-hero');
    assert.ok(character, 'karakter hasil impor harus dapat dibaca');
    assert.equal(character.verse_slug, 'fixture-verse');

    const forms = await listCharacterForms(sql, character.id);
    assert.equal(forms.length, 2);
    assert.equal(forms[0]!.slug, 'first-form');
    assert.equal(forms[0]!.tier_code, '5-B');
  });

  it('listFormStatistics memetakan skala dan sumber', async () => {
    const stats = await listFormStatistics(sql, versionIds.first);
    // Tiga metrik dataset + satu baris `tier` yang ditulis pipeline dari tier_code.
    assert.equal(stats.length, 4);
    const attack = stats.find((row) => row.metric === 'attack_potency');
    assert.ok(attack);
    assert.equal(attack.scale_rank, 14);
    assert.equal(attack.raw_text, 'Island level');
  });

  it('listFormAbilities + listFormResistances membaca katalog', async () => {
    const abilities = await listFormAbilities(sql, versionIds.first);
    assert.equal(abilities.length, 1);
    assert.equal(abilities[0]!.ability_name, 'Time Stop');
    assert.equal(abilities[0]!.proficiency, 'master');

    const resistances = await listFormResistances(sql, versionIds.first);
    assert.equal(resistances.length, 1);
    assert.equal(resistances[0]!.level, 2);
  });

  it('listCharacterSources menampilkan atribusi yang ditulis pipeline', async () => {
    const character = await getCharacterBySlug(sql, 'fixture-hero');
    const sources = await listCharacterSources(sql, character!.id);
    assert.ok(sources.length >= 1);
    assert.ok(sources.some((row) => row.source_name === 'Admin Dataset Import'));
  });

  it('getVerseBySlug + listVerseCharacters', async () => {
    const verse = await getVerseBySlug(sql, 'fixture-verse');
    assert.ok(verse);
    const rows = await listVerseCharacters(sql, verse!.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.slug, 'fixture-hero');
  });
});

describe('skema D1: jalur pertarungan', () => {
  it('simulateFromVersions memuat dua sisi lewat SQL SQLite, bukan battle_dataset', async () => {
    const result = await simulateFromVersions(sql, {
      side_a_version_id: versionIds.first,
      side_b_version_id: versionIds.second,
      conditions: CONDITIONS,
      rule_set: ruleSet,
    });
    assert.ok(['a', 'b', 'draw', 'insufficient_data'].includes(result.winner));
    assert.ok(Number.isFinite(result.win_probability.a));
    assert.ok(Number.isFinite(result.win_probability.b));
  });

  it('saveBattle + readCachedBattle menyimpan payload utuh dan membaca kembali', async () => {
    const result = await simulateFromVersions(sql, {
      side_a_version_id: versionIds.first,
      side_b_version_id: versionIds.second,
      conditions: CONDITIONS,
      rule_set: ruleSet,
    });

    const saved = await saveBattle(sql, {
      slug: 'fixture-hero/first-form-vs-fixture-hero/second-form',
      sideAVersionId: versionIds.first,
      sideBVersionId: versionIds.second,
      conditions: CONDITIONS,
      ruleSet,
      result,
    });
    assert.ok(saved, 'rule set versi ini ada di seed, jadi hasil harus tersimpan');

    const cached = await readCachedBattle(sql, result.input_hash);
    assert.ok(cached, 'baris yang baru disimpan harus terbaca sebagai cache hit');
    assert.deepEqual(cached.result, result, 'payload dibaca apa adanya, bukan direkonstruksi');

    // Idempoten: simpan ulang tidak menambah baris.
    const again = await saveBattle(sql, {
      slug: 'fixture-hero/first-form-vs-fixture-hero/second-form',
      sideAVersionId: versionIds.first,
      sideBVersionId: versionIds.second,
      conditions: CONDITIONS,
      ruleSet,
      result,
    });
    assert.equal(again?.inserted, false);
    assert.equal(again?.rowId, saved.rowId);
  });

  it('listPopularMatchups membaca view popularitas dari baris tersimpan', async () => {
    const rows = await listPopularMatchups(sql);
    assert.ok(Array.isArray(rows));
    assert.ok(rows.length >= 1, 'hasil yang tersimpan harus muncul di view popularitas');
  });

  it('loadBattleResult memakai database dan mengisi cache', async () => {
    const outcome = await withInjectedClient(() => loadBattleResult({
      valueA: 'fixture-hero/first-form',
      valueB: 'fixture-hero/second-form',
      conditions: CONDITIONS,
      rule_set: ruleSet,
    }));
    assert.equal(outcome.status, 'ok');
    if (outcome.status !== 'ok') throw new Error('tidak mungkin');
    assert.equal(outcome.bundle.source, 'database');
    assert.equal(outcome.bundle.sideA.character.name, 'Fixture Hero');
    assert.equal(outcome.bundle.sideB.form.slug, 'second-form');
  });
});

describe('skema D1: combobox /versus', () => {
  it('listPickerForms + countPickerForms', async () => {
    const group = await listPickerForms(sql, 'fixture-hero');
    assert.ok(group, 'karakter dengan form aktif harus punya grup');
    assert.equal(group.characterName, 'Fixture Hero');
    assert.equal(group.options.length, 2);
    assert.equal(group.options[0]!.value, 'fixture-hero/first-form');
    assert.equal(await countPickerForms(sql), 2);
    assert.equal(await listPickerForms(sql, 'tidak-ada'), null);
  });

  it('loadPickerBootstrap tidak mengangkut katalog', async () => {
    const bootstrap = await withInjectedClient(() =>
      loadPickerBootstrap('fixture-hero/first-form', ''),
    );
    assert.equal(bootstrap.source, 'database');
    assert.equal(bootstrap.totalForms, 2);
    assert.equal(bootstrap.initialA?.value, 'fixture-hero/first-form');
    assert.equal(bootstrap.initialB, null);
  });
});

describe('skema D1: indeks unik yang diporting dari Postgres', () => {
  /**
   * Kelima indeks ini unik di `docs/schema.sql` tetapi mudah hilang saat
   * diterjemahkan: empat di antaranya parsial/berbasis ekspresi, dan satu
   * (`uq_hax_interactions`) memakai `coalesce` untuk menyamakan NULL. Tanpa
   * mereka, seed ulang menggandakan aturan hax dan `applyDataset` bisa menulis
   * dua baris "current" untuk metrik yang sama — keduanya merusak hasil battle
   * tanpa error apa pun.
   */
  it('memuat kelima indeks unik, termasuk yang parsial dan berekspresi', async () => {
    const rows = await sql.query<{ name: string }>(
      `select name from sqlite_master where type = 'index' and name in (
         'idx_versions_single_default', 'idx_statistics_current', 'uq_hax_interactions',
         'uq_rule_set_active', 'uq_favorites_target'
       ) order by name`,
    );
    assert.deepEqual(
      rows.map((row) => row.name),
      [
        'idx_statistics_current',
        'idx_versions_single_default',
        'uq_favorites_target',
        'uq_hax_interactions',
        'uq_rule_set_active',
      ],
    );
  });

  it('seed ulang tidak menggandakan baris konfigurasi', async () => {
    const before = await sql.query<{ hax: number; rules: number }>(
      `select (select count(*) from hax_interactions) as hax,
              (select count(*) from battle_rule_sets) as rules`,
    );
    // Seed yang sama dijalankan dua kali seperti `?step=all` yang diulang.
    const seed = readFileSync(resolveDoc('seed.d1.sql'), 'utf8');
    await sql.query(seed);
    await sql.query(seed);
    const after = await sql.query<{ hax: number; rules: number }>(
      `select (select count(*) from hax_interactions) as hax,
              (select count(*) from battle_rule_sets) as rules`,
    );
    assert.deepEqual(after[0], before[0]);
  });
});

describe('skema D1: query admin', () => {
  it('getSystemStats + getDashboardSummary membaca agregat', async () => {
    const stats = await getSystemStats(sql);
    assert.equal(stats.total_characters, 1);
    assert.equal(stats.total_forms, 2);
    assert.equal(stats.total_verses, 1);

    const summary = await getDashboardSummary(sql);
    assert.equal(summary.stats.total_characters, 1);
    assert.equal(typeof summary.pending_jobs, 'number');
    assert.equal(typeof summary.failed_jobs_24h, 'number');
    assert.equal(typeof summary.updated_characters_7d, 'number');
  });

  it('listIngestionJobs + listConflicts + getConflictSummary', async () => {
    const jobs = await listIngestionJobs(sql, { limit: 10 });
    assert.ok(Array.isArray(jobs));
    const conflicts = await listConflicts(sql);
    assert.ok(Array.isArray(conflicts));
    const summary = await getConflictSummary(sql);
    assert.equal(typeof summary.total, 'number');
  });

  it('recordAdminAudit + listAuditLogs menyimpan params sebagai JSON', async () => {
    await sql.query(`insert into users (id, display_name) values ($1, $2)`, [
      '00000000-0000-0000-0000-0000000000a1',
      'Admin Fixture',
    ]);
    await recordAdminAudit(sql, {
      actorId: '00000000-0000-0000-0000-0000000000a1',
      action: 'ingestion.run',
      entityType: 'ingestion_job',
      entityId: null,
      params: { scope: 'character', dry_run: true },
      ipHash: null,
    });

    const rows = await listAuditLogs(sql, { limit: 10 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.actor_name, 'Admin Fixture');
    // `a.after -> 'params'` diterjemahkan menjadi `json_extract(...)`, jadi
    // nilainya objek — bukan string JSON yang akan tampil sebagai teks di UI.
    assert.deepEqual(rows[0]!.params, { scope: 'character', dry_run: true });
  });

  it('listIngestionErrors memakai `= any(...)` yang diterjemahkan ke json_each', async () => {
    const job = await enqueueIngestionJob(sql, { scope: 'single_character', target_ref: 'fixture-hero' });
    await sql.query(
      `insert into ingestion_errors (job_id, source_url, error_type, error_message, http_status, payload, retry_count)
       values ($1, $2, $3, $4, $5, $6::text::jsonb, 0)`,
      [job.job_id, PROVENANCE_URL, 'ParseError', 'gagal', 500, JSON.stringify({ detail: 'x' })],
    );

    const rows = await listIngestionErrors(sql, { jobIds: [job.job_id] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.error_type, 'ParseError');
    assert.deepEqual(rows[0]!.payload, { detail: 'x' });

    // ID yang tidak ada tetap menghasilkan nol baris, bukan galat.
    assert.deepEqual(await listIngestionErrors(sql, { jobIds: [] }), []);
    assert.deepEqual(
      await listIngestionErrors(sql, { jobIds: ['00000000-0000-0000-0000-0000000000ff'] }),
      [],
    );
  });
});
