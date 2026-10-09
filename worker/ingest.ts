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
 *
 * Kegagalan dicatat dua kali dengan sengaja: `ingestion_errors` menyimpan
 * detail yang dibaca admin (error_type, HTTP status, pesan, payload kecil),
 * sedangkan `ingestion_jobs` menyimpan status, retry_count, dan jadwal percobaan
 * berikutnya. Satu tabel tidak dapat melayani keduanya dengan baik.
 */

import { getSqlClient } from '../src/lib/db/client.ts';
import {
  claimNextPendingJob,
  markJobCompleted,
  markJobFailed,
} from '../src/services/queue/job-lifecycle.ts';
import { describeJobFailure, recordJobFailure, runIngestionJob } from '../src/services/ingestion/pipeline.ts';

async function main(): Promise<number> {
  const sql = getSqlClient();

  const job = await claimNextPendingJob(sql);
  if (!job) {
    process.stdout.write('tidak ada job pending\n');
    return 0;
  }

  try {
    const outcome = await runIngestionJob(job, { sql });
    // Status `partial` disimpan apa adanya: job yang sebagian gagal tidak boleh
    // dilaporkan sebagai sukses penuh (PRD §3, status job).
    await markJobCompleted(sql, {
      job_id: job.job_id,
      records_found: outcome.records_found,
      records_created: outcome.records_created,
      records_updated: outcome.records_updated,
      records_failed: outcome.records_failed,
      parser_version: outcome.parser_version,
      partial: outcome.records_failed > 0,
    });
    process.stdout.write(
      `job ${job.job_id} selesai${outcome.dry_run ? ' (dry-run)' : ''}: ${JSON.stringify(outcome)}\n`,
    );
    return 0;
  } catch (error) {
    const info = describeJobFailure(error);
    try {
      await recordJobFailure(sql, job.job_id, info, job.retry_count + 1);
    } catch (recordError) {
      process.stderr.write(
        `job ${job.job_id}: gagal mencatat ingestion_errors: ${recordError instanceof Error ? recordError.message : String(recordError)}\n`,
      );
    }

    const after = await markJobFailed(sql, job.job_id, info.message, {
      error_type: info.error_type,
      terminal: info.terminal,
      // Retry-After dari sumber dipakai sebagai jeda dasar bila ada; kalau tidak,
      // backoff eksponensial bawaan yang berlaku.
      ...(info.retry_after_seconds === null ? {} : { base_seconds: info.retry_after_seconds }),
    });
    process.stderr.write(
      `job ${job.job_id} gagal (${after.status}, ${info.error_type}, percobaan ${after.retry_count}): ${info.message}\n`,
    );
    // Status keluar 1 hanya untuk kegagalan terminal; kegagalan yang masih punya
    // jatah retry tidak boleh membuat supervisor menganggap job ini mati.
    return after.status === 'failed' ? 1 : 0;
  }
}

// Status keluar menentukan apakah supervisor harus mencoba lagi; jangan pernah
// menelan kegagalan di sini. Konfigurasi yang hilang (tanpa `DATABASE_URL`)
// dilaporkan sebagai satu baris yang dapat dibaca operator, bukan stack trace
// panjang: penyebabnya konfigurasi, bukan bug.
try {
  process.exitCode = await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`worker tidak dapat mulai: ${message}\n`);
  process.exitCode = 2;
}
