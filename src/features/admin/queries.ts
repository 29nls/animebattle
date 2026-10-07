/**
 * Query admin dashboard. Statistik ringkasan sistem untuk panel `/admin`.
 * Tidak ada query SQL langsung di komponen; semua lewat sini.
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

export interface IngestionJobRow {
  id: string;
  scope: string;
  status: string;
  target_ref: string | null;
  records_found: number | null;
  records_created: number | null;
  records_failed: number | null;
  error_message: string | null;
  error_type: string | null;
  retry_count: number;
  created_at: string;
  completed_at: string | null;
}

export async function listIngestionJobs(
  sql: SqlClient,
  params: { status?: string; limit?: number; offset?: number } = {},
): Promise<IngestionJobRow[]> {
  const limit = Math.min(Math.max(1, params.limit ?? 50), 200);
  const offset = Math.max(0, params.offset ?? 0);

  if (params.status) {
    return sql.query<IngestionJobRow>(
      `select id, scope, status, target_ref,
              records_found, records_created, records_failed,
              error_message, error_type, retry_count,
              created_at, completed_at
         from ingestion_jobs
        where status = $1
        order by created_at desc
        limit $2 offset $3`,
      [params.status, limit, offset],
    );
  }

  return sql.query<IngestionJobRow>(
    `select id, scope, status, target_ref,
            records_found, records_created, records_failed,
            error_message, error_type, retry_count,
            created_at, completed_at
       from ingestion_jobs
      order by created_at desc
      limit $1 offset $2`,
    [limit, offset],
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

  return sql.query<ConflictRow>(
    `select sc.id,
            c.name as character_name, c.slug as character_slug,
            sc.metric,
            sc.value_a, sa.name as source_a_name,
            sc.value_b, sb.name as source_b_name,
            sc.status, sc.created_at
       from source_conflicts sc
       join characters c on c.id = sc.character_id
       join sources sa on sa.id = sc.source_a_id
       join sources sb on sb.id = sc.source_b_id
      where sc.status = 'pending'
      order by sc.created_at desc
      limit $1 offset $2`,
    [limit, offset],
  );
}
