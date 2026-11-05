#!/usr/bin/env node
/**
 * Verifikasi dua hal yang TIDAK dapat dibuktikan PGlite:
 *   1. `REFRESH MATERIALIZED VIEW CONCURRENTLY` benar-benar berjalan di luar
 *      transaksi dan MV terisi dari data baru.
 *   2. Kebijakan RLS bereaksi terhadap klaim JWT (`request.jwt.claims`), bukan
 *      hanya "RLS aktif" di katalog.
 *
 * Dijalankan di CI dengan service container Postgres 16, dan dapat dijalankan
 * manual pada staging:
 *
 *   npm run verify:postgres
 *
 * Peringatan: skrip ini menulis fixture kecil (`rls-hero`, `rls-verify-battle`)
 * dan menerapkan `docs/seed.sql` yang idempoten. Jangan arahkan ke produksi
 * kecuali Anda memang ingin fixture itu ada.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

import { DATABASE_SEARCH_PATH, databaseSslOptions } from '../src/lib/db/client.ts';
import { countConcurrentRefreshes, parseSqlStatements } from './lib/sql-file.mjs';

const url = process.env.DATABASE_URL;
if (typeof url !== 'string' || url.trim() === '') {
  console.error('DATABASE_URL belum diisi. Jalankan `npm run verify:postgres` (membaca .env).');
  process.exit(2);
}

const results = [];
const pass = (name, detail = '') => results.push({ pass: true, name, detail });
const fail = (name, detail = '') => results.push({ pass: false, name, detail });
const check = (name, condition, detail = '') => (condition ? pass(name, detail) : fail(name, detail));

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';

const sql = postgres(url, {
  max: 1,
  connect_timeout: 15,
  connection: { application_name: 'animebattle-verify-postgres' },
  onnotice: () => {},
  ...databaseSslOptions(url),
});

/** Jalankan `run` sebagai role + klaim JWT di dalam satu transaksi. */
async function asRole(role, sub, run) {
  return sql.begin(async (tx) => {
    await tx.unsafe("select set_config('request.jwt.claims', $1, true)", [
      sub ? JSON.stringify({ sub, role: 'authenticated' }) : '',
    ]);
    await tx.unsafe(`set local role ${role}`);
    return run(tx);
  });
}

/** Apakah operasi ditolak oleh RLS/permission, bukan gagal karena bug lain? */
async function denied(run) {
  try {
    await run();
    return false;
  } catch (error) {
    return error.code === '42501' || /permission denied|row-level security/i.test(error.message);
  }
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

try {
  await sql.unsafe(`set search_path = ${DATABASE_SEARCH_PATH}`);

  const schemaPresent = await sql.unsafe(
    "select to_regclass('animebattle.characters') is not null as present",
  );
  if (!schemaPresent[0].present) {
    throw new Error('Schema animebattle belum ada. Jalankan `npm run migrate` lebih dulu.');
  }

  // Seed idempoten: konfigurasi minimum untuk tier/rule set.
  // docs/seed.sql membuka/menutup transaksinya sendiri dan diakhiri komentar;
  // kirim apa adanya agar `commit;` tidak hilang saat komentar ikut terbaca.
  const seed = readFileSync(fileURLToPath(new URL('../docs/seed.sql', import.meta.url)), 'utf8');
  await sql.unsafe(seed);

  const tables = await sql.unsafe(
    `select count(*)::int as n from information_schema.tables
      where table_schema = 'animebattle' and table_type = 'BASE TABLE'
        and table_name <> 'schema_migrations'`,
  );
  check('schema animebattle berisi 39 tabel', tables[0].n === 39, `${tables[0].n} tabel`);

  const publicTables = await sql.unsafe(
    `select count(*)::int as n from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  pass('tabel di schema public (informasi)', `${publicTables[0].n} tabel milik aplikasi lain`);

  // auth.uid() Supabase membaca klaim JWT. Stub lokal di docs/schema.sql
  // mengembalikan null; ganti hanya bila belum membaca klaim, supaya skrip ini
  // juga aman dijalankan pada instance dengan auth Supabase asli.
  const uidDef = await sql.unsafe("select pg_get_functiondef('auth.uid()'::regprocedure) as def");
  if (!uidDef[0].def.includes('request.jwt')) {
    await sql.unsafe(`
      create or replace function auth.uid() returns uuid
      language sql stable
      as $fn$
        select ((nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'sub')::uuid
      $fn$;
    `);
  }
  await sql.unsafe('grant usage on schema auth to anon, authenticated');
  await sql.unsafe('grant execute on function auth.uid() to anon, authenticated');

  // ---------------------------------------------------------------- fixtures
  const source = (
    await sql.unsafe("select id from sources where slug = 'internal-editorial'")
  )[0];
  if (!source) throw new Error('Seed kehilangan sumber internal-editorial.');

  const verse = (
    await sql.unsafe(
      `insert into verses (slug, name, origin_media, source_id)
       values ('rls-verse', 'RLS Verse', 'manga', $1)
       on conflict (slug) do update set name = excluded.name
       returning id`,
      [source.id],
    )
  )[0];

  const character = (
    await sql.unsafe(
      `insert into characters (slug, name, verse_id, media_type, source_id, source_url, source_name, verification_status)
       values ('rls-hero', 'RLS Hero', $1, 'manga', $2, 'dataset://rls', 'RLS Fixture', 'verified')
       on conflict (slug) do update set name = excluded.name
       returning id`,
      [verse.id, source.id],
    )
  )[0];

  const tier = (await sql.unsafe("select id from tiers where tier_code = '5-B'"))[0];
  const versions = [];
  for (const [slug, name, order, isDefault] of [
    ['rls-base', 'RLS Hero (Base)', 1, true],
    ['rls-peak', 'RLS Hero (Peak)', 2, false],
  ]) {
    versions.push(
      (
        await sql.unsafe(
          `insert into character_versions (character_id, slug, name, form_order, is_default, media_type, tier_id)
           values ($1, $2, $3, $4, $5, 'manga', $6)
           on conflict (character_id, slug) do update set name = excluded.name
           returning id`,
          [character.id, slug, name, order, isDefault, tier.id],
        )
      )[0],
    );
  }

  await sql.unsafe(
    `insert into character_sources (character_id, source_id, source_url, role)
     values ($1, $2, 'dataset://rls', 'identity')
     on conflict (character_id, source_id, role) do update set source_url = excluded.source_url`,
    [character.id, source.id],
  );

  for (const [id, name] of [
    [USER_A, 'RLS User A'],
    [USER_B, 'RLS User B'],
    [ADMIN, 'RLS Admin'],
  ]) {
    await sql.unsafe(
      `insert into users (id, display_name) values ($1, $2)
       on conflict (id) do update set display_name = excluded.display_name`,
      [id, name],
    );
  }
  await sql.unsafe(
    `insert into user_roles (user_id, role) values ($1, 'admin')
     on conflict (user_id, role) do nothing`,
    [ADMIN],
  );
  for (const [userId, versionId] of [
    [USER_A, versions[0].id],
    [USER_B, versions[1].id],
  ]) {
    await sql.unsafe(
      `insert into favorites (user_id, character_version_id) values ($1, $2)
       on conflict do nothing`,
      [userId, versionId],
    );
  }

  // ------------------------------------------------------------------- RLS
  const anonCharacters = await asRole('anon', null, (tx) =>
    tx.unsafe("select count(*)::int as n from characters where slug = 'rls-hero'"),
  );
  check('anon dapat membaca karakter publik', anonCharacters[0].n === 1);

  check(
    'anon TIDAK dapat membaca sources (admin-only)',
    await denied(() => asRole('anon', null, (tx) => tx.unsafe('select count(*) from sources'))),
  );

  const favoriteRows = await asRole('authenticated', USER_A, (tx) =>
    tx.unsafe('select user_id, character_version_id from favorites order by user_id'),
  );
  check(
    'RLS favorites: user A hanya melihat barisnya sendiri',
    favoriteRows.length === 1 && favoriteRows[0].user_id === USER_A,
    `${favoriteRows.length} baris`,
  );

  check(
    'RLS favorites: A dilarang menulis favorite milik B',
    await denied(() =>
      asRole('authenticated', USER_A, (tx) =>
        tx.unsafe('insert into favorites (user_id, character_version_id) values ($1, $2)', [
          USER_B,
          versions[1].id,
        ]),
      ),
    ),
  );

  const userRows = await asRole('authenticated', USER_A, (tx) =>
    tx.unsafe('select id from users order by id'),
  );
  check(
    'RLS users: hanya diri sendiri yang terlihat',
    userRows.length === 1 && userRows[0].id === USER_A,
    `${userRows.length} baris`,
  );

  const nonAdminSources = await asRole('authenticated', USER_A, (tx) =>
    tx.unsafe('select count(*)::int as n from character_sources'),
  );
  check('RLS character_sources: non-admin melihat 0 baris', nonAdminSources[0].n === 0);

  const adminSources = await asRole('authenticated', ADMIN, (tx) =>
    tx.unsafe('select count(*)::int as n from character_sources'),
  );
  check('RLS character_sources: admin melihat baris atribusi', adminSources[0].n > 0);

  const noClaims = await asRole('authenticated', null, (tx) =>
    tx.unsafe('select count(*)::int as n from favorites'),
  );
  check('RLS fail-closed tanpa klaim JWT: 0 favorite', noClaims[0].n === 0);

  check(
    'fungsi pemeliharaan tidak dapat dieksekusi authenticated',
    await denied(() =>
      asRole('authenticated', USER_A, (tx) => tx.unsafe('select purge_expired_staging()')),
    ),
  );

  const search = await asRole('authenticated', USER_A, (tx) =>
    tx.unsafe("select count(*)::int as n from search_characters('rls', 10)"),
  );
  check('RPC search_characters dapat dieksekusi authenticated', search[0].n >= 1);

  // ------------------------------------------------------- REFRESH CONCURRENTLY
  const ruleSet = (await sql.unsafe('select id, version from battle_rule_sets where active limit 1'))[0];
  if (!ruleSet) throw new Error('Tidak ada rule set aktif; seed gagal?');

  const conditions = (
    await sql.unsafe(
      `insert into battle_conditions (mode, knowledge_level, prep_time, win_condition, conditions_hash)
       values ('standard', 'partial', 'none', 'incapacitation', 'rls-verify-1')
       on conflict (conditions_hash) do update set conditions_hash = excluded.conditions_hash
       returning id`,
    )
  )[0];

  const battle = (
    await sql.unsafe(
      `insert into battles (slug, side_a_version_id, side_b_version_id, conditions_id)
       values ('rls-verify-battle', $1, $2, $3)
       on conflict (side_a_version_id, side_b_version_id, conditions_id)
       do update set slug = excluded.slug
       returning id`,
      [versions[0].id, versions[1].id, conditions.id],
    )
  )[0];

  await sql.unsafe(
    `insert into battle_results
       (battle_id, winner, win_probability_a, win_probability_b, confidence, difficulty,
        battle_length, primary_reason, input_hash, engine_version, rule_set_version, rule_set_id)
     values ($1, 'a', 0.6000, 0.4000, 0.700, 'mid', 'medium', 'fixture RLS',
             'rls-verify-hash', 'battle-engine@1.0.0', $2, $3)
     on conflict (input_hash) do nothing`,
    [battle.id, ruleSet.version, ruleSet.id],
  );

  const refreshStatements = parseSqlStatements(
    readFileSync(fileURLToPath(new URL('./refresh-mv.sql', import.meta.url)), 'utf8'),
  );
  const concurrent = countConcurrentRefreshes(refreshStatements);
  check('refresh-mv.sql memakai CONCURRENTLY untuk 3 MV', concurrent === 3, `${concurrent} pernyataan`);

  for (const statement of refreshStatements) {
    await sql.unsafe(statement);
  }

  const popularity = await sql.unsafe(
    "select simulations from mv_battle_popularity where matchup_key = 'rls-verify-battle'",
  );
  check(
    'REFRESH CONCURRENTLY mengisi mv_battle_popularity dari data baru',
    popularity.length === 1 && Number(popularity[0].simulations) >= 1,
  );

  const searchView = await sql.unsafe(
    "select slug from mv_character_search where slug = 'rls-hero'",
  );
  check('REFRESH CONCURRENTLY mengisi mv_character_search', searchView.length === 1);

  const tierView = await sql.unsafe(
    'select form_count from mv_verse_tier_distribution where verse_id = $1 and tier_id = $2',
    [verse.id, tier.id],
  );
  check('REFRESH CONCURRENTLY mengisi mv_verse_tier_distribution', tierView.length === 1);
} catch (error) {
  fail('verifikasi Postgres berhenti', error.message);
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}

console.log('\n=== Verifikasi Postgres nyata: RLS JWT + REFRESH CONCURRENTLY ===');
for (const result of results) {
  console.log(
    `${result.pass ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`,
  );
}
const failed = results.filter((result) => !result.pass);
console.log(`\nTotal: ${results.length} · lulus ${results.length - failed.length} · gagal ${failed.length}`);
process.exit(failed.length ? 1 : 0);
