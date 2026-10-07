// Fixture: PELANGGARAN disengaja. Semua yang dilarang di zona engine.
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { resolve } from '@/lib/db/client.ts';

export function impure(seed: string): string {
  const stamp = Date.now();
  const noise = Math.random();
  console.log(path.join(process.cwd(), seed));
  randomUUID();
  return `${createHash('sha256').update(String(stamp + noise)).digest('hex')}-${resolve}-${readFileSync}`;
}
