/**
 * Sisi worker dari antrian: klaim, selesai, gagal. Jalur request hanya memanggil
 * `enqueueIngestionJob`; semua pekerjaan status ada di sini.
 *
 * Dua hal yang membuat modul ini layak ditulis hati-hati:
 *
 * 1. **Klaim atomik.** Dua worker yang berjalan bersamaan tidak boleh mengambil
 *    job yang sama. Klaim dilakukan dalam satu pernyataan `update ... where id =
 *    (select ... for update skip locked)` — bukan `select` lalu `update`, yang
 *    selalu punya celah balapan.
 * 2. **Backoff eksponensial dengan batas.** Kegagalan sementara (rate limit,
 *    sumber sedang mati) tidak boleh langsung menjadi `failed`, dan tidak boleh
 *    pula dicoba ulang tanpa jeda sampai membanjiri sumber (PRD §18.5).
 */

import type { SqlClient } from '../../lib/db/client.ts';

/** Nilai enum `ingest_error_t` (docs/schema.sql) — kategori kegagalan PRD §39. */
export type IngestionErrorType =
  | 'ParserError'
  | 'SourceUnavailable'
  | 'RateLimited'
  | 'InvalidData'
  | 'DuplicateCharacter'
  | 'MissingRequiredField'
  | 'ImageUnavailable'
  | 'PolicyBlocked';

export interface ClaimedIngestionJob {
  job_id: string;
  scope: string;
  source_id: string | null;
  target_ref: string | null;
  retry_count: number;
  max_retries: number;
  cursor: Record<string, unknown>;
  dry_run: boolean;
}

export interface BackoffOptions {
  /** Jeda dasar; percobaan ke-n menunggu base × 2ⁿ detik. */
  base_seconds?: number;
  /** Batas atas jeda. Tanpa batas, backoff eksponensial berubah jadi "tidak pernah". */
  max_seconds?: number;
}

/**
 * Mengambil satu job pending dan menandainya `processing`.
 * Mengembalikan `null` bila tidak ada pekerjaan — bukan melempar, karena
 * "tidak ada pekerjaan" adalah keadaan normal, bukan kesalahan.
 */
export async function claimNextPendingJob(sql: SqlClient): Promise<ClaimedIngestionJob | null> {
  const rows = await sql.query<{
    id: string;
    scope: string;
    source_id: string | null;
    target_ref: string | null;
    retry_count: number;
    max_retries: number;
    cursor: Record<string, unknown>;
    dry_run: boolean;
  }>(
    `update ingestion_jobs
        set status = 'processing', started_at = now(), updated_at = now()
      where id = (
              select id
                from ingestion_jobs
               where status = 'pending'
                 and next_attempt_at <= now()
               order by priority, next_attempt_at, created_at
               limit 1
                 for update skip locked
            )
      returning id, scope, source_id, target_ref, retry_count, max_retries, cursor, dry_run`,
  );

  const row = rows[0];
  if (!row) return null;

  return {
    job_id: row.id,
    scope: row.scope,
    source_id: row.source_id,
    target_ref: row.target_ref,
    retry_count: row.retry_count,
    max_retries: row.max_retries,
    cursor: row.cursor,
    dry_run: row.dry_run,
  };
}

export interface MarkJobCompletedInput {
  job_id: string;
  records_found: number;
  records_created: number;
  records_updated: number;
  records_failed: number;
  parser_version: string | null;
  /** `partial` bila sebagian record gagal — status ini ada justru agar tidak dipaksa jadi "sukses". */
  partial?: boolean;
}

export async function markJobCompleted(
  sql: SqlClient,
  input: MarkJobCompletedInput,
): Promise<void> {
  await sql.query(
    `update ingestion_jobs
        set status = $2, completed_at = now(), updated_at = now(),
            records_found = $3, records_created = $4, records_updated = $5, records_failed = $6,
            parser_version = $7
      where id = $1`,
    [
      input.job_id,
      input.partial === true ? 'partial' : 'completed',
      input.records_found,
      input.records_created,
      input.records_updated,
      input.records_failed,
      input.parser_version,
    ],
  );
}

export interface MarkJobFailedResult {
  status: 'pending' | 'failed';
  retry_count: number;
  next_attempt_at: string;
}

/**
 * Mencatat kegagalan. Bila jatah percobaan masih ada, job kembali ke `pending`
 * dengan jeda eksponensial; bila habis, statusnya menjadi `failed` dan
 * `completed_at` diisi (DDL menuntut konsistensi itu lewat CHECK constraint).
 */
export async function markJobFailed(
  sql: SqlClient,
  job_id: string,
  error_message: string,
  options: BackoffOptions & { error_type?: IngestionErrorType; terminal?: boolean } = {},
): Promise<MarkJobFailedResult> {
  const base = options.base_seconds ?? 2;
  const max = options.max_seconds ?? 3600;
  // `terminal` dipakai untuk kegagalan yang tidak akan berubah bila diulang
  // (kebijakan sumber, 401/403, dataset yang tidak sah): mencoba ulang lima kali
  // hanya menunda terlihatnya masalah di dashboard admin.
  const terminal = options.terminal ?? false;

  const rows = await sql.query<{
    status: 'pending' | 'failed';
    retry_count: number;
    next_attempt_at: string;
  }>(
    `update ingestion_jobs
        set status = case when $6::boolean or retry_count + 1 >= max_retries then 'failed'::job_status_t
                          else 'pending'::job_status_t end,
            completed_at = case when $6::boolean or retry_count + 1 >= max_retries then now() else null end,
            updated_at = now(),
            retry_count = retry_count + 1,
            error_message = $2,
            error_type = coalesce($3::ingest_error_t, error_type),
            next_attempt_at = now() + (interval '1 second' * least($4::double precision, power(2, retry_count + 1) * $5::double precision))
      where id = $1
      returning status, retry_count, next_attempt_at`,
    [job_id, error_message.slice(0, 2000), options.error_type ?? null, max, base, terminal],
  );

  const row = rows[0];
  if (!row) {
    throw new Error(`markJobFailed: job ${job_id} tidak ditemukan`);
  }

  return { status: row.status, retry_count: row.retry_count, next_attempt_at: row.next_attempt_at };
}
