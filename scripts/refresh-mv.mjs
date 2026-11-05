#!/usr/bin/env node
/**
 * Menjalankan `scripts/refresh-mv.sql` (CONCURRENTLY, di luar transaksi) dari
 * driver, sehingga jadwal cron tidak bergantung pada psql yang terpasang.
 *
 *   npm run refresh:mv
 *
 * Syarat CONCURRENTLY: setiap MV punya unique index (dijamin docs/schema.sql dan
 * `validate:schema`) dan MV sudah pernah terisi. Keluar 1 bila ada pernyataan
 * refresh yang tidak CONCURRENTLY, atau MV tidak terisi setelah refresh.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

import { DATABASE_SEARCH_PATH, databaseSslOptions } from '../src/lib/db/client.ts';
import { countConcurrentRefreshes, parseSqlStatements } from './lib/sql-file.mjs';

const url = process.env.DATABASE_URL;
if (typeof url !== 'string' || url.trim() === '') {
  console.error('DATABASE_URL belum diisi. Jalankan `npm run refresh:mv` (membaca .env).');
  process.exit(2);
}

const path = fileURLToPath(new URL('./refresh-mv.sql', import.meta.url));
const statements = parseSqlStatements(readFileSync(path, 'utf8'));
const concurrent = countConcurrentRefreshes(statements);
if (concurrent < 3) {
  console.error(
    `refresh-mv.sql hanya memuat ${concurrent} refresh CONCURRENTLY; minimal 3 MV harus di-refresh.`,
  );
  process.exit(1);
}

const sql = postgres(url, {
  max: 1,
  connect_timeout: 15,
  connection: { application_name: 'animebattle-refresh-mv' },
  onnotice: () => {},
  ...databaseSslOptions(),
});

try {
  await sql.unsafe(`set search_path = ${DATABASE_SEARCH_PATH}`);
  for (const statement of statements) {
    await sql.unsafe(statement);
  }

  const views = await sql.unsafe(`
    select matviewname, ispopulated
      from pg_matviews
     where schemaname = 'animebattle'
     order by matviewname
  `);
  const unpopulated = views.filter((row) => !row.ispopulated).map((row) => row.matviewname);
  if (views.length < 3 || unpopulated.length > 0) {
    throw new Error(
      `MV tidak lengkap/terisi: ${views.length} view, belum terisi: ${unpopulated.join(', ') || '-'}`,
    );
  }
  console.log(
    `Refresh CONCURRENTLY selesai: ${views.map((row) => row.matviewname).join(', ')} (${concurrent} refresh).`,
  );
} catch (error) {
  console.error(`REFRESH MV GAGAL: ${error.message}`);
  if (error.code) console.error(`code: ${error.code}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}
