/**
 * Migrasi berversi vs snapshot `docs/schema.sql`.
 *
 * Ini gerbang lokal yang sama dengan job CI `database`: menerapkan seluruh
 * migrasi dari nol, lalu membandingkan katalog yang dihasilkan dengan snapshot
 * yang dijalankan di database kosong kedua. Perbedaan sekecil apa pun (tabel,
 * fungsi, policy, RLS, grant) gagal di sini — bukan setelah deploy.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

import { listMigrations, migrationChecksum } from '../../scripts/lib/migrations.mjs';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));
const SCHEMA_PATH = fileURLToPath(new URL('../../docs/schema.sql', import.meta.url));

async function createDb() {
  return PGlite.create({ extensions: { pg_trgm, unaccent, pgcrypto } });
}

async function snapshot(db: PGlite) {
  const tables = (
    await db.query(
      `select c.relname as name
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'animebattle' and c.relkind = 'r'
        order by 1`,
    )
  ).rows.map((row) => row.name as string);

  const matviews = (
    await db.query(
      `select c.relname as name
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'animebattle' and c.relkind = 'm'
        order by 1`,
    )
  ).rows.map((row) => row.name as string);

  const functions = (
    await db.query(
      `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'animebattle'
        order by 1`,
    )
  ).rows.map((row) => row.signature as string);

  const policies = (
    await db.query(
      `select tablename, policyname, cmd, roles::text as roles, qual, with_check
         from pg_policies where schemaname = 'animebattle'
        order by tablename, policyname`,
    )
  ).rows;

  const rls = (
    await db.query(
      `select c.relname as name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'animebattle' and c.relkind = 'r'
        order by 1`,
    )
  ).rows;

  const tablePrivileges = (
    await db.query(
      `select c.relname as name,
              has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
              has_table_privilege('anon', c.oid, 'INSERT') as anon_insert,
              has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select,
              has_table_privilege('authenticated', c.oid, 'INSERT') as auth_insert,
              has_table_privilege('authenticated', c.oid, 'UPDATE') as auth_update,
              has_table_privilege('authenticated', c.oid, 'DELETE') as auth_delete
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'animebattle' and c.relkind in ('r', 'm')
        order by 1`,
    )
  ).rows;

  const routinePrivileges = (
    await db.query(
      `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_execute
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'animebattle'
        order by 1`,
    )
  ).rows;

  const schemaUsage = (
    await db.query(
      `select has_schema_privilege('anon', 'animebattle', 'USAGE') as anon_usage,
              has_schema_privilege('authenticated', 'animebattle', 'USAGE') as auth_usage`,
    )
  ).rows[0];

  return {
    tables,
    matviews,
    functions,
    policies,
    rls,
    tablePrivileges,
    routinePrivileges,
    schemaUsage,
  };
}

describe('migrasi berversi', () => {
  it('tersusun berurutan dan tidak memuat transaksi sendiri', () => {
    const migrations = listMigrations(MIGRATIONS_DIR);
    assert.ok(migrations.length >= 2, 'minimal 0001 + 0002');
    assert.deepEqual(
      migrations.map((migration) => migration.version),
      [...migrations.map((migration) => migration.version)].sort(),
      'versi harus urut',
    );
    for (const migration of migrations) {
      assert.doesNotMatch(
        migration.sql,
        /^\s*(begin|commit);\s*$/m,
        `${migration.version} tidak boleh membuka/menutup transaksi sendiri`,
      );
      assert.ok(migration.checksum.length === 64, `${migration.version} punya checksum sha256`);
    }
  });

  it('checksum stabil terhadap perbedaan CRLF/LF', () => {
    assert.equal(migrationChecksum('select 1;\r\n'), migrationChecksum('select 1;\n'));
  });

  it('hasil seluruh migrasi identik dengan docs/schema.sql (katalog + ACL)', async () => {
    const migrated = await createDb();
    const snapshotDb = await createDb();
    try {
      for (const migration of listMigrations(MIGRATIONS_DIR)) {
        await migrated.exec(migration.sql);
      }
      await snapshotDb.exec(readFileSync(SCHEMA_PATH, 'utf8'));

      const fromMigrations = await snapshot(migrated);
      const fromSnapshot = await snapshot(snapshotDb);

      assert.equal(fromMigrations.tables.length, 39, '39 tabel dasar');
      assert.equal(fromMigrations.matviews.length, 3, '3 materialized view');
      assert.deepEqual(fromMigrations, fromSnapshot);
    } finally {
      await migrated.close();
      await snapshotDb.close();
    }
  });
});
