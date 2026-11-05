/**
 * Satu pintu untuk melaporkan kegagalan operasional.
 *
 * Log selalu ditulis (murah, dan berguna walau Sentry belum dikonfigurasi);
 * laporan ke Sentry hanya dikirim bila DSN tersedia. Route tidak perlu tahu
 * penyedianya.
 */

import { logEvent } from './logger.ts';
import { captureException } from './sentry.ts';

export interface ErrorContext {
  /** Nama peristiwa yang stabil, mis. `api.search.database_unavailable`. */
  event: string;
  route?: string;
  [key: string]: unknown;
}

export async function reportError(error: unknown, context: ErrorContext): Promise<void> {
  const { event, ...fields } = context;
  logEvent('error', event, { ...fields, error });
  await captureException(error, { ...fields, event });
}
