/**
 * IP untuk audit log: di-hash per hari, bukan disimpan mentah.
 *
 * Tanpa salt, hash tetap dapat dikorelasikan dalam satu hari. Salt opsional
 * `IP_HASH_SALT` dapat diisi operator; tidak ada default rahasia yang
 * di-hardcode.
 */

import { createHash } from 'node:crypto';

interface HeaderLike {
  get(name: string): string | null;
}

/** IP klien dari header proxy standar; `null` bila tidak tersedia. */
export function requestIp(headers: HeaderLike): string | null {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded !== null) {
    const first = forwarded.split(',')[0]?.trim() ?? '';
    if (first !== '') return first;
  }
  const real = headers.get('x-real-ip')?.trim() ?? '';
  return real === '' ? null : real;
}

export function hashIp(
  ip: string | null | undefined,
  nowMs: number = Date.now(),
  salt: string = process.env.IP_HASH_SALT ?? '',
): string | null {
  const value = (ip ?? '').trim();
  if (value === '') return null;
  const day = new Date(nowMs).toISOString().slice(0, 10);
  return createHash('sha256').update(`${salt}|${value}|${day}`).digest('hex');
}
