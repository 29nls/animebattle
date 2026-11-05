#!/usr/bin/env node
/**
 * Postgres lokal untuk uji beban. Bukan bagian runtime produksi.
 *
 * Menjalankan embedded PostgreSQL, menerapkan docs/schema.sql + docs/seed.sql,
 * mengimpor docs/datasets/one-punch-man.json lewat jalur upsert produksi, lalu
 * menulis `.loadtest-env.json` dan menunggu sampai dihentikan.
 *
 *   node scripts/loadtest-db.mjs
 *
 * Membutuhkan `embedded-postgres` dan binary Windows x64 yang dipasang lokal
 * (tidak ditambahkan ke dependencies karena platform-specific).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import EmbeddedPostgres from 'embedded-postgres';
import postgres from 'postgres';

import { applyDataset } from '../src/services/ingestion/upsert.ts';
import { loadSourceBySlug } from '../src/services/ingestion/sources.ts';

const PORT = Number(process.env.LOADTEST_PG_PORT ?? 55432);
const DATABASE = 'animebattle_load';
const url = `postgres://postgres:postgres@127.0.0.1:${PORT}/${DATABASE}`;
const databaseDir = resolve(`.loadtest-pg-${process.pid}`);

const cluster = new EmbeddedPostgres({
  databaseDir,
  user: 'postgres',
  password: 'postgres',
  port: PORT,
  persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  autoRehydrateSymlinks: true,
  onLog: () => {},
  onError: (error) => console.error('[loadtest-pg]', error),
});

let sql;

async function shutdown() {
  if (sql) await sql.end({ timeout: 5 }).catch(() => {});
  await cluster.stop().catch(() => {});
  process.exit(0);
}

try {
  await cluster.initialise();
  await cluster.start();
  await cluster.createDatabase(DATABASE);

  // max: 1 karena docs/schema.sql membuka transaksi sendiri dan dikirim lewat
  // simple query; postgres.js hanya mengizinkannya pada koneksi tunggal.
  sql = postgres(url, { max: 1, connect_timeout: 15, onnotice: () => {} });
  const schema = readFileSync('docs/schema.sql', 'utf8');
  await sql.unsafe(schema).simple();

  const seedRaw = readFileSync('docs/seed.sql', 'utf8');
  const seed = seedRaw.replace(/^\s*begin;\s*/i, '').replace(/\ncommit;\s*$/i, '');
  // `.simple()` menjalankan beberapa pernyataan sekaligus; postgres.js menolak
  // simple query di dalam `sql.begin` (UNSAFE_TRANSACTION). Seed idempoten,
  // jadi jalankan di koneksi yang sama tanpa transaksi pembungkus.
  await sql.unsafe(seed).simple();

  const client = {
    query: async (text, params) => sql.unsafe(text, params),
  };
  const source = await loadSourceBySlug(client, 'admin-dataset-import');
  if (!source) throw new Error('sumber admin-dataset-import tidak ditemukan setelah seed');

  const dataset = JSON.parse(readFileSync('docs/datasets/one-punch-man.json', 'utf8'));
  const report = await applyDataset(
    {
      sql: client,
      source,
      jobId: randomUUID(),
      parserVersion: dataset.parser_version,
      dryRun: false,
      provenanceUrl: dataset.source_url,
      license: dataset.license,
      licenseUrl: dataset.license_url,
      attribution: dataset.attribution,
    },
    dataset,
  );
  if (report.failed > 0) {
    throw new Error(`impor dataset gagal: ${JSON.stringify(report.failures.slice(0, 3))}`);
  }

  const versions = await sql.unsafe(
    `select c.slug as character_slug, cv.slug as form_slug, cv.id
       from character_versions cv
       join characters c on c.id = cv.character_id
      where c.slug in ('saitama', 'genos') and cv.is_default and cv.deleted_at is null
      order by c.slug`,
  );
  const byCharacter = new Map(versions.map((row) => [row.character_slug, row]));
  const saitama = byCharacter.get('saitama');
  const genos = byCharacter.get('genos');
  if (!saitama || !genos) throw new Error('form default Saitama/Genos tidak ditemukan');

  const sides = [
    { character: 'genos', form: genos.form_slug, id: genos.id },
    { character: 'saitama', form: saitama.form_slug, id: saitama.id },
  ].sort((a, b) => `${a.character}/${a.form}`.localeCompare(`${b.character}/${b.form}`));

  const env = {
    base_url: 'http://127.0.0.1:3315',
    version_a: genos.id,
    version_b: saitama.id,
    versus_path: `/versus/${sides[0].character}/${sides[0].form}-vs-${sides[1].character}/${sides[1].form}`,
    dataset_records: report.found,
    dataset_created: report.created,
    dataset_updated: report.updated,
  };
  writeFileSync('.loadtest-env.json', `${JSON.stringify(env, null, 2)}\n`);
  console.log(`READY ${url}`);
  console.log(`VERSUS ${env.versus_path}`);
} catch (error) {
  console.error('loadtest-db GAGAL:', error);
  await shutdown();
  process.exit(1);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
await new Promise(() => {});
