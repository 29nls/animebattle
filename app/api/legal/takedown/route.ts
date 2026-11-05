/**
 * `POST /api/legal/takedown` — tiket takedown/privacy.
 *
 * Formulir hanya mengirim kontak, URL, dan deskripsi. Server yang menentukan
 * status awal dan kode tiket; klien tidak dapat memalsukan `reviewed_by` atau
 * `status`. Tidak ada PII yang masuk log atau pesan error.
 */

import { DatabaseNotConfiguredError, getSqlClient, isDatabaseUnavailable } from '@/lib/db/client.ts';
import { apiError } from '@/lib/errors.ts';
import { logEvent } from '@/lib/observability/logger.ts';
import { reportError } from '@/lib/observability/report-error.ts';
import { enforcePublicRateLimit } from '@/lib/security/distributed-rate-limit.ts';
import { insertLegalReport } from '@/features/legal/queries.ts';
import { parseLegalReport } from '@/features/legal/takedown.ts';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16_384;
const RATE_LIMIT = { scope: 'legal-takedown', limit: 5, windowMs: 60 * 60_000 } as const;

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // request server-ke-server tanpa Origin tetap sah
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) {
    return apiError('FORBIDDEN', 'Permintaan lintas situs ditolak.', 403);
  }

  const length = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return apiError('INVALID_INPUT', 'Body terlalu besar.', 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('INVALID_INPUT', 'Body harus berupa JSON.', 400);
  }

  const parsed = parseLegalReport(body);
  if (!parsed.ok) {
    return apiError('INVALID_INPUT', parsed.message, 400);
  }

  const limited = await enforcePublicRateLimit(request.headers, RATE_LIMIT);
  if (limited) return limited;

  try {
    const receipt = await insertLegalReport(getSqlClient(), parsed.value);
    logEvent('info', 'legal.report_received', {
      kind: parsed.value.kind,
      ticket_code: receipt.ticket_code,
    });
    return Response.json(
      {
        data: receipt,
        message:
          'Laporan diterima. Simpan kode tiket ini; panel operasional akan meninjaunya.',
      },
      { status: 201, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof DatabaseNotConfiguredError) {
      return apiError('UNAVAILABLE', 'Kanal laporan sedang tidak tersedia. Coba lagi nanti.', 503);
    }
    if (isDatabaseUnavailable(error)) {
      await reportError(error, {
        event: 'legal.report_database_unavailable',
        route: '/api/legal/takedown',
      });
      return apiError('UNAVAILABLE', 'Kanal laporan sedang tidak tersedia. Coba lagi nanti.', 503);
    }
    await reportError(error, {
      event: 'legal.report_insert_failed',
      route: '/api/legal/takedown',
      kind: parsed.value.kind,
    });
    return apiError('INTERNAL', 'Laporan tidak dapat disimpan. Coba lagi nanti.', 500);
  }
}
