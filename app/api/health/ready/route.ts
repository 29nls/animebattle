/**
 * `GET /api/health/ready` — pemeriksaan kesiapan database (Sprint 1).
 * Berbeda dari `/api/health` yang hanya memeriksa proses web.
 * Endpoint ini sengaja menyentuh database untuk memastikan koneksi berjalan.
 */

import { getSqlClient, DatabaseNotConfiguredError } from '@/lib/db/client.ts';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const sql = getSqlClient();
    const rows = await sql.query<{ ok: number }>(`select 1 as ok`);
    if (rows[0]?.ok === 1) {
      return Response.json(
        { status: 'ready', database: 'connected' },
        { headers: { 'cache-control': 'no-store' } },
      );
    }
    return Response.json({ status: 'unhealthy', database: 'unexpected_response' }, { status: 500 });
  } catch (error) {
    if (error instanceof DatabaseNotConfiguredError) {
      return Response.json(
        { status: 'not_configured', database: error.missing, hint: error.hint },
        { status: 503 },
      );
    }
    return Response.json(
      { status: 'unhealthy', database: 'connection_failed', error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}
