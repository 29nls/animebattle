#!/usr/bin/env node
/**
 * Menerapkan migrasi berversi ke database dari keadaan kosong (atau melanjutkan
 * yang sudah terpasang).
 *
 *   DATABASE_URL=... node --env-file-if-exists=.env scripts/migrate.mjs
 *   npm run migrate
 *   npm run migrate -- --status
 *
 * Kenapa ada: `create or replace` / `add column if not exists` yang dijalankan
 * manual tidak punya urutan, tidak punya checksum, dan tidak dapat dibuktikan
 * sama dengan `docs/schema.sql`. Runner ini mencatat setiap versi di
 * `animebattle.schema_migrations`, menolak migrasi yang isinya berubah setelah
 * diterapkan, dan memakai advisory lock agar dua deploy tidak berlomba.
 *
 * Migrasi TIDAK boleh memuat `begin;`/`commit;` sendiri — runner membungkus tiap
 * berkas dalam satu transaksi. Berkas di `migrations/` immutable setelah rilis.
 *
 * Keluar: 0 sukses · 1 gagal · 2 DATABASE_URL tidak ada.
 */
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

import { DATABASE_SEARCH_PATH, databaseSslOptions } from '../src/lib/db/client.ts';
import { listMigrations } from './lib/migrations.mjs';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
const statusOnly = process.argv.includes('--status');

const url = process.env.DATABASE_URL;
if (typeof url !== 'string' || url.trim() === '') {
  console.error(
    'DATABASE_URL belum diisi. Jalankan `npm run migrate` (membaca .env) atau ' +
      '`DATABASE_URL=postgres://... node scripts/migrate.mjs`.',
  );
  process.exit(2);
}

let migrations;
try {
  migrations = listMigrations(MIGRATIONS_DIR);
} catch (error) {
  console.error(`Migrasi tidak dapat dibaca: ${error.message}`);
  process.exit(1);
}

const sql = postgres(url, {
  max: 1,
  connect_timeout: 15,
  connection: { application_name: 'animebattle-migrate' },
  onnotice: () => {},
  ...databaseSslOptions(),
});

let locked = false;
let exitCode = 0;

try {
  await sql.unsafe('create schema if not exists animebattle');
  await sql.unsafe(`
    create table if not exists animebattle.schema_migrations (
      version    text primary key,
      checksum   text not null,
      applied_at timestamptz not null default now()
    )`);
  await sql.unsafe("select pg_advisory_lock(hashtext('animebattle_migrations')::bigint)");
  locked = true;

  const appliedRows = await sql.unsafe(
    'select version, checksum, applied_at from animebattle.schema_migrations order by version',
  );
  const applied = new Map(appliedRows.map((row) => [row.version, row]));

  console.log(`DATABASE_URL target : ${new URL(url).hostname}`);
  console.log(`search path aplikasi : ${DATABASE_SEARCH_PATH}`);
  console.log(`migrasi tersedia     : ${migrations.length}`);
  console.log(`sudah diterapkan     : ${applied.size}`);

  if (statusOnly) {
    for (const migration of migrations) {
      const row = applied.get(migration.version);
      const state = row
        ? row.checksum === migration.checksum
          ? 'applied'
          : 'CHECKSUM BERBEDA'
        : 'pending';
      console.log(`  ${migration.version.padEnd(36)} ${state}`);
    }
    process.exitCode = 0;
  } else {
    let changed = 0;
    for (const migration of migrations) {
      const row = applied.get(migration.version);
      if (row) {
        if (row.checksum !== migration.checksum) {
          throw new Error(
            `Migrasi ${migration.version} sudah diterapkan dengan checksum berbeda. ` +
              'Jangan mengubah migrasi yang sudah rilis — buat migrasi baru.',
          );
        }
        continue;
      }

      await sql.begin(async (tx) => {
        // Migrasi 0001 mengatur search_path sendiri; berkas lain mewarisi ini.
        await tx.unsafe(`set local search_path = ${DATABASE_SEARCH_PATH}`);
        await tx.unsafe(migration.sql);
        await tx.unsafe(
          'insert into animebattle.schema_migrations (version, checksum) values ($1, $2)',
          [migration.version, migration.checksum],
        );
      });
      changed += 1;
      console.log(`  applied ${migration.version}`);
    }
    console.log(
      changed === 0
        ? 'Tidak ada migrasi baru — database sudah mutakhir.'
        : `${changed} migrasi diterapkan.`,
    );
  }
} catch (error) {
  console.error(`\nMIGRASI GAGAL: ${error.message}`);
  if (error.code) console.error(`code: ${error.code}`);
  exitCode = 1;
} finally {
  if (locked) {
    await sql.unsafe("select pg_advisory_unlock(hashtext('animebattle_migrations')::bigint)").catch(() => {});
  }
  await sql.end({ timeout: 5 }).catch(() => {});
}

process.exit(exitCode || process.exitCode || 0);
