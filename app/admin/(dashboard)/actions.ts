'use server';

/**
 * Server action panel admin.
 *
 * Autentikasi berasal dari sesi Supabase yang sudah diverifikasi guard, bukan
 * sesi Supabase. `actor_id` audit dan `created_by` job selalu diambil dari sesi;
 * body form tidak boleh menentukan siapa pelakunya.
 *
 * Jalur request tetap hanya menulis antrian/staging. Tidak ada fetch, parse,
 * atau upsert ingestion di sini (AC-25).
 */

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getSqlClient, isDatabaseUnavailable } from '@/lib/db/client.ts';
import { FixedWindowRateLimiter } from '@/lib/security/rate-limiter.ts';
import { hashIp, requestIp } from '@/lib/security/ip-hash.ts';
import {
  getAdminAuth,
  type AdminAccessLevel,
  type AdminIdentity,
} from '@/features/admin/auth.ts';
import { redirectForAuthFailure } from '@/features/admin/session.ts';
import { recordAdminAudit } from '@/features/admin/audit.ts';
import { enqueueIngestionJob, retryIngestionJob, cancelIngestionJob } from '@/services/queue/ingestion-jobs.ts';
import {
  ImportRequestError,
  resolveImportUrlSource,
  stageDatasetImport,
} from '@/features/admin/import-requests.ts';

const actionLimiter = new FixedWindowRateLimiter(30, 60_000, () => Date.now());

interface ActionContext {
  identity: AdminIdentity;
  ipHash: string | null;
}

async function requireAction(minimum: AdminAccessLevel = 'editor'): Promise<ActionContext> {
  const auth = await getAdminAuth(minimum);
  if (!auth.ok) redirectForAuthFailure(auth);

  if (!actionLimiter.check(auth.identity.userId).allowed) {
    redirect('/admin/ingestion?state=rate_limited');
  }

  const headerBag = await headers();
  return { identity: auth.identity, ipHash: hashIp(requestIp(headerBag)) };
}

function failureState(error: unknown): string {
  return isDatabaseUnavailable(error) ? 'db_unavailable' : 'failed';
}

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
  const context = await requireAction();
  await respondWith(async () => {
    const sql = getSqlClient();
    const job = await enqueueIngestionJob(sql, {
      scope: 'scheduled_full',
      priority: 3,
      created_by: context.identity.userId,
    });
    await recordAdminAudit(sql, {
      actorId: context.identity.userId,
      action: 'ingestion.run',
      entityType: 'ingestion_job',
      entityId: job.job_id,
      params: { scope: 'scheduled_full' },
      ipHash: context.ipHash,
    });
    return `state=sync_queued&job=${job.job_id}`;
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
  const context = await requireAction();
  const url = String(formData.get('url') ?? '').trim();
  if (!isHttpUrl(url)) {
    redirect('/admin/ingestion?state=invalid_url');
  }

  await respondWith(async () => {
    const sql = getSqlClient();
    try {
      const resolved = await resolveImportUrlSource(sql, url);
      const job = await enqueueIngestionJob(sql, {
        scope: 'import_url',
        target_ref: url,
        source_id: resolved.source_id,
        priority: 4,
        created_by: context.identity.userId,
      });
      await recordAdminAudit(sql, {
        actorId: context.identity.userId,
        action: 'ingestion.import',
        entityType: 'ingestion_job',
        entityId: job.job_id,
        params: { mode: 'url', target_ref: url, source_id: resolved.source_id },
        ipHash: context.ipHash,
      });
      return `state=url_queued&job=${job.job_id}`;
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
  const context = await requireAction();

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
    const sql = getSqlClient();
    try {
      const staged = await stageDatasetImport(sql, parsed, {
        dryRun,
        createdBy: context.identity.userId,
      });
      await recordAdminAudit(sql, {
        actorId: context.identity.userId,
        action: 'ingestion.import',
        entityType: 'ingestion_job',
        entityId: staged.job_id,
        params: { mode: 'dataset', dry_run: dryRun },
        ipHash: context.ipHash,
      });
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
  const context = await requireAction();
  const id = String(formData.get('job_id') ?? '');
  await respondWith(async () => {
    const sql = getSqlClient();
    const updated = await retryIngestionJob(sql, id);
    if (updated) {
      await recordAdminAudit(sql, {
        actorId: context.identity.userId,
        action: 'ingestion.retry',
        entityType: 'ingestion_job',
        entityId: id,
        params: { job_id: id },
        ipHash: context.ipHash,
      });
    }
    return `state=${updated ? 'job_requeued' : 'job_not_retryable'}`;
  });
}

/** [Cancel] per baris job. */
export async function cancelJobAction(formData: FormData): Promise<void> {
  const context = await requireAction();
  const id = String(formData.get('job_id') ?? '');
  await respondWith(async () => {
    const sql = getSqlClient();
    const updated = await cancelIngestionJob(sql, id);
    if (updated) {
      await recordAdminAudit(sql, {
        actorId: context.identity.userId,
        action: 'ingestion.cancel',
        entityType: 'ingestion_job',
        entityId: id,
        params: { job_id: id },
        ipHash: context.ipHash,
      });
    }
    return `state=${updated ? 'job_cancelled' : 'job_not_cancellable'}`;
  });
}
