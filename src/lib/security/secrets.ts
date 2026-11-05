/**
 * Perbandingan secret timing-safe untuk endpoint cron.
 *
 * Rute admin sudah tidak memakai shared secret; hanya `CRON_SECRET` yang
 * tersisa. Modul ini sengaja tidak tahu apa pun tentang sesi atau peran.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

export function secretsMatch(provided: string, configured: string): boolean {
  const a = (provided ?? '').trim();
  const b = (configured ?? '').trim();
  if (a.length === 0 || b.length === 0) return false;
  const digest = (value: string): Buffer =>
    createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(a), digest(b));
}
