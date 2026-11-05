/**
 * Pelacakan error server-side (Sentry) yang tidak membocorkan kredensial.
 *
 * Sengaja hanya diinisialisasi di runtime Node. `@sentry/node` tidak masuk ke
 * bundel browser, jadi anggaran JavaScript publik tidak berubah dan tidak ada
 * DSN yang perlu diekspos sebagai `NEXT_PUBLIC_*`.
 *
 * Tanpa `SENTRY_DSN`, seluruh fungsi menjadi no-op. Ini membuat build, test,
 * dan deployment tanpa akun Sentry tetap berjalan; checklist peluncuran yang
 * menandai item ini belum aktif sampai DSN benar-benar diisi.
 */

import { logEvent } from './logger.ts';
import { sanitizeRecord, sanitizeValue } from './redact.ts';

import type { ErrorEvent } from '@sentry/node';

let initialized: Promise<boolean> | null = null;

function environment(): string {
  return (
    process.env.SENTRY_ENVIRONMENT?.trim() ||
    process.env.VERCEL_ENV?.trim() ||
    process.env.NODE_ENV ||
    'development'
  );
}

/** Sanitasi event Sentry sebelum dikirim; request body dan cookie dibuang. */
function beforeSend(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    event.request = {
      ...event.request,
      headers: sanitizeRecord(event.request.headers ?? {}) as Record<string, string>,
    };
    delete event.request.cookies;
    delete event.request.query_string;
    delete event.request.data;
  }
  if (event.extra) {
    event.extra = sanitizeValue(event.extra) as Record<string, unknown>;
  }
  // Identitas pelapor tidak diperlukan untuk memperbaiki bug, dan email adalah
  // data pribadi. `sendDefaultPii: false` saja tidak cukup karena SDK dapat
  // mengisi user dari integrasi request.
  delete event.user;
  return event;
}

/**
 * Inisialisasi sekali per proses. Promise disimpan agar beberapa request
 * pertama tidak menginisialisasi SDK secara bersamaan.
 */
export function initErrorTracking(): Promise<boolean> {
  if (!process.env.SENTRY_DSN?.trim()) return Promise.resolve(false);
  if (initialized) return initialized;

  initialized = (async () => {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: environment(),
      ...(process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA
        ? { release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA }
        : {}),
      // Sentry v11 mengganti `sendDefaultPii` dengan kontrol per kategori.
      // Tidak ada PII, cookie, header, body, atau query string yang dikirim.
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
      },
      tracesSampleRate: 0,
      profileSessionSampleRate: 0,
      maxBreadcrumbs: 0,
      attachStacktrace: true,
      debug: false,
      ignoreErrors: ['NEXT_REDIRECT', 'NEXT_NOT_FOUND'],
      initialScope: { tags: { service: 'animebattle' } },
      beforeSend,
    });
    logEvent('info', 'error_tracking.enabled', { environment: environment() });
    return true;
  })().catch((error: unknown) => {
    logEvent('warn', 'error_tracking.init_failed', { error });
    return false;
  });

  return initialized;
}

/**
 * Kirim satu exception bila pelacakan aktif. Kegagalan Sentry tidak pernah
 * menggagalkan respons pengguna atau job ingestion.
 */
export async function captureException(
  error: unknown,
  context: Record<string, unknown> = {},
): Promise<boolean> {
  if (!process.env.SENTRY_DSN?.trim()) return false;

  try {
    const ready = await initErrorTracking();
    if (!ready) return false;

    const Sentry = await import('@sentry/node');
    Sentry.captureException(error, {
      level: 'error',
      tags: { service: 'animebattle' },
      extra: sanitizeValue(context) as Record<string, unknown>,
    });
    return true;
  } catch (captureError) {
    logEvent('warn', 'error_tracking.capture_failed', { error: captureError });
    return false;
  }
}
