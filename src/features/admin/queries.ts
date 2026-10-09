/**
 * Query admin dashboard. Tidak ada query SQL langsung di komponen; semua lewat
 * sini (PRD §38: satu jalur data).
 *
 * Kolom selalu ditulis eksplisit — tidak ada `select *` — karena halaman admin
 * menampilkan kolom ke UI, dan `no-select-star` menandai tabel besar seperti
 * `characters` dan `statistics`. Kolom baru pada DDL tidak otomatis bocor ke
 * halaman; ia harus ditambahkan dengan sadar.
 */

import type { SqlClient } from '../../lib/db/client.ts';

export interface SystemStats {
  total_characters: number;
  total_forms: number;
  total_verses: number;
  total_abilities: number;
  total_sources: number;
  total_battles: number;
}

export async function getSystemStats(sql: SqlClient): Promise<SystemStats> {
  const rows = await sql.query<{
    total_characters: string;
    total_forms: string;
    total_verses: string;
    total_abilities: string;
    total_sources: string;
    total_battles: string;
  }>(
    `select
       (select count(*)::text from characters) as total_characters,
       (select count(*)::text from character_versions where deleted_at is null) as total_forms,
       (select count(*)::text from verses) as total_verses,
       (select count(*)::text from abilities) as total_abilities,
       (select count(*)::text from sources) as total_sources,
       (select count(*)::text from battle_results) as total_battles`,
  );

  const row = rows[0]!;
  return {
    total_characters: Number(row.total_characters),
    total_forms: Number(row.total_forms),
    total_verses: Number(row.total_verses),
    total_abilities: Number(row.total_abilities),
    total_sources: Number(row.total_sources),
    total_battles: Number(row.total_battles),
  };
}

export interface LastIngestionJob {
  id: string;
  scope: string;
  status: string;
  error_type: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface DashboardSummary {
  stats: SystemStats;
  pending_jobs: number;
  failed_jobs_24h: number;
  open_conflicts: number;
  updated_characters_7d: number;
  last_ingestion: LastIngestionJob | null;
}

/**
 * Ringkasan `/admin` (PRD §25.1). Semua angka berasal dari satu query agregat
 * ditambah satu query "job terakhir" — bukan dihitung di komponen, supaya
 * halaman tidak dapat menampilkan angka yang berbeda dari database.
 */
export async function getDashboardSummary(sql: SqlClient): Promise<DashboardSummary> {
  const stats = await getSystemStats(sql);

  const counts = await sql.query<{
    pending_jobs: string;
    failed_jobs_24h: string;
    open_conflicts: string;
    updated_characters_7d: string;
  }>(
    `select
       (select count(*)::text from ingestion_jobs where status = 'pending') as pending_jobs,
       (select count(*)::text from ingestion_jobs
         where status = 'failed' and created_at > now() - interval '24 hours') as failed_jobs_24h,
       (select count(*)::text from character_source_conflicts where status = 'open') as open_conflicts,
       (select count(*)::text from characters
         where updated_at > now() - interval '7 days') as updated_characters_7d`,
  );

  const lastRows = await sql.query<LastIngestionJob>(
    `select id, scope, status, error_type, created_at, completed_at
       from ingestion_jobs
      order by created_at desc
      limit 1`,
  );

  const row = counts[0]!;
  return {
    stats,
    pending_jobs: Number(row.pending_jobs),
    failed_jobs_24h: Number(row.failed_jobs_24h),
    open_conflicts: Number(row.open_conflicts),
    updated_characters_7d: Number(row.updated_characters_7d),
    last_ingestion: lastRows[0] ?? null,
  };
}

export interface IngestionJobRow {
  id: string;
  scope: string;
  status: string;
  target_ref: string | null;
  source_slug: string | null;
  source_name: string | null;
  dry_run: boolean;
  parser_version: string | null;
  records_found: number;
  records_created: number;
  records_updated: number;
  records_failed: number;
  error_message: string | null;
  error_type: string | null;
  http_status: number | null;
  retry_count: number;
  max_retries: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  next_attempt_at: string;
}

const JOB_COLUMNS = `j.id, j.scope, j.status, j.target_ref,
                     s.slug as source_slug, s.name as source_name,
                     j.dry_run, j.parser_version,
                     j.records_found, j.records_created, j.records_updated, j.records_failed,
                     j.error_message, j.error_type, j.http_status,
                     j.retry_count, j.max_retries,
                     j.created_at, j.started_at, j.completed_at, j.next_attempt_at`;

/**
 * Daftar job untuk `/admin/ingestion`. Atribusi sumber ikut diambil lewat join
 * (bukan disimpan ulang di baris job), sehingga nama sumber yang berubah tetap
 * tampil benar di riwayat lama.
 */
export async function listIngestionJobs(
  sql: SqlClient,
  params: { status?: string; limit?: number; offset?: number } = {},
): Promise<IngestionJobRow[]> {
  const limit = Math.min(Math.max(1, params.limit ?? 50), 200);
  const offset = Math.max(0, params.offset ?? 0);

  if (params.status) {
    return sql.query<IngestionJobRow>(
      `select ${JOB_COLUMNS}
         from ingestion_jobs j
         left join sources s on s.id = j.source_id
        where j.status = $1
        order by j.created_at desc
        limit $2 offset $3`,
      [params.status, limit, offset],
    );
  }

  return sql.query<IngestionJobRow>(
    `select ${JOB_COLUMNS}
       from ingestion_jobs j
       left join sources s on s.id = j.source_id
      order by j.created_at desc
      limit $1 offset $2`,
    [limit, offset],
  );
}

export async function getIngestionJob(sql: SqlClient, id: string): Promise<IngestionJobRow | null> {
  const rows = await sql.query<IngestionJobRow>(
    `select ${JOB_COLUMNS}
       from ingestion_jobs j
       left join sources s on s.id = j.source_id
      where j.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export interface IngestionErrorRow {
  id: string;
  job_id: string;
  source_url: string | null;
  error_type: string;
  error_message: string;
  http_status: number | null;
  payload: unknown;
  retry_count: number;
  created_at: string;
}

/**
 * Detail error per job (AC-10). `payload` ikut diambil karena gunanya memang
 * untuk mereproduksi bug parser offline (VA-3); batas ukurannya sudah dijaga
 * constraint `ingestion_errors_payload_size` (≤ 8 KB).
 */
export async function listIngestionErrors(
  sql: SqlClient,
  params: { jobIds: string[]; limit?: number },
): Promise<IngestionErrorRow[]> {
  if (params.jobIds.length === 0) return [];
  const limit = Math.min(Math.max(1, params.limit ?? 200), 500);

  return sql.query<IngestionErrorRow>(
    `select id, job_id, source_url, error_type, error_message, http_status, payload, retry_count, created_at
       from ingestion_errors
      where job_id = any($1::uuid[])
      order by created_at desc
      limit $2`,
    [params.jobIds, limit],
  );
}

export interface ConflictRow {
  id: string;
  character_name: string;
  character_slug: string;
  metric: string;
  value_a: string;
  source_a_name: string;
  value_b: string;
  source_b_name: string;
  status: string;
  created_at: string;
}

export async function listConflicts(
  sql: SqlClient,
  params: { limit?: number; offset?: number } = {},
): Promise<ConflictRow[]> {
  const limit = Math.min(Math.max(1, params.limit ?? 50), 200);
  const offset = Math.max(0, params.offset ?? 0);

  // Tabelnya `character_source_conflicts` dan statusnya `open | resolved |
  // ignored`; kolom nilainya `field`/`detected_at`. Query lama menyebut
  // `source_conflicts.metric`/`status = 'pending'` — tabel dan nilai enum yang
  // tidak ada, sehingga halaman konflik akan gagal saat pertama kali dijalankan.
  // Kesalahan itu tertangkap oleh uji integrasi di `tests/ingestion/`, yang
  // menjalankan query ini di atas `docs/schema.sql` sungguhan.
  return sql.query<ConflictRow>(
    `select sc.id,
            c.name as character_name, c.slug as character_slug,
            sc.field as metric,
            sc.value_a, sa.name as source_a_name,
            sc.value_b, sb.name as source_b_name,
            sc.status, sc.detected_at as created_at
       from character_source_conflicts sc
       join characters c on c.id = sc.character_id
       left join sources sa on sa.id = sc.source_a_id
       left join sources sb on sb.id = sc.source_b_id
      where sc.status = 'open'
      order by sc.detected_at desc
      limit $1 offset $2`,
    [limit, offset],
  );
}

export interface ConflictSummary {
  pending: number;
  resolved_7d: number;
  total: number;
}

/** Ringkasan konflik untuk kartu di `/admin/conflicts`. */
export async function getConflictSummary(sql: SqlClient): Promise<ConflictSummary> {
  const rows = await sql.query<{ pending: string; resolved_7d: string; total: string }>(
    `select
       (select count(*)::text from character_source_conflicts where status = 'open') as pending,
       (select count(*)::text from character_source_conflicts
         where status = 'resolved' and resolved_at > now() - interval '7 days') as resolved_7d,
       (select count(*)::text from character_source_conflicts) as total`,
  );
  const row = rows[0]!;
  return {
    pending: Number(row.pending),
    resolved_7d: Number(row.resolved_7d),
    total: Number(row.total),
  };
}
