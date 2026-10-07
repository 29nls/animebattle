/**
 * Antrian job ingestion — **bukan** bagian dari `services/ingestion`.
 *
 * Kenapa dipisah: PRD §18.1 dan AC-25 menuntut ingestion tidak pernah berjalan di
 * jalur request pengguna. Admin tetap harus bisa memicu sinkronisasi dari UI
 * `/admin`. Jalan tengahnya adalah antrian: jalur request hanya melakukan satu
 * insert, lalu worker (proses terpisah) mengambil dan mengerjakannya. Karena
 * modul ini hanya menulis baris antrian, ia aman diimpor dari route; sedangkan
 * `services/ingestion/*` — yang memuat fetcher, rate limiter, dan parser —
 * dilarang diimpor dari jalur request dan pelarangan itu ditegakkan lint
 * (`tools/architecture/zones.mjs`, zona `request`).
 *
 * Kolom mengikuti DDL nyata: `docs/schema.sql` tabel `ingestion_jobs`. Nama job
 * disimpan pada kolom `scope` (enum `job_scope_t`), bukan kolom rekaan.
 */

// Impor relatif eksplisit `.ts`: modul ini juga dimuat Node langsung oleh worker
// (type stripping), di mana alias `@/` tidak dikenali. Zona "node" di
// tools/architecture/zones.mjs mewajibkan relatif — lihat `npm run lint`.
import type { SqlClient } from '../../lib/db/client.ts';

/** Nilai enum `job_scope_t` (docs/schema.sql). */
export type IngestionJobScope =
  | 'incremental'
  | 'scheduled_full'
  | 'manual_run'
  | 'single_character'
  | 'single_verse'
  | 'reparse'
  | 'import_url'
  | 'import_dataset';

export interface EnqueueIngestionJobInput {
  scope: IngestionJobScope;
  /** Slug, URL, atau nama dataset — apa pun yang diminta admin, disimpan apa adanya untuk audit (PRD §22). */
  target_ref?: string;
  source_id?: string;
  /** 1 = paling tinggi (kolom `priority` dibatasi 1..9 di DDL). */
  priority?: number;
  /** Simulasi tanpa menulis perubahan; wajib tersedia agar admin dapat mencoba dulu. */
  dry_run?: boolean;
  /** Waktu tunda (`next_attempt_at`); default langsung dapat diklaim worker. */
  run_at?: string;
  max_retries?: number;
  /** UUID user; kolom `created_by` sengaja bukan foreign key penegak otorisasi. */
  created_by?: string;
}

export interface EnqueuedIngestionJob {
  job_id: string;
  status: 'pending';
  created_at: string;
}

/**
 * Satu insert, tanpa pekerjaan berat: inilah keseluruhan kontrak jalur request.
 * Tidak ada fetch, tidak ada parse, tidak ada loop — sehingga route tetap
 * memenuhi anggaran latensi PRD §29 dan ingestion tetap off-request (AC-25).
 */
export async function enqueueIngestionJob(
  sql: SqlClient,
  input: EnqueueIngestionJobInput,
): Promise<EnqueuedIngestionJob> {
  const rows = await sql.query<{
    id: string;
    status: 'pending';
    created_at: string;
  }>(
    `insert into ingestion_jobs
       (scope, target_ref, source_id, priority, dry_run, created_by, next_attempt_at, max_retries, status)
     values ($1, $2, $3, coalesce($4, 5), coalesce($5, false), $6, coalesce($7::timestamptz, now()), coalesce($8, 5), 'pending')
     returning id, status, created_at`,
    [
      input.scope,
      input.target_ref ?? null,
      input.source_id ?? null,
      input.priority ?? null,
      input.dry_run ?? null,
      input.created_by ?? null,
      input.run_at ?? null,
      input.max_retries ?? null,
    ],
  );

  const row = rows[0];
  if (!row) {
    // `insert ... returning` selalu menghasilkan baris; ketiadaannya berarti
    // klien melanggar kontrak SqlClient dan itu tidak boleh disembunyikan.
    throw new Error('enqueueIngestionJob: insert tidak mengembalikan baris');
  }

  return { job_id: row.id, status: row.status, created_at: row.created_at };
}
