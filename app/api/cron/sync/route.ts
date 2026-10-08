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
 */

import { getSqlClient } from '@/lib/db/client.ts';
import { apiError } from '@/lib/errors.ts';
import { secretsMatch } from '@/lib/security/admin-guard.ts';
import { claimNextPendingJob, markJobCompleted, markJobFailed } from '@/services/queue/job-lifecycle.ts';
import { runIngestionJob } from '@/services/ingestion/pipeline.ts';

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

  const sql = getSqlClient();
  const processed: Array<{ job_id: string; outcome: string }> = [];

  for (let i = 0; i < MAX_JOBS_PER_TICK; i += 1) {
    const job = await claimNextPendingJob(sql);
    if (!job) break;

    try {
      const outcome = await runIngestionJob(job);
      await markJobCompleted(sql, {
        job_id: job.job_id,
        records_found: outcome.records_found,
        records_created: outcome.records_created,
        records_updated: outcome.records_updated,
        records_failed: outcome.records_failed,
        parser_version: null,
        partial: outcome.records_failed > 0,
      });
      processed.push({ job_id: job.job_id, outcome: 'completed' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const after = await markJobFailed(sql, job.job_id, message);
      processed.push({ job_id: job.job_id, outcome: after.status });
    }
  }

  return Response.json({ processed, count: processed.length });
}
