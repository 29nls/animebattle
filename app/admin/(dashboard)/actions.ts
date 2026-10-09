'use server';

/**
 * Server action panel admin.
 *
 * Semua aksi menjaga kontrak AC-25: jalur request hanya menulis baris antrian
 * (`ingestion_jobs`) atau baris staging (`ingestion_raw_pages`), lalu worker di
 * proses terpisah yang mengerjakannya. Tidak ada fetch, parse, atau upsert di
 * sini — itu sebabnya modul ini **tidak** mengimpor `services/ingestion/*`, dan
 * lint batas arsitektur akan menolak bila suatu saat ada yang menambahkannya.
 *
 * Setiap aksi memanggil `requireSession()` sendiri. Layout sudah menjaga render
 * halaman, tetapi server action adalah endpoint POST tersendiri: tanpa
 * pemeriksaan ini, form yang pernah dirender (atau dipalsukan) dapat dipanggil
 * ulang oleh pemanggil tanpa sesi.
 *
 * Catatan implementasi: `redirect()` dari `next/navigation` bekerja dengan
 * melempar sinyal khusus. Karena itu ia **tidak pernah** dipanggil di dalam
 * `try` — kalau ya, sinyalnya akan tertangkap `catch` dan permintaan yang
 * berhasil akan dilaporkan gagal. Helper `respondWith()` di bawah yang mengatur
 * urutannya.
 */

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getSqlClient, isDatabaseUnavailable } from '@/lib/db/client.ts';
import { FixedWindowRateLimiter } from '@/lib/security/rate-limiter.ts';
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from '@/lib/security/admin-session.ts';
import { enqueueIngestionJob, retryIngestionJob, cancelIngestionJob } from '@/services/queue/ingestion-jobs.ts';
import {
  ImportRequestError,
  resolveImportUrlSource,
  stageDatasetImport,
} from '@/features/admin/import-requests.ts';

const actionLimiter = new FixedWindowRateLimiter(30, 60_000, () => Date.now());

async function requireSession(): Promise<void> {
  const secret = process.env.ADMIN_INGESTION_SECRET;
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value ?? null;
  if (
    typeof secret !== 'string' ||
    secret.trim() === '' ||
    !verifyAdminSessionToken(token, secret, Date.now())
  ) {
    redirect('/admin/login');
  }

  const identity = (await headers()).get('x-forwarded-for')?.trim() || 'admin-action';
  if (!actionLimiter.check(identity).allowed) {
    redirect('/admin/ingestion?state=rate_limited');
  }
}

function failureState(error: unknown): string {
  return isDatabaseUnavailable(error) ? 'db_unavailable' : 'failed';
}

/**
 * Menjalankan pekerjaan lalu mengarahkan kembali dengan `state` yang dapat
 * dibaca halaman. Semua `redirect` terjadi di luar `try`.
 */
async function respondWith(work: () => Promise<string>): Promise<never> {
  let query: string;
  try {
    query = await work();
  } catch (error) {
    query = `state=${failureState(error)}`;
  }
  redirect(`/admin/ingestion?${query}`);
}

/** [Sync Now] — job `scheduled_full`; menerapkan staging terbaru per sumber. */
export async function syncNowAction(): Promise<void> {
  await requireSession();
  await respondWith(async () => {
    await enqueueIngestionJob(getSqlClient(), { scope: 'scheduled_full', priority: 3 });
    return 'state=sync_queued';
  });
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** [Import URL] — antrian `import_url`; worker memeriksa allow-list & robots. */
export async function importUrlAction(formData: FormData): Promise<void> {
  await requireSession();
  const url = String(formData.get('url') ?? '').trim();
  if (!isHttpUrl(url)) {
    redirect('/admin/ingestion?state=invalid_url');
  }

  await respondWith(async () => {
    const sql = getSqlClient();
    try {
      // Allow-list diperiksa sekarang (AC-19) supaya admin tidak menunggu satu
      // putaran worker hanya untuk diberi tahu URL-nya tidak diizinkan; worker
      // tetap memeriksanya lagi sebelum menyentuh jaringan.
      const resolved = await resolveImportUrlSource(sql, url);
      await enqueueIngestionJob(sql, {
        scope: 'import_url',
        target_ref: url,
        source_id: resolved.source_id,
        priority: 4,
      });
      return 'state=url_queued';
    } catch (error) {
      if (error instanceof ImportRequestError) {
        return `state=url_not_allowed&detail=${encodeURIComponent(error.message)}`;
      }
      throw error;
    }
  });
}

/** [Import dataset] — staging + antrian `import_dataset`, opsional dry-run. */
export async function importDatasetAction(formData: FormData): Promise<void> {
  await requireSession();

  const raw = String(formData.get('dataset') ?? '');
  if (raw.trim() === '') {
    redirect('/admin/ingestion?state=empty_dataset');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    redirect(
      `/admin/ingestion?state=invalid_json&detail=${encodeURIComponent(
        error instanceof Error ? error.message : 'JSON tidak sah',
      )}`,
    );
  }

  const dryRun = formData.get('dry_run') === 'on';
  await respondWith(async () => {
    try {
      const staged = await stageDatasetImport(getSqlClient(), parsed, { dryRun });
      return `state=${dryRun ? 'dataset_staged_dry' : 'dataset_staged'}&job=${staged.job_id}`;
    } catch (error) {
      if (error instanceof ImportRequestError) {
        return `state=import_rejected&detail=${encodeURIComponent(error.message)}`;
      }
      throw error;
    }
  });
}

/** [Retry] per baris job. */
export async function retryJobAction(formData: FormData): Promise<void> {
  await requireSession();
  const id = String(formData.get('job_id') ?? '');
  await respondWith(async () => {
    const updated = await retryIngestionJob(getSqlClient(), id);
    return `state=${updated ? 'job_requeued' : 'job_not_retryable'}`;
  });
}

/** [Cancel] per baris job. */
export async function cancelJobAction(formData: FormData): Promise<void> {
  await requireSession();
  const id = String(formData.get('job_id') ?? '');
  await respondWith(async () => {
    const updated = await cancelIngestionJob(getSqlClient(), id);
    return `state=${updated ? 'job_cancelled' : 'job_not_cancellable'}`;
  });
}
