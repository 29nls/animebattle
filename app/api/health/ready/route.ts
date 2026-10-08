/**
 * `GET /api/health/ready` — pemeriksaan kesiapan database (Sprint 1).
 * Berbeda dari `/api/health` yang hanya memeriksa proses web.
 * Endpoint ini sengaja menyentuh database untuk memastikan koneksi berjalan.
 */

import { getSqlClient, DatabaseNotConfiguredError } from '@/lib/db/client.ts';

export const dynamic = 'force-dynamic';

/**
 * Respons probe tidak boleh di-cache: 200 yang tersimpan akan menutupi database
 * yang baru saja mati, dan 503 yang tersimpan menahan pemulihan. Contract ini
 * didokumentasikan sebagai `no-store` (APPENDICES G baris 44) dan karena itu
 * dipasang di **semua** cabang, bukan hanya cabang `ready`.
 */
const NO_STORE = { 'cache-control': 'no-store' } as const;

export async function GET(): Promise<Response> {
  try {
    const sql = getSqlClient();
    const rows = await sql.query<{ ok: number }>(`select 1 as ok`);
    if (rows[0]?.ok === 1) {
      return Response.json({ status: 'ready', database: 'connected' }, { headers: NO_STORE });
    }
    console.error('[api/health/ready] respons tak terduga dari database:', rows);
    return Response.json(
      { status: 'unhealthy', database: 'unexpected_response' },
      { status: 500, headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof DatabaseNotConfiguredError) {
      // Konfigurasi hilang: pesannya operasional (menyebut env yang kurang) dan
      // berguna bagi operator, jadi tetap diteruskan.
      return Response.json(
        { status: 'not_configured', database: error.missing, hint: error.hint },
        { status: 503, headers: NO_STORE },
      );
    }
    // Konektivitas/TLS: `error.message` mentah menyebut host, sertifikat, dan
    // kadang potongan query. Route ini anonim (APPENDICES G baris 44), jadi
    // pemanggil hanya menerima klasifikasi; detailnya masuk log server.
    console.error('[api/health/ready] database tidak dapat dihubungi:', error);
    return Response.json(
      { status: 'unhealthy', database: 'connection_failed', error: 'Database tidak dapat dihubungi.' },
      { status: 503, headers: NO_STORE },
    );
  }
}
