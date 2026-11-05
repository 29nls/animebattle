/**
 * Audit environment Vercel (nama saja, tanpa mencetak nilai).
 *
 * Butuh VERCEL_TOKEN dan VERCEL_PROJECT_ID (opsional VERCEL_TEAM_ID). Tanpa
 * kredensial, skrip gagal dengan kode 2 — bukan lulus diam-diam, karena audit
 * yang tidak berjalan tidak membuktikan apa pun.
 *
 *   npm run audit:env:vercel
 */

import { auditEnvNames } from '../src/lib/security/env-audit.ts';

const token = process.env.VERCEL_TOKEN?.trim();
const project = process.env.VERCEL_PROJECT_ID?.trim();
const team = process.env.VERCEL_TEAM_ID?.trim();

if (!token || !project) {
  console.error('audit:env:vercel TIDAK DIJALANKAN — butuh VERCEL_TOKEN dan VERCEL_PROJECT_ID.');
  process.exit(2);
}

const url = new URL(`https://api.vercel.com/v9/projects/${encodeURIComponent(project)}/env`);
url.searchParams.set('decrypt', 'false');
if (team) url.searchParams.set('teamId', team);

let response;
try {
  response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, 'user-agent': 'animebattle-env-audit/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
} catch (error) {
  console.error(`audit:env:vercel GAGAL — permintaan jaringan: ${error.message}`);
  process.exit(2);
}

if (!response.ok) {
  console.error(`audit:env:vercel GAGAL — Vercel API HTTP ${response.status}.`);
  process.exit(2);
}

const payload = await response.json().catch(() => null);
const envs = payload && Array.isArray(payload.envs) ? payload.envs : null;
if (!envs) {
  console.error('audit:env:vercel GAGAL — bentuk respons Vercel tidak dikenali.');
  process.exit(2);
}

const names = envs.map((env) => env.key).filter((key) => typeof key === 'string');
const errors = auditEnvNames(names);

// Variabel yang dikenal tetapi tidak ada di salah satu target Vercel adalah
// konfigurasi yang belum lengkap; ini peringatan, bukan pelanggaran keamanan.
const missing = ['DATABASE_URL', 'NEXT_PUBLIC_SITE_URL'].filter((name) => !names.includes(name));

if (errors.length > 0) {
  console.error(`audit:env:vercel GAGAL (${errors.length} temuan):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`audit:env:vercel OK — ${names.length} nama diperiksa; tidak ada NEXT_PUBLIC_ tak dikenal.`);
}

if (missing.length > 0) {
  console.warn(`audit:env:vercel: variabel belum ditemukan di semua target: ${missing.join(', ')}`);
}
