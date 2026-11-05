/**
 * Log terstruktur satu baris JSON.
 *
 * Semua nilai melewati `sanitizeValue`; pemanggil tidak perlu (dan tidak boleh)
 * merakit string log sendiri. Satu baris JSON membuat log dapat dicari di
 * Vercel/CloudWatch tanpa parser khusus, dan `event` yang stabil memudahkan
 * alert berbasis pola.
 */

import { sanitizeValue } from './redact.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function configuredLevel(): LogLevel {
  const value = process.env.LOG_LEVEL?.toLowerCase();
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
    return value;
  }
  return 'info';
}

function isEnabled(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[configuredLevel()];
}

/**
 * Bentuk record tanpa menulis apa pun. Diekspor agar pengujian tidak perlu
 * menangkap stdout dan agar formatnya dapat dipakai ulang oleh skrip operasi.
 */
export function formatLogRecord(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
  now: Date = new Date(),
): Record<string, unknown> {
  const safeFields = sanitizeValue(fields);
  const context =
    safeFields !== null && typeof safeFields === 'object' && !Array.isArray(safeFields)
      ? (safeFields as Record<string, unknown>)
      : { value: safeFields };

  return {
    time: now.toISOString(),
    level,
    event: String(event).slice(0, 120),
    service: 'animebattle',
    ...context,
  };
}

/** Tulis satu event ke stdout/stderr. Nilai sudah diredaksi sebelum mencapai sini. */
export function logEvent(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  if (!isEnabled(level)) return;
  let line: string;
  try {
    line = JSON.stringify(formatLogRecord(level, event, fields));
  } catch {
    // Tidak boleh terjadi karena sanitizeValue menangani circular, tetapi logger
    // yang melempar saat menangani error adalah kegagalan ganda.
    line = JSON.stringify({
      time: new Date().toISOString(),
      level: 'error',
      event: 'logger.serialization_failed',
      service: 'animebattle',
    });
  }
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}
