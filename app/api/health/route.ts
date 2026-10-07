/**
 * `GET /api/health` — pemeriksaan liveness untuk platform dan untuk smoke test.
 *
 * Sengaja **tidak** menyentuh database: endpoint ini menjawab "proses web hidup
 * dan dapat melayani HTML", bukan "database sehat". Mencampur keduanya membuat
 * health check gagal saat database sekadar sedang sibuk, dan platform akan
 * me-restart proses yang sebenarnya baik-baik saja.
 *
 * Kesiapan database punya pemeriksaannya sendiri (`/api/health/ready` di Sprint
 * 1), yang memang boleh gagal saat database belum siap.
 */

import { ENGINE_VERSION } from '@/services/battle/index.ts';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json(
    {
      status: 'ok',
      engine_version: ENGINE_VERSION,
      // boolean saja — tidak pernah membocorkan nilai kredensial (PRD §28).
      database_configured: Boolean(process.env.DATABASE_URL),
      battle_preview_enabled:
        process.env.NODE_ENV !== 'production' && process.env.ALLOW_BATTLE_PREVIEW === '1',
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
