/**
 * `scripts/refresh-mv.sql` dijalankan oleh cron tanpa psql (scripts/refresh-mv.mjs).
 * Test ini mengunci kontrak file: hanya pernyataan sederhana, tidak dibungkus
 * transaksi, dan ketiga MV di-refresh dengan CONCURRENTLY.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  countConcurrentRefreshes,
  parseSqlStatements,
} from '../../scripts/lib/sql-file.mjs';

const sqlFile = readFileSync(
  fileURLToPath(new URL('../../scripts/refresh-mv.sql', import.meta.url)),
  'utf8',
);

describe('scripts/refresh-mv.sql', () => {
  const statements = parseSqlStatements(sqlFile);

  it('membuang meta-command psql dan komentar', () => {
    assert.ok(!sqlFile.includes('\\timing') === false, 'file masih memuat \\timing untuk psql');
    assert.ok(
      statements.every((statement) => !statement.startsWith('\\')),
      'meta-command psql tidak boleh diteruskan ke driver',
    );
    assert.ok(statements.every((statement) => !statement.includes('--')));
  });

  it('memuat tepat 3 refresh CONCURRENTLY + 3 analyze', () => {
    assert.equal(countConcurrentRefreshes(statements), 3);
    assert.equal(statements.length, 6);
    assert.deepEqual(
      statements
        .filter((statement) => /^analyze\s/i.test(statement))
        .map((statement) => statement.replace(/^analyze\s+/i, '')),
      ['mv_battle_popularity', 'mv_verse_tier_distribution', 'mv_character_search'],
    );
  });

  it('tidak dibungkus transaksi (CONCURRENTLY menolak transaksi)', () => {
    assert.doesNotMatch(sqlFile, /^\s*(begin|commit);\s*$/im);
    assert.ok(
      statements.every((statement) => !/^(begin|commit)\b/i.test(statement)),
      'tidak ada begin/commit yang lolos parser',
    );
  });

  it('menyasar ketiga MV yang didefinisikan skema', () => {
    const refreshed = statements
      .filter((statement) => /^refresh\s+materialized\s+view\s+concurrently\s+/i.test(statement))
      .map((statement) => statement.split(/\s+/).at(-1));
    assert.deepEqual(refreshed, [
      'mv_battle_popularity',
      'mv_verse_tier_distribution',
      'mv_character_search',
    ]);
  });
});
