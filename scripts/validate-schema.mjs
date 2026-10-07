// Validator untuk docs/schema.sql dan docs/seed.sql menggunakan PGlite (Postgres WASM).
// Tujuan: membuktikan DDL benar-benar dapat dijalankan dan constraint/trigger/RPC
// berperilaku seperti yang diklaim di PRD (bukan sekadar "terlihat benar").
//
// Jalankan dari mana saja:
//   npm i -D @electric-sql/pglite
//   node scripts/validate-schema.mjs
//
// Batasan yang diketahui: PGlite adalah Postgres WASM (level PostgreSQL 16),
// sehingga `REFRESH MATERIALIZED VIEW CONCURRENTLY` dan kebijakan RLS berbasis
// klaim Supabase tidak diuji di sini. Sisa skema (tabel, constraint, index,
// trigger, RPC) dieksekusi sungguhan.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const resolveDoc = (name) => fileURLToPath(new URL(`../docs/${name}`, import.meta.url));
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const results = [];
const ok = (name, detail = '') => results.push({ pass: true, name, detail });
const bad = (name, detail = '') => results.push({ pass: false, name, detail });

async function expectError(name, sql, expectedFragment) {
  try {
    await db.exec(sql);
    bad(name, 'seharusnya gagal, tetapi berhasil');
  } catch (err) {
    const msg = String(err.message ?? err);
    if (!expectedFragment || msg.toLowerCase().includes(expectedFragment.toLowerCase())) {
      ok(name, `ditolak: ${msg.split('\n')[0].slice(0, 110)}`);
    } else {
      bad(name, `gagal dengan pesan tak terduga: ${msg.split('\n')[0]}`);
    }
  }
}

const db = await PGlite.create({ extensions: { pg_trgm, unaccent, pgcrypto } });

// ---------------------------------------------------------------- apply schema
function firstLine(err) {
  const raw = String(err?.message ?? err);
  const line = raw.split('\n').find((l) => l.trim().length > 0) ?? raw;
  return line.slice(0, 400);
}

const schemaSql = readFileSync(resolveDoc('schema.sql'), 'utf8');
try {
  await db.exec(schemaSql);
  ok('schema.sql dijalankan');
} catch (err) {
  bad('schema.sql dijalankan', firstLine(err));
  report();
}

// ------------------------------------------------------------------ apply seed
let seedSql = null;
try {
  seedSql = readFileSync(resolveDoc('seed.sql'), 'utf8');
} catch {
  bad('seed.sql ditemukan', 'file tidak ada');
}
if (seedSql) {
  try {
    await db.exec(seedSql);
    ok('seed.sql dijalankan');
  } catch (err) {
    bad('seed.sql dijalankan', firstLine(err));
    report();
  }
}

// ------------------------------------------------------- struktur & konfigurasi
const tableCount = await db.query(
  `select count(*)::int as n from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'`);
const EXPECTED_TABLES = 37;  // dijaga agar sesuai klaim docs/PRD.md §22
if (tableCount.rows[0].n === EXPECTED_TABLES) {
  ok('jumlah tabel', `${tableCount.rows[0].n} tabel dasar (sesuai PRD §22)`);
} else {
  bad('jumlah tabel', `${tableCount.rows[0].n} tabel, PRD §22 mengklaim ${EXPECTED_TABLES}`);
}

const EXPECTED_MVS = ['mv_battle_popularity', 'mv_verse_tier_distribution', 'mv_character_search'];
const mvRows = await db.query(
  `select m.matviewname,
          (select count(*)::int from pg_index i where i.indrelid = c.oid and i.indisunique) as unique_indexes
     from pg_matviews m
     join pg_class c on c.relname = m.matviewname
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = m.schemaname
    where m.schemaname = 'public'
    order by 1`);
const mvNames = mvRows.rows.map((r) => r.matviewname);
if (mvNames.length === 3 && EXPECTED_MVS.every((n) => mvNames.includes(n))) {
  ok('materialized views', mvNames.join(', '));
} else {
  bad('materialized views', `ditemukan ${mvNames.join(', ')}`);
}

// REFRESH MATERIALIZED VIEW CONCURRENTLY mensyaratkan unique index pada setiap MV.
// Wajib agar scripts/refresh-mv.sql benar-benar dapat dijalankan.
const noUnique = mvRows.rows.filter((r) => r.unique_indexes === 0).map((r) => r.matviewname);
if (noUnique.length === 0) ok('setiap MV punya unique index (syarat REFRESH CONCURRENTLY)');
else bad('setiap MV punya unique index (syarat REFRESH CONCURRENTLY)', noUnique.join(', '));

// Verifikasi scripts/refresh-mv.sql hanya menyasar MV yang benar-benar ada.
const refreshSql = readFileSync(fileURLToPath(new URL('./refresh-mv.sql', import.meta.url)), 'utf8');
// Buang komentar SQL lebih dulu, agar kalimat di dalam komentar tidak ikut terpindai.
const refreshSqlExec = refreshSql.replace(/--[^\n]*/g, '');
const refreshed = [...refreshSqlExec.matchAll(/refresh materialized view (?:concurrently )?(\w+)/gi)].map((m) => m[1]);
const unknownMv = refreshed.filter((n) => !mvNames.includes(n));
if (refreshed.length > 0 && unknownMv.length === 0) {
  ok('scripts/refresh-mv.sql menyasar MV yang ada', `${refreshed.length} pernyataan refresh`);
} else {
  bad('scripts/refresh-mv.sql menyasar MV yang ada', `tidak dikenal: ${unknownMv.join(', ') || '(tidak ada pernyataan refresh)'}`);
}

const rlsOff = await db.query(
  `select c.relname from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
    order by 1`);
if (rlsOff.rows.length === 0) ok('RLS aktif di semua tabel');
else bad('RLS aktif di semua tabel', `tanpa RLS: ${rlsOff.rows.map((r) => r.relname).join(', ')}`);

const tiers = await db.query(`select count(*)::int as n, max(numerical_rank)::int as mx from tiers`);
ok('seed tiers', `${tiers.rows[0].n} tier, rank tertinggi ${tiers.rows[0].mx}`);

const wsum = await db.query(
  `select version, public.rule_set_weight_sum(weights) as total from battle_rule_sets where active`);
if (wsum.rows.length === 1 && wsum.rows[0].total === 100) {
  ok('rule set aktif Σbobot = 100', `versi ${wsum.rows[0].version}`);
} else {
  bad('rule set aktif Σbobot = 100', JSON.stringify(wsum.rows));
}

const badSum = await db.query(`
  select public.rule_set_weight_sum(null::jsonb)                                      as n,
         public.rule_set_weight_sum('[]'::jsonb)                                       as arr,
         public.rule_set_weight_sum('{"a": "x"}'::jsonb)                               as str,
         public.rule_set_weight_sum('{"a": 40, "b": 60}'::jsonb)                       as good`);
const bs = badSum.rows[0];
if (bs.n === -1 && bs.arr === -1 && bs.str === -1 && bs.good === 100) {
  ok('rule_set_weight_sum: bentuk tidak valid -> -1, valid -> total');
} else {
  bad('rule_set_weight_sum: bentuk tidak valid -> -1, valid -> total', JSON.stringify(bs));
}

await expectError(
  'rule set dengan Σbobot != 100 ditolak (BC-4)',
  `insert into battle_rule_sets (version, weights, constants)
   values ('9.9.9', '{"tier": 50, "speed": 49}'::jsonb, '{}'::jsonb)`,
  'battle_rule_sets_weights_sum',
);

await expectError(
  'rule set dengan bobot non-numerik ditolak',
  `insert into battle_rule_sets (version, weights, constants)
   values ('9.9.8', '{"tier": "banyak"}'::jsonb, '{}'::jsonb)`,
  'battle_rule_sets_weights_sum',
);

// --------------------------------------------------------------- fixture insert
const src = await db.query(
  `insert into sources (slug, name, base_url, source_type, priority, legal_status,
                        legal_reviewed_at, license, license_url, attribution_text)
   values ('test-source', 'Test Source', 'about:test', 'dataset', 3, 'allowed',
           now(), 'cc-by-4.0', 'https://example.test/license', 'Uji validasi skema')
   returning id`);
const sourceId = src.rows[0].id;
ok('insert source legal_status=allowed');

const seededSource = await db.query(`select id, slug from sources where slug = 'internal-editorial'`);
if (seededSource.rows.length === 1) ok('seed: sumber internal tersedia untuk atribusi record editorial');
else bad('seed: sumber internal', 'tidak ditemukan');

await expectError(
  'source: allowed tanpa license ditolak',
  `insert into sources (slug, name, base_url, source_type, legal_status, legal_reviewed_at)
   values ('bad-src', 'Bad', 'https://x.test', 'wiki', 'allowed', now())`,
  'sources_allowed_requires_license',
);

const verse = await db.query(
  `insert into verses (slug, name, description, origin_media, source_id)
   values ('testverse', 'Testverse', 'Verse sintetis untuk uji skema', 'manga', $1) returning id`,
  [sourceId]);
const verseId = verse.rows[0].id;

await expectError(
  'verse tanpa source_id ditolak (guard_fact_source)',
  `insert into verses (slug, name, origin_media) values ('noverse', 'NoVerse', 'manga')`,
  'source_id wajib',
);

const character = await db.query(
  `insert into characters (slug, name, native_name, description, verse_id, media_type,
                           image_url, image_source, image_license, image_attribution,
                           source_id, source_url, source_name, verification_status)
   values ('testarion', 'Testarion', 'テスト', 'Karakter sintetis untuk uji skema',
           $1, 'manga', null, null, null, null, $2, 'about:editorial', 'Internal Editorial', 'verified')
   returning id, fp_key`,
  [verseId, sourceId]);
const characterId = character.rows[0].id;
ok('insert character + fingerprint', `fp_key=${String(character.rows[0].fp_key).slice(0, 12)}…`);

await expectError(
  'artwork tanpa lisensi ditolak (LP-1)',
  `insert into characters (slug, name, verse_id, image_url, source_id)
   values ('img-bad', 'ImgBad', '${verseId}', 'https://cdn.test/x.png', '${sourceId}')`,
  'characters_image_requires_license',
);

await db.query(
  `insert into character_aliases (character_id, alias, script, is_primary, source_id)
   values ($1, 'Test-kun', 'latin', true, $2),
          ($1, 'テスト', 'kana', false, $2),
          ($1, '테스타리온', 'hangul', false, $2)`,
  [characterId, sourceId]);

const tierRow = await db.query(`select id from tiers where tier_code = '5-B'`);
const tierId = tierRow.rows[0].id;

const versions = await db.query(
  `insert into character_versions (character_id, slug, name, era, form_order, is_default, media_type, tier_id)
   values ($1, 'base', 'Testarion (Base)', 'First arc', 1, true, 'manga', $2),
          ($1, 'peak', 'Testarion (Peak)', 'Final arc', 2, false, 'manga', $2)
   returning id, slug`,
  [characterId, tierId]);
const vBase = versions.rows[0].id;
const vPeak = versions.rows[1].id;
ok('insert 2 form (1 default)');

await expectError(
  'dua form default ditolak (FR-1)',
  `update character_versions set is_default = true where id = '${vPeak}'`,
  'idx_versions_single_default',
);

// ------------------------------------------------------------------- statistik
const apScale = await db.query(
  `select s.id from stat_scales s join stat_scale_metrics m on m.id = s.metric_id
    where m.metric = 'attack_potency' and s.scale_code = 'island'`);
const spScale = await db.query(
  `select s.id from stat_scales s join stat_scale_metrics m on m.id = s.metric_id
    where m.metric = 'speed' and s.scale_code = 'mftl_plus'`);
if (apScale.rows.length && spScale.rows.length) ok('seed stat_scales memuat skala attack_potency & speed');
else bad('seed stat_scales memuat skala attack_potency & speed', 'kode skala tidak ditemukan');

await db.query(
  `insert into statistics (character_version_id, metric, scale_id, raw_text, qualifier, confidence, source_id, status)
   values ($1, 'attack_potency', $2, 'Island level', 'exact', 0.80, $3, 'current'),
          ($1, 'speed',          $4, 'Massively FTL+', 'possibly', 0.72, $3, 'current'),
          ($1, 'tier',           null, '5-B', 'exact', 0.90, $3, 'current')`,
  [vBase, apScale.rows[0].id, sourceId, spScale.rows[0].id]);
ok('insert statistics (termasuk tier)');

await expectError(
  'statistik tanpa source_id ditolak (AC-09)',
  `insert into statistics (character_version_id, metric, raw_text, qualifier, confidence)
   values ('${vBase}', 'durability', 'City level', 'exact', 0.5)`,
  'source_id wajib',
);

const cache = await db.query(
  `select attack_potency_scale_id is not null as ap_cached, speed_scale_id is not null as sp_cached,
          tier_id is not null as tier_cached
     from character_versions where id = $1`, [vBase]);
const c = cache.rows[0];
if (c.ap_cached && c.sp_cached && c.tier_cached) ok('trigger cache stat mengisi kolom character_versions');
else bad('trigger cache stat mengisi kolom character_versions', JSON.stringify(c));

// Superseding: nilai baru dari sumber yang sama -> lama jadi 'superseded', bukan duplikat
await db.query(
  `insert into statistics (character_version_id, metric, scale_id, raw_text, qualifier, confidence, source_id, status)
   values ($1, 'attack_potency', $2, 'Large Island level', 'at_least', 0.85, $3, 'current')`,
  [vBase, apScale.rows[0].id, sourceId]);
const supersede = await db.query(
  `select status, count(*)::int as n from statistics
    where character_version_id = $1 and metric = 'attack_potency' group by status order by status`, [vBase]);
const cur = supersede.rows.find((r) => r.status === 'current')?.n ?? 0;
const sup = supersede.rows.find((r) => r.status === 'superseded')?.n ?? 0;
if (cur === 1 && sup === 1) ok('riwayat stat: 1 current + 1 superseded (tidak menimpa)');
else bad('riwayat stat: 1 current + 1 superseded (tidak menimpa)', JSON.stringify(supersede.rows));

// ------------------------------------------------------- ability & resistensi
const catTime = await db.query(`select id, slug from ability_categories where slug = 'time-manipulation'`);
const catEE = await db.query(`select id, slug from ability_categories where slug = 'existence-erasure'`);
if (catTime.rows.length && catEE.rows.length) ok('seed ability_categories memuat time-manipulation & existence-erasure');
else bad('seed ability_categories', 'kategori tidak ditemukan');

const ability = await db.query(
  `insert into abilities (slug, name, category_id, description, activation_speed, is_offensive, source_id)
   values ('time-stop', 'Time Stop', $1, 'Menghentikan waktu', 'instant', true, $2) returning id`,
  [catTime.rows[0].id, sourceId]);
const resistType = await db.query(
  `select id from resistance_types where category_id = $1`, [catTime.rows[0].id]);

await db.query(
  `insert into character_abilities (character_version_id, ability_id, proficiency, evidence_text, source_id,
                                    verification_status, confidence)
   values ($1, $2, 'master', 'Menghentikan waktu selama 5 detik.', $3, 'verified', 0.9)`,
  [vBase, ability.rows[0].id, sourceId]);
await db.query(
  `insert into character_resistances (character_version_id, resistance_type_id, level, level_label,
                                      evidence_text, source_id, verification_status)
   values ($1, $2, 2, 'moderate', 'Menahan manipulasi waktu.', $3, 'verified')`,
  [vPeak, resistType.rows[0].id, sourceId]);
ok('insert character_abilities + character_resistances');

await expectError(
  'label resistensi yang tidak konsisten ditolak',
  `insert into character_resistances (character_version_id, resistance_type_id, level, level_label,
                                      source_id, verification_status)
   values ('${vBase}', '${resistType.rows[0].id}', 3, 'limited', '${sourceId}', 'verified')`,
  'resist_level_label_consistent',
);

await expectError(
  'resistensi absolute tanpa bukti verified ditolak (RS-3)',
  `insert into character_resistances (character_version_id, resistance_type_id, level, level_label,
                                      source_id, verification_status)
   values ('${vBase}', '${resistType.rows[0].id}', 4, 'absolute', '${sourceId}', 'imported')`,
  'resist_absolute_requires_verified',
);

// ------------------------------------------------------------------- pencarian
async function search(q) {
  const r = await db.query(`select slug, name, score from public.search_characters($1, 10)`, [q]);
  return r.rows;
}
const exact = await search('Testarion');
const typo = await search('Testaroin');
const aliasKanji = await search('テスト');
const aliasHangul = await search('테스타리온');
if (exact[0]?.slug === 'testarion') ok('search: nama persis', `score=${exact[0].score}`);
else bad('search: nama persis', JSON.stringify(exact));
if (typo.length && typo[0].slug === 'testarion') ok('search: typo tolerance (Testaroin)', `score=${typo[0].score}`);
else bad('search: typo tolerance (Testaroin)', JSON.stringify(typo));
if (aliasKanji.length && aliasKanji[0].slug === 'testarion') ok('search: alias kanji (テスト)');
else bad('search: alias kanji (テスト)', JSON.stringify(aliasKanji));
if (aliasHangul.length && aliasHangul[0].slug === 'testarion') ok('search: alias hangul (테스타리온)');
else bad('search: alias hangul (테스타리온)', JSON.stringify(aliasHangul));

const sv = await db.query(`select search_vector is not null as has_sv from characters where id = $1`, [characterId]);
if (sv.rows[0].has_sv) ok('search_vector terisi oleh trigger');
else bad('search_vector terisi oleh trigger');

// ------------------------------------------------------------ dataset & battle
const ds = await db.query(`select public.battle_dataset(array[$1, $2]::uuid[]) as d`, [vBase, vPeak]);
const payload = ds.rows[0].d;
const byId = new Map((payload ?? []).map((e) => [e.version_id, e]));
const sideA = byId.get(vBase);
const sideB = byId.get(vPeak);
const datasetOk =
  payload?.length === 2 &&
  sideA?.abilities?.length === 1 &&
  sideA?.ability_ok !== false &&
  sideA?.metrics?.attack_potency > 0 &&
  sideA?.metrics?.tier === 20 &&
  sideA?.statistics?.some((s) => s.qualifier === 'at_least') &&
  sideB?.resistances?.length === 1 &&
  sideB?.resistances[0].level === 2;
if (datasetOk) {
  ok('RPC battle_dataset: 1 query untuk stats+abilities+resistances+metrics 2 form',
    `formA abilities=${sideA.abilities.length}, formB resistances=${sideB.resistances.length}`);
} else {
  bad('RPC battle_dataset', JSON.stringify({ sideA, sideB }).slice(0, 400));
}

const cond = await db.query(
  `insert into battle_conditions (mode, knowledge_level, prep_time, win_condition, conditions_hash)
   values ('standard', 'partial', 'none', 'incapacitation', 'std-partial-none-q1') returning id`);
const ruleSet = await db.query(`select id, version from battle_rule_sets where active`);
const battle = await db.query(
  `insert into battles (slug, side_a_version_id, side_b_version_id, conditions_id)
   values ('testarion-vs-testarion', $1, $2, $3) returning id`,
  [vBase, vPeak, cond.rows[0].id]);
const br = await db.query(
  `insert into battle_results (battle_id, winner, win_probability_a, win_probability_b, confidence,
                               difficulty, battle_length, primary_reason, input_hash,
                               engine_version, rule_set_version, rule_set_id)
   values ($1, 'a', 0.72, 0.28, 0.81, 'mid', 'medium', 'Speed advantage', 'sha256:testhash',
           'battle-engine@1.0.0', $2, $3) returning id`,
  [battle.rows[0].id, ruleSet.rows[0].version, ruleSet.rows[0].id]);
ok('insert battle + result');

await expectError(
  'probabilitas yang tidak berjumlah 1 ditolak',
  `insert into battle_results (battle_id, winner, win_probability_a, win_probability_b, confidence,
                               difficulty, battle_length, primary_reason, input_hash,
                               engine_version, rule_set_version, rule_set_id)
   values ('${battle.rows[0].id}', 'a', 0.72, 0.50, 0.8, 'mid', 'medium', 'x', 'sha256:bad',
           'battle-engine@1.0.0', '${ruleSet.rows[0].version}', '${ruleSet.rows[0].id}')`,
  'battle_results_probabilities_sum',
);

await expectError(
  'input_hash duplikat ditolak (cache deterministik)',
  `insert into battle_results (battle_id, winner, win_probability_a, win_probability_b, confidence,
                               difficulty, battle_length, primary_reason, input_hash,
                               engine_version, rule_set_version, rule_set_id)
   values ('${battle.rows[0].id}', 'b', 0.28, 0.72, 0.8, 'mid', 'medium', 'y', 'sha256:testhash',
           'battle-engine@1.0.0', '${ruleSet.rows[0].version}', '${ruleSet.rows[0].id}')`,
  'input_hash',
);

const cacheHit = await db.query(`select count(*)::int as n from public.battle_cache_get('sha256:testhash')`);
if (cacheHit.rows[0].n === 1) ok('RPC battle_cache_get menemukan hasil tersimpan');
else bad('RPC battle_cache_get', JSON.stringify(cacheHit.rows));

// ------------------------------------------------------------------- ingestion
const job = await db.query(
  `insert into ingestion_jobs (source_id, scope, status, parser_version, records_found, records_created,
                              started_at, completed_at)
   values ($1, 'manual_run', 'completed', 'parser@1.2.0', 10, 8, now(), now()) returning id`, [sourceId]);

await expectError(
  'job completed tanpa completed_at ditolak',
  `insert into ingestion_jobs (source_id, scope, status) values ('${sourceId}', 'manual_run', 'completed')`,
  'ingestion_jobs_completed_consistency',
);
await db.query(
  `insert into ingestion_errors (job_id, source_url, error_type, error_message, http_status, payload)
   values ($1, 'about:editorial/x', 'ParserError', 'Selector .tier tidak ditemukan', 200, '{"sel": ".tier"}'::jsonb)`,
  [job.rows[0].id]);
ok('insert ingestion job + error');

await expectError(
  'error_type tidak dikenal ditolak',
  `insert into ingestion_errors (job_id, error_type, error_message) values ('${job.rows[0].id}', 'FooError', 'x')`,
  'ingest_error_t'.slice(0, 0) || 'invalid input value for enum',
);

const rawPage = await db.query(
  `insert into ingestion_raw_pages (job_id, source_id, source_url, parsed_json, parser_version, content_hash)
   values ($1, $2, 'about:editorial/x', '{"name":"X"}'::jsonb, 'parser@1.2.0', 'hash1') returning id`,
  [job.rows[0].id, sourceId]);
await expectError(
  'staging: (url, hash, parser_version) sama ditolak (idempotensi)',
  `insert into ingestion_raw_pages (job_id, source_id, source_url, parsed_json, parser_version, content_hash)
   values ('${job.rows[0].id}', '${sourceId}', 'about:editorial/x', '{"name":"X"}'::jsonb, 'parser@1.2.0', 'hash1')`,
  'uq_raw_pages',
);

// -------------------------------------------------------------- MV & pemelihara
try {
  await db.query(`select public.refresh_materialized_views()`);
  const mvPop = await db.query(`select count(*)::int as n from mv_battle_popularity`);
  const mvTier = await db.query(`select count(*)::int as n from mv_verse_tier_distribution`);
  ok('refresh_materialized_views + isi MV', `popularity=${mvPop.rows[0].n}, tierDist=${mvTier.rows[0].n}`);
} catch (err) {
  bad('refresh_materialized_views', String(err.message).split('\n')[0]);
}

try {
  await db.query(`select public.recompute_completeness()`);
  const comp = await db.query(`select data_completeness from character_versions where id = $1`, [vBase]);
  ok('recompute_completeness', `form base = ${comp.rows[0].data_completeness}`);
} catch (err) {
  bad('recompute_completeness', String(err.message).split('\n')[0]);
}

try {
  const drift = await db.query(`select count(*)::int as n from public.reconcile_stat_cache()`);
  ok('reconcile_stat_cache dapat dijalankan', `drift=${drift.rows[0].n}`);
} catch (err) {
  bad('reconcile_stat_cache', String(err.message).split('\n')[0]);
}

try {
  await db.query(`select public.purge_expired_staging()`);
  ok('purge_expired_staging dapat dijalankan');
} catch (err) {
  bad('purge_expired_staging', String(err.message).split('\n')[0]);
}

// ------------------------------------------------------------------- hax rules
const hax = await db.query(
  `select count(*)::int as n from hax_interactions`);
ok('seed hax_interactions', `${hax.rows[0].n} aturan`);
const timeStopRule = await db.query(
  `select relation, effectiveness_multiplier from hax_interactions
    where ability_category_id = $1 and resistance_type_id is not null`, [catTime.rows[0].id]);
if (timeStopRule.rows.length && Number(timeStopRule.rows[0].effectiveness_multiplier) < 1) {
  ok('aturan Time Manipulation vs resistensi tereduksi',
    `${timeStopRule.rows[0].relation} (${timeStopRule.rows[0].effectiveness_multiplier})`);
} else {
  bad('aturan Time Manipulation vs resistensi tereduksi', JSON.stringify(timeStopRule.rows));
}

report();

function report() {
  const failed = results.filter((r) => !r.pass);
  console.log('\n=== Hasil validasi skema ===');
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  console.log(`\nTotal: ${results.length} · lulus ${results.length - failed.length} · gagal ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
}
