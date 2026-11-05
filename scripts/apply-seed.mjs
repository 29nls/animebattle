#!/usr/bin/env node
/**
 * Menerapkan `docs/seed.sql` (data konfigurasi, bukan karakter) ke database.
 * Idempoten: seluruh insert memakai `on conflict do nothing`.
 *
 *   npm run seed:db
 *
 * Seed bukan migrasi skema: `npm run check:schema-drift` membandingkan objek,
 * bukan baris. CI tetap menerapkannya agar RLS/refresh MV diuji pada data nyata.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

import { DATABASE_SEARCH_PATH, databaseSslOptions } from '../src/lib/db/client.ts';

const url = process.env.DATABASE_URL;
if (typeof url !== 'string' || url.trim() === '') {
  console.error('DATABASE_URL belum diisi. Jalankan `npm run seed:db` (membaca .env).');
  process.exit(2);
}

const seedPath = fileURLToPath(new URL('../docs/seed.sql', import.meta.url));
const raw = readFileSync(seedPath, 'utf8');
const body = raw.replace(/^\s*begin;\s*/i, '').replace(/\ncommit;\s*$/i, '');

const sql = postgres(url, {
  max: 1,
  connect_timeout: 15,
  connection: { application_name: 'animebattle-seed' },
  onnotice: () => {},
  ...databaseSslOptions(),
});

try {
  await sql.unsafe(`set search_path = ${DATABASE_SEARCH_PATH}`);
  await sql.begin(async (tx) => {
    await tx.unsafe(body);
  });
  const [counts] = await sql.unsafe(`
    select (select count(*) from tiers)::int as tiers,
           (select count(*) from ability_categories)::int as ability_categories,
           (select count(*) from hax_interactions)::int as hax_interactions,
           (select count(*) from battle_rule_sets where active)::int as active_rule_sets
  `);
  console.log(
    `Seed diterapkan: ${counts.tiers} tier, ${counts.ability_categories} kategori ability, ` +
      `${counts.hax_interactions} aturan hax, ${counts.active_rule_sets} rule set aktif.`,
  );
} catch (error) {
  console.error(`SEED GAGAL: ${error.message}`);
  if (error.code) console.error(`code: ${error.code}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}
