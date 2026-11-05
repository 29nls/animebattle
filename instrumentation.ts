/**
 * Instrumentasi Next.js: inisialisasi error tracking server dan tangkap error
 * request yang tidak tertangani.
 *
 * Berkas ini berada di akar proyek karena itu lokasi yang dikenali Next.
 * Tidak ada import sisi klien di sini — bundle browser tidak berubah.
 */

import { captureException, initErrorTracking } from './src/lib/observability/sentry.ts';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await initErrorTracking();
  }
}

/**
 * Dipanggil Next untuk error yang lolos dari route/page. `captureException`
 * sudah membersihkan header dan menghapus PII sebelum event dikirim.
 */
export async function onRequestError(
  error: unknown,
  request: { path?: string; method?: string },
  context: { routerKind?: string; routePath?: string; routeType?: string; renderSource?: string },
): Promise<void> {
  await captureException(error, {
    event: 'next.request_error',
    path: request.path,
    method: request.method,
    router_kind: context.routerKind,
    route_path: context.routePath,
    route_type: context.routeType,
    render_source: context.renderSource,
  });
}
