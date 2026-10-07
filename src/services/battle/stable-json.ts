/**
 * Serialisasi kanonik + hash.
 *
 * Dipakai untuk `input_hash`: input yang sama harus menghasilkan hash yang sama
 * persis, apa pun urutan kunci pada objek JSON. Tanpa jaminan ini, determinisme
 * (AC-28) dan cache battle (`battle_results.input_hash` unique) tidak bermakna.
 */

import { createHash } from 'node:crypto';

/** JSON stringify dengan kunci objek terurut, agar hasilnya stabil. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) out[k] = sortValue(v);
  return out;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Hash kanonik dari sebuah nilai. */
export function hashValue(value: unknown): string {
  return `sha256:${sha256Hex(stableStringify(value))}`;
}
