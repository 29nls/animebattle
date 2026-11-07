/**
 * `GET /api/cron/sync` — pemicu terjadwal yang mengerjakan antrian.
 *
 * Ini salah satu dari **dua** berkas di jalur request yang boleh mengimpor
 * `services/ingestion/*` (yang lain: `worker/ingest.ts`, yang bukan route).
 * Pengecualiannya didaftarkan eksplisit di `tools/architecture/zones.mjs`, dan
 * `scripts/check-architecture.mjs` memverifikasi bahwa daftar pengecualian itu
 * tepat selebar ini — bukan pola yang mudah melebar tanpa terlihat.
 *
 * Kenapa endpoint ini berbeda dari route admin: route admin dipicu **pengguna**
 * dan harus segera membalas, sedangkan endpoint ini dipicu penjadwal platform
 * dan memang tempatnya melakukan pekerjaan berat. AC-25 melarang ingestion di
 * jalur request *pengguna*; memaksakan larangan yang sama pada endpoint cron
 * akan membuat tidak ada satu pun tempat sah menjalankannya.
 *
 * Autentikasi: header `Authorization: Bearer <CRON_SECRET>`. Tanpa secret yang
 * terkonfigurasi, endpoint ini **menolak** — gagal tertutup, bukan terbuka.
 *
 * Kegagalan database: sebelum ini, error yang dilempar `getSqlClient()` atau
 * query pertama lolos ke framework dan menghasilkan **HTTP 500 dengan body
 * kosong**. Gejala itu nyata di produksi (run 42089541289: `HTTP 500`, 0 byte,
 * 2,8 detik) dan tidak dapat dibedakan dari crash proses — baik oleh workflow
 * penjadwal maupun oleh operator. Sekarang setiap kegagalan dijawab dengan
 * kontrak galat yang sama seperti route lain: 503 `UNAVAILABLE` untuk gangguan
 * konfigurasi/konektivitas (penjadwal boleh mencoba lagi), 500 `INTERNAL` untuk
 * bug, keduanya ber-body JSON dan tercatat di log server.
 */

import { getSqlClient, isDatabaseUnavailable, DatabaseNotConfiguredError } from '@/lib/db/client.ts';
import { apiError } from '@/lib/errors.ts';
import { logEvent } from '@/lib/observability/logger.ts';
import { reportError } from '@/lib/observability/report-error.ts';
import { secretsMatch } from '@/lib/security/secrets.ts';
import { claimNextPendingJob, markJobCompleted, markJobFailed } from '@/services/queue/job-lifecycle.ts';
import {
  describeJobFailure,
  recordJobFailure,
  runIngestionJob,
} from '@/services/ingestion/pipeline.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Berapa job yang dikerjakan per panggilan; dibatasi agar tidak menabrak batas platform. */
const MAX_JOBS_PER_TICK = 3;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return apiError(
      'UNAVAILABLE',
      'CRON_SECRET belum dikonfigurasi; endpoint ini sengaja gagal tertutup.',
      503,
    );
  }

  // Perbandingan timing-safe, sama seperti guard rute admin: perbandingan string
  // biasa (`!==`) membocorkan panjang/prefiks secret lewat waktu eksekusi.
  const [scheme, ...rest] = (request.headers.get('authorization') ?? '').trim().split(/\s+/);
  if (
    (scheme ?? '').toLowerCase() !== 'bearer' ||
    rest.length === 0 ||
    !secretsMatch(rest.join(' '), secret)
  ) {
    return apiError('UNAUTHORIZED', 'Tidak berwenang.', 401);
  }

  const processed: Array<{ job_id: string; outcome: string }> = [];

  try {
    const sql = getSqlClient();

    for (let i = 0; i < MAX_JOBS_PER_TICK; i += 1) {
      const job = await claimNextPendingJob(sql);
      if (!job) break;

      try {
        const outcome = await runIngestionJob(job, { sql });
        await markJobCompleted(sql, {
          job_id: job.job_id,
          records_found: outcome.records_found,
          records_created: outcome.records_created,
          records_updated: outcome.records_updated,
          records_failed: outcome.records_failed,
          parser_version: outcome.parser_version,
          partial: outcome.records_failed > 0,
        });
        processed.push({
          job_id: job.job_id,
          outcome: outcome.records_failed > 0 ? 'partial' : 'completed',
        });
      } catch (error) {
        const info = describeJobFailure(error);
        logEvent('warn', 'ingestion.job_failed', {
          job_id: job.job_id,
          error_type: info.error_type,
          terminal: info.terminal,
          retry: job.retry_count + 1,
        });
        try {
          await recordJobFailure(sql, job.job_id, info, job.retry_count + 1);
        } catch {
          // Mencatat detail tidak boleh menggagalkan jalur status; baris job tetap
          // diperbarui di bawah sehingga kegagalan tidak hilang diam-diam.
        }
        const after = await markJobFailed(sql, job.job_id, info.message, {
          error_type: info.error_type,
          terminal: info.terminal,
          ...(info.retry_after_seconds === null ? {} : { base_seconds: info.retry_after_seconds }),
        });
        if (info.terminal) {
          await reportError(error, {
            event: 'ingestion.job_failed_terminal',
            job_id: job.job_id,
            error_type: info.error_type,
          });
        }
        processed.push({ job_id: job.job_id, outcome: `${after.status}:${info.error_type}` });
      }
    }
  } catch (error) {
    // Konfigurasi hilang: pesannya operasional (menyebut env yang kurang) dan
    // berguna bagi operator, jadi diteruskan — sama seperti route lain.
    if (error instanceof DatabaseNotConfiguredError) {
      return apiError('UNAVAILABLE', error.message, 503);
    }
    // Gangguan konektivitas/TLS: penjadwal hanya perlu tahu "coba lagi nanti".
    // Detail driver (host, port, pesan SQL) masuk log server, tidak ke respons.
    if (isDatabaseUnavailable(error)) {
      await reportError(error, {
        event: 'ingestion.cron_database_unavailable',
        route: '/api/cron/sync',
      });
      return apiError('UNAVAILABLE', 'Database tidak dapat dihubungi saat ini.', 503);
    }
    await reportError(error, { event: 'ingestion.cron_unexpected', route: '/api/cron/sync' });
    return apiError('INTERNAL', 'Terjadi kesalahan internal.', 500);
  }

  logEvent('info', 'ingestion.cron_tick', { processed: processed.length });
  return Response.json({ processed, count: processed.length });
}
