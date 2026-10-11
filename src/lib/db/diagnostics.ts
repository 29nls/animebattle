/**
 * Klasifikasi & sanitasi kegagalan koneksi database.
 *
 * Kenapa ada: `GET /api/health/ready` adalah probe anonim, jadi ia benar
 * menyembunyikan pesan driver — tetapi menyembunyikan **semuanya** membuat
 * insiden produksi 2026-10-10 mahal: yang terlihat hanya
 * `{"database":"connection_failed"}`, sementara penyebab sebenarnya
 * (`SELF_SIGNED_CERT_IN_CHAIN` — CA privat Supabase tidak terpakai) baru dapat
 * dipastikan setelah mereproduksi koneksi dari mesin operator. Modul ini
 * menutup celah itu tanpa membuka kebocoran baru: pemanggil anonim hanya
 * menerima **kategori** (`tls_untrusted`, `timeout`, `auth`, …), sedangkan
 * pesan driver tetap hidup di log server dalam bentuk yang sudah dibersihkan
 * dari kredensial.
 *
 * Aturan yang dipegang modul ini:
 *  1. Klasifikasi tidak pernah menebak dari pesan bila `code` sudah ada —
 *     pesan hanyalah cadangan untuk Node yang tidak melaporkan kode.
 *  2. Kategori yang tidak dikenali menjadi `unclassified`, bukan dipaksa masuk
 *     ke kategori terdekat. `unclassified` adalah sinyal: "lihat log server".
 *  3. Tidak ada nilai kredensial yang boleh keluar dari sini: URL koneksi
 *     dipotong sampai host:port saja, dan nilai yang cocok dengan secret
 *     lingkungan diganti `***`.
 */

import { DatabaseNotConfiguredError } from './client.ts';

/**
 * Kategori kegagalan. Nilainya stabil (dipakai probe, alert, dan runbook),
 * jadi nama baru hanya ditambahkan bersama pembaruannya di dokumen.
 */
export type DatabaseFailureCategory =
  /* Konfigurasi: DATABASE_URL tidak ada. Ditangani route sebagai 503 tersendiri. */
  | 'not_configured'
  /* TLS: rantai sertifikat tidak dipercaya CA yang dipakai (CA privat Supabase). */
  | 'tls_untrusted'
  /* TLS: sertifikat kedaluwarsa / belum berlaku. */
  | 'tls_expired'
  /* TLS: nama host tidak cocok dengan SAN sertifikat. */
  | 'tls_hostname_mismatch'
  /* DNS: host tidak dapat diresolusi (salah ketik, project dihapus). */
  | 'dns'
  /* TCP: host menjawab, tetapi tidak ada yang menerima (port salah, project paused). */
  | 'refused'
  /* TCP: koneksi direset di tengah jalan (proxy/pooler memutus). */
  | 'reset'
  /* TCP: tidak ada jawaban sebelum batas waktu. */
  | 'timeout'
  /* TCP: host tidak dapat dijangkau (rute/IPv6-only dari runtime IPv4). */
  | 'unreachable'
  /* SQLSTATE 28xxx: kredensial ditolak. */
  | 'auth'
  /* SQLSTATE 3D000: database pada URL tidak ada. */
  | 'database_missing'
  /* SQLSTATE 3F000/42P01: skema aplikasi belum diterapkan di database tujuan. */
  | 'schema_missing'
  /* SQLSTATE 53300/53400: batas koneksi pooler/server tercapai. */
  | 'connection_limit'
  /* SQLSTATE 57P01/57P03: server menutup koneksi / sedang memulihkan diri. */
  | 'server_unavailable'
  /* SQLSTATE kelas 08: koneksi hilang setelah terbentuk. */
  | 'connection_lost'
  /* Bukan kategori yang dikenal — periksa log server. */
  | 'unclassified';

const TLS_UNTRUSTED_CODES = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID', // ditangani khusus di bawah, didaftarkan agar jelas
  'CERT_UNTRUSTED',
]);

/** Pemetaan kode Node/OpenSSL → kategori. Diperiksa sebelum pesan. */
const CODE_CATEGORIES: Record<string, DatabaseFailureCategory> = {
  ENOTFOUND: 'dns',
  EAI_AGAIN: 'dns',
  EAI_FAIL: 'dns',
  ECONNREFUSED: 'refused',
  ECONNRESET: 'reset',
  EPIPE: 'reset',
  ETIMEDOUT: 'timeout',
  CONNECT_TIMEOUT: 'timeout', // postgres.js
  ERR_SOCKET_CONNECTION_TIMEOUT: 'timeout',
  EHOSTUNREACH: 'unreachable',
  ENETUNREACH: 'unreachable',
  CERT_HAS_EXPIRED: 'tls_expired',
  CERT_NOT_YET_VALID: 'tls_expired',
};

/** Pemetaan SQLSTATE → kategori. Kelas `08*` dicocokkan dengan pola. */
const SQLSTATE_CATEGORIES: Record<string, DatabaseFailureCategory> = {
  '3D000': 'database_missing',
  '3F000': 'schema_missing',
  '42P01': 'schema_missing',
  '53300': 'connection_limit',
  '53400': 'connection_limit',
  '57P01': 'server_unavailable',
  '57P02': 'server_unavailable',
  '57P03': 'server_unavailable',
};

/**
 * Cadangan berbasis pesan — hanya dipakai bila tidak ada `code` yang dikenali
 * (sebagian versi Node melaporkan kegagalan TLS tanpa kode). Pola dibuat ketat
 * supaya tidak menyerap pesan lain yang kebetulan menyebut "certificate".
 */
const MESSAGE_PATTERNS: Array<[RegExp, DatabaseFailureCategory]> = [
  [/self[- ]signed certificate|certificate chain|unable to verify|certificate verify failed|unable to get (local )?issuer/i, 'tls_untrusted'],
  [/certificate has expired|expired certificate/i, 'tls_expired'],
  [/altnames|hostname\/ip does not match|does not match certificate/i, 'tls_hostname_mismatch'],
  [/getaddrinfo|name or service not known|nodename nor servname/i, 'dns'],
  [/password authentication failed|authentication failed|no pg_hba\.conf entry/i, 'auth'],
  [/timeout|timed out|timeouterror/i, 'timeout'],
  [/connection refused|connect econnrefused/i, 'refused'],
  [/connection terminated|connection reset|socket hang up/i, 'reset'],
];

/** Bentuk aman untuk dicatat ke log server; tidak pernah memuat kredensial. */
export interface DatabaseFailureSummary {
  category: DatabaseFailureCategory;
  /** `Error.name` — mis. `PostgresError` pada penolakan sisi server. */
  name: string;
  code?: string;
  errno?: number;
  syscall?: string;
  /** host:port saja (tanpa user, password, atau parameter query). */
  target?: string;
  /** Pesan driver yang sudah dibersihkan & dipotong. */
  message: string;
}

/**
 * Variabel yang nilainya **selalu** disensor bila diisi, berapa pun panjangnya.
 * Ketiganya rahasia menurut definisinya (bearer token, kunci admin, dan bahan
 * TLS), jadi tidak ada nilai pendek yang "terlalu umum" untuk disensor.
 */
const ALWAYS_REDACT_KEYS = ['CRON_SECRET', 'ADMIN_INGESTION_SECRET', 'DATABASE_CA_CERT'] as const;

/**
 * Nilai `DATABASE_URL` disensor sebagai literal hanya bila cukup panjang.
 * Alasannya: URL-nya sudah tertangkap pola skema di atas, dan menyensor kata
 * umum membuat pesan driver seperti
 * `password authentication failed for user "postgres"` tidak lagi terbaca —
 * padahal pesan itu tidak memuat kredensial apa pun.
 */
const DATABASE_URL_LITERAL_KEYS = ['DATABASE_URL'] as const;
const MIN_LITERAL_LENGTH = 8;

/**
 * Buang kredensial dari teks apa pun sebelum dicatat.
 *
 * Dua lapis, karena keduanya menangkap hal berbeda:
 *  1. **Bentuk URL** — `postgres://user:pass@host` → `postgres://***@host`.
 *     Ini yang menyelamatkan bila driver mengutip connection string di pesannya.
 *  2. **Nilai literal** dari variabel rahasia yang diketahui — menangkap kasus
 *     nilai dikutip tanpa bentuk URL (mis. bearer token di pesan error HTTP).
 *     `CRON_SECRET`/`ADMIN_INGESTION_SECRET`/`DATABASE_CA_CERT` selalu disensor
 *     bila diisi; `DATABASE_URL` sebagai literal hanya bila panjang (lihat
 *     `MIN_LITERAL_LENGTH`) supaya kata umum di pesan driver tetap terbaca.
 */
export function redactSecrets(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let result = text.replace(/\b(postgres|postgresql):\/\/[^\s"'`]*/gi, (_match, scheme: string) => {
    return `${scheme}://***`;
  });
  // Kredensial yang tidak berbentuk URL (mis. `user:pass@host` mentah).
  result = result.replace(/([\w.%-]+):([^\s@/]{3,})@/g, '$1:***@');

  const keys: Array<{ key: string; minLength: number }> = [
    ...ALWAYS_REDACT_KEYS.map((key) => ({ key, minLength: 1 })),
    ...DATABASE_URL_LITERAL_KEYS.map((key) => ({ key, minLength: MIN_LITERAL_LENGTH })),
  ];
  for (const { key, minLength } of keys) {
    const value = env[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length < minLength) continue;
    result = result.split(trimmed).join('***');
    // PEM yang dikirim sebagai satu baris memakai escape literal.
    const escaped = trimmed.replace(/\n/g, '\\n');
    if (escaped !== trimmed && escaped.length >= 8) result = result.split(escaped).join('***');
  }
  return result;
}

/** `host:port` dari URL koneksi, atau `undefined` bila URL-nya tidak sah. */
function targetOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return undefined;
    return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
  } catch {
    return undefined;
  }
}

/**
 * Kategori kegagalan untuk sebuah error.
 *
 * Urutan pemeriksaan sengaja tetap: kelas error kita → kode TLS spesifik →
 * SQLSTATE → kode Node → pesan. Kode selalu menang atas pesan, sehingga pesan
 * yang kebetulan memuat kata "certificate" tidak dapat mengalihkan kategori.
 */
export function classifyDatabaseError(error: unknown): DatabaseFailureCategory {
  if (error instanceof DatabaseNotConfiguredError) return 'not_configured';

  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === 'string') {
    if (code === 'ERR_TLS_CERT_ALTNAME_INVALID') return 'tls_hostname_mismatch';
    if (TLS_UNTRUSTED_CODES.has(code)) return 'tls_untrusted';
    const mapped = CODE_CATEGORIES[code];
    if (mapped) return mapped;
    if (SQLSTATE_CATEGORIES[code]) return SQLSTATE_CATEGORIES[code];
    if (/^28[0-9A-Z]{3}$/.test(code)) return 'auth';
    if (/^08[0-9A-Z]{3}$/.test(code)) return 'connection_lost';
  }

  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  for (const [pattern, category] of MESSAGE_PATTERNS) {
    if (pattern.test(message)) return category;
  }
  return 'unclassified';
}

/**
 * Ringkasan kegagalan yang aman dicatat. `target` berisi host:port saja —
 * cukup untuk membedakan "URL salah arah" dari "TLS/kredensial salah", tanpa
 * pernah menuliskan user, password, atau parameter query.
 */
export function summarizeDatabaseFailure(
  error: unknown,
  env: NodeJS.ProcessEnv = process.env,
): DatabaseFailureSummary {
  const source = (error ?? {}) as { name?: unknown; code?: unknown; errno?: unknown; syscall?: unknown };
  const rawMessage = error instanceof Error ? error.message : String(error ?? '');
  const summary: DatabaseFailureSummary = {
    category: classifyDatabaseError(error),
    name: typeof source.name === 'string' ? source.name : typeof error,
    message: redactSecrets(rawMessage, env).slice(0, 400),
  };
  if (typeof source.code === 'string') summary.code = source.code;
  if (typeof source.errno === 'number') summary.errno = source.errno;
  if (typeof source.syscall === 'string') summary.syscall = source.syscall;
  const target = targetOf(env.DATABASE_URL);
  if (target) summary.target = target;
  return summary;
}
