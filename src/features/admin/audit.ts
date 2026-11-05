/**
 * Audit aksi admin.
 *
 * Parameter aksi disimpan di `audit_logs.after` sebagai `{ "params": ... }`
 * sehingga tabel yang sudah ada tidak perlu kolom baru. Aktor selalu berasal
 * dari sesi yang diverifikasi, bukan dari body request.
 *
 * Takedown/merge belum memiliki handler di repo ini; konstanta aksinya
 * disiapkan agar penulis handler berikutnya memakai nama yang sama.
 */

import type { SqlClient } from '../../lib/db/client.ts';

export type AdminAuditAction =
  | 'ingestion.run'
  | 'ingestion.import'
  | 'ingestion.retry'
  | 'ingestion.cancel'
  | 'takedown'
  | 'merge';

export interface AdminAuditEntry {
  actorId: string;
  action: AdminAuditAction;
  entityType: string;
  entityId?: string | null;
  params: Record<string, unknown>;
  ipHash?: string | null;
}

export async function recordAdminAudit(sql: SqlClient, entry: AdminAuditEntry): Promise<void> {
  const after = JSON.stringify({ params: entry.params });
  await sql.query(
    `insert into audit_logs (actor_id, action, entity_type, entity_id, after, ip_hash)
     values ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      entry.actorId,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      after,
      entry.ipHash ?? null,
    ],
  );
}

export interface AuditLogRow {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  params: unknown;
  ip_hash: string | null;
  created_at: string;
}

export async function listAuditLogs(
  sql: SqlClient,
  params: { limit?: number; offset?: number } = {},
): Promise<AuditLogRow[]> {
  const limit = Math.min(Math.max(1, params.limit ?? 50), 200);
  const offset = Math.max(0, params.offset ?? 0);

  return sql.query<AuditLogRow>(
    `select a.id, a.actor_id, u.display_name as actor_name,
            a.action, a.entity_type, a.entity_id,
            a.after -> 'params' as params,
            a.ip_hash, a.created_at
       from audit_logs a
       left join users u on u.id = a.actor_id
      order by a.created_at desc
      limit $1 offset $2`,
    [limit, offset],
  );
}
