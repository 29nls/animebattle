/**
 * Audit nama environment sebelum build.
 *
 * Yang diperiksa hanya nama dan keberadaan di git — nilai tidak pernah dibaca
 * atau dicetak. Jalankan tanpa kredensial apa pun:
 *
 *   npm run audit:env
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  auditEnvNames,
  extractEnvNames,
  findPublicEnvReferences,
  PUBLIC_ENV_ALLOWLIST,
} from '../src/lib/security/env-audit.ts';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const errors = [];

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

// 1. Template env: semua nama NEXT_PUBLIC_ harus ada di allow-list.
const envExampleNames = extractEnvNames(readIfExists(join(ROOT, '.env.example')));
errors.push(...auditEnvNames(envExampleNames));

// 2. Sumber aplikasi: referensi process.env.NEXT_PUBLIC_* harus dikenal.
const referenced = new Set();
for (const directory of ['app', 'src', 'worker']) {
  const absolute = join(ROOT, directory);
  if (!existsSync(absolute)) continue;
  for (const file of walk(absolute)) {
    for (const name of findPublicEnvReferences(readFileSync(file, 'utf8'))) {
      referenced.add(name);
      if (!PUBLIC_ENV_ALLOWLIST.includes(name)) {
        errors.push(`${relative(ROOT, file)}: ${name} tidak ada di allow-list environment publik.`);
      }
    }
  }
}

// 3. Berkas env nyata tidak boleh ikut ter-commit.
try {
  const tracked = execFileSync('git', ['ls-files', '--', '.env', '.env.*'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((path) => !/\.env\.(example|sample|template)$/.test(path));
  for (const path of tracked) {
    errors.push(`${path}: berkas environment nyata tidak boleh dilacak git.`);
  }
} catch {
  console.warn('audit:env: git tidak tersedia; pemeriksaan berkas ter-commit dilewati.');
}

if (errors.length > 0) {
  console.error(`audit:env GAGAL (${errors.length} temuan):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `audit:env OK — ${new Set(envExampleNames).size} nama di .env.example, ` +
      `${referenced.size} referensi NEXT_PUBLIC_ di sumber, allow-list ${PUBLIC_ENV_ALLOWLIST.length} nama.`,
  );
}
