#!/usr/bin/env node
/**
 * Membandingkan database hasil `pg_dump`/`pg_restore` dengan sumbernya.
 * Dipakai CI setelah restore ke database terpisah (docs/runbooks/backup-restore.md).
 *
 *   SOURCE_DATABASE_URL=... RESTORE_DATABASE_URL=... npm run verify:restore
 *
 * Yang dibandingkan: daftar migrasi (versi + checksum), daftar tabel/MV, jumlah
 * baris setiap tabel, jumlah fungsi, dan jumlah policy. Perbedaan sekecil apa pun
 * membuat exit code 1 — backup yang tidak dapat dipulihkan bukan backup.
 */
import postgres from 'postgres';

import { DATABASE_SEARCH_PATH, databaseSslOptions } from '../src/lib/db/client.ts';

const sourceUrl = process.env.SOURCE_DATABASE_URL;
const restoreUrl = process.env.RESTORE_DATABASE_URL;
if (!sourceUrl || !restoreUrl) {
  console.error('SOURCE_DATABASE_URL dan RESTORE_DATABASE_URL wajib diisi.');
  process.exit(2);
}

function connect(url, name) {
  return postgres(url, {
    max: 1,
    connect_timeout: 15,
    connection: { application_name: `animebattle-verify-restore-${name}` },
    onnotice: () => {},
    ...databaseSslOptions(url),
  });
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function snapshot(sql) {
  await sql.unsafe(`set search_path = ${DATABASE_SEARCH_PATH}`);

  const migrations = await sql.unsafe(
    'select version, checksum from animebattle.schema_migrations order by version',
  );
  const relations = await sql.unsafe(`
    select c.relname as name, c.relkind as kind
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'animebattle' and c.relkind in ('r', 'm')
     order by c.relname
  `);
  const counts = {};
  for (const relation of relations) {
    const [row] = await sql.unsafe(
      `select count(*)::int as n from animebattle.${quoteIdent(relation.name)}`,
    );
    counts[relation.name] = row.n;
  }
  const [functions] = await sql.unsafe(
    `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'animebattle'`,
  );
  const [policies] = await sql.unsafe(
    "select count(*)::int as n from pg_policies where schemaname = 'animebattle'",
  );

  return {
    migrations,
    relations: relations.map((row) => `${row.name}:${row.kind}`),
    counts,
    functions: functions.n,
    policies: policies.n,
  };
}

const failures = [];
function compare(label, source, restored) {
  const left = JSON.stringify(source);
  const right = JSON.stringify(restored);
  if (left === right) {
    console.log(`PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`FAIL  ${label}`);
    console.log(`  sumber : ${left.slice(0, 500)}`);
    console.log(`  restore: ${right.slice(0, 500)}`);
  }
}

const sourceSql = connect(sourceUrl, 'source');
const restoreSql = connect(restoreUrl, 'restore');

try {
  const source = await snapshot(sourceSql);
  const restored = await snapshot(restoreSql);

  compare('jumlah & checksum migrasi', source.migrations, restored.migrations);
  compare('daftar tabel + materialized view', source.relations, restored.relations);
  compare('jumlah baris setiap tabel/MV', source.counts, restored.counts);
  compare('jumlah fungsi', source.functions, restored.functions);
  compare('jumlah policy RLS', source.policies, restored.policies);

  const totalRows = Object.values(source.counts).reduce((sum, n) => sum + n, 0);
  console.log(`\nBaris dibandingkan: ${totalRows} pada ${source.relations.length} relasi.`);
} catch (error) {
  console.error(`VERIFIKASI RESTORE GAGAL: ${error.message}`);
  failures.push('eksekusi');
} finally {
  await sourceSql.end({ timeout: 5 }).catch(() => {});
  await restoreSql.end({ timeout: 5 }).catch(() => {});
}

console.log(
  failures.length === 0
    ? '\nRestore identik dengan sumber.'
    : `\nRESTORE TIDAK IDENTIK: ${failures.join(', ')}`,
);
process.exit(failures.length ? 1 : 0);
