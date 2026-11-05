/** Query tiket legal. Tidak ada komponen yang merakit SQL sendiri. */

import type { SqlClient } from '@/lib/db/client.ts';
import type { LegalReportInput } from './takedown.ts';

export interface LegalReportReceipt {
  ticket_code: string;
  created_at: string;
}

export async function insertLegalReport(
  sql: SqlClient,
  input: LegalReportInput,
): Promise<LegalReportReceipt> {
  const rows = await sql.query<LegalReportReceipt>(
    `insert into legal_reports
       (kind, reporter_name, reporter_email, reported_url, description, good_faith)
     values ($1, $2, $3, $4, $5, true)
     returning ticket_code, created_at`,
    [input.kind, input.name, input.email, input.url, input.description],
  );
  const row = rows[0];
  if (!row) throw new Error('insert legal_reports tidak mengembalikan tiket');
  return row;
}

export interface LegalReportRow {
  id: string;
  ticket_code: string;
  kind: string;
  reporter_name: string;
  reporter_email: string;
  reported_url: string;
  description: string;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  resolution_note: string | null;
}

/** Daftar tiket untuk panel admin; PII sengaja hanya keluar lewat halaman admin. */
export async function listLegalReports(
  sql: SqlClient,
  params: { status?: string; limit?: number; offset?: number } = {},
): Promise<LegalReportRow[]> {
  const limit = Math.min(Math.max(1, params.limit ?? 50), 200);
  const offset = Math.max(0, params.offset ?? 0);

  if (params.status) {
    return sql.query<LegalReportRow>(
      `select id, ticket_code, kind, reporter_name, reporter_email, reported_url,
              description, status, created_at, reviewed_at, resolution_note
         from legal_reports
        where status = $1
        order by created_at desc
        limit $2 offset $3`,
      [params.status, limit, offset],
    );
  }

  return sql.query<LegalReportRow>(
    `select id, ticket_code, kind, reporter_name, reporter_email, reported_url,
            description, status, created_at, reviewed_at, resolution_note
       from legal_reports
      order by created_at desc
      limit $1 offset $2`,
    [limit, offset],
  );
}
