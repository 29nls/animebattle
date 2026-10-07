#!/usr/bin/env node
/**
 * Entrypoint worker ingestion.
 *
 * Ini salah satu dari **dua** jalur yang boleh mengimpor `services/ingestion/*`
 * (yang lain: `app/api/cron/**`). Dijalankan sebagai proses terpisah dari web
 * (PRD §37.2: beban ingestion dipisah dari beban baca), sehingga pekerjaan yang
 * lambat tidak pernah menahan respons pengguna.
 *
 *   node worker/ingest.ts            # ambil satu job pending lalu keluar
 *
 * Sengaja tanpa framework: satu proses, satu job, keluar. Orkestrasi
 * (penjadwalan, retry, konkurensi) adalah urusan pemanggil — cron platform atau
 * supervisor — bukan urusan binary ini. Itu yang membuatnya dapat diuji ulang.
 */

import { getSqlClient } from '../src/lib/db/client.ts';
import {
  claimNextPendingJob,
  markJobCompleted,
  markJobFailed,
} from '../src/services/queue/job-lifecycle.ts';
import { runIngestionJob } from '../src/services/ingestion/pipeline.ts';

async function main(): Promise<number> {
  const sql = getSqlClient();

  const job = await claimNextPendingJob(sql);
  if (!job) {
    process.stdout.write('tidak ada job pending\n');
    return 0;
  }

  try {
    const outcome = await runIngestionJob(job);
    // Status `partial` disimpan apa adanya: job yang sebagian gagal tidak boleh
    // dilaporkan sebagai sukses penuh (PRD §3, status job).
    await markJobCompleted(sql, {
      job_id: job.job_id,
      records_found: outcome.records_found,
      records_created: outcome.records_created,
      records_updated: outcome.records_updated,
      records_failed: outcome.records_failed,
      parser_version: null,
      partial: outcome.records_failed > 0,
    });
    process.stdout.write(`job ${job.job_id} selesai: ${JSON.stringify(outcome)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const after = await markJobFailed(sql, job.job_id, message, {
      error_type: 'ParserError',
    });
    process.stderr.write(
      `job ${job.job_id} gagal (${after.status}, percobaan ${after.retry_count}): ${message}\n`,
    );
    // Status keluar 1 hanya untuk kegagalan terminal; kegagalan yang masih punya
    // jatah retry tidak boleh membuat supervisor menganggap job ini mati.
    return after.status === 'failed' ? 1 : 0;
  }
}

// Status keluar menentukan apakah supervisor harus mencoba lagi; jangan pernah
// menelan kegagalan di sini.
process.exitCode = await main();
