/**
 * Satu-satunya pintu ke database.
 *
 * Kenapa sempit: PRD §38 menuntut satu jalur data. Kalau komponen atau route
 * membuat koneksi sendiri, indexing dan pagination jadi tidak dapat ditegakkan,
 * dan aturan "tidak ada query SQL langsung di komponen" kehilangan artinya.
 *
 * Kenapa antarmuka `SqlClient` bukan tipe driver: engine, query, dan worker
 * diuji tanpa database nyata. Yang diinjeksi di test adalah implementasi
 * antarmuka ini (di repo ini: PGlite pada `scripts/validate-schema.mjs`).
 */

export type Row = Record<string, unknown>;

export interface SqlClient {
  /**
   * Selalu query ber-parameter. Nilai tidak pernah dirakit ke dalam string SQL.
   *
   * `T` sengaja tidak dibatasi `Row`: tipe seperti `CharacterListItem` adalah
   * interface tanpa index signature, sehingga menuntut `extends Row` akan
   * memaksa setiap pemanggil menambahkan index signature yang tidak mereka
   * butuhkan. Bentuk baris tetap tanggung jawab pemanggil — dan diverifikasi
   * terhadap DDL oleh `scripts/validate-db-access.mjs`.
   */
  query<T = Row>(text: string, params?: readonly unknown[]): Promise<T[]>;
}

/** Dilempar bila konfigurasi database belum ada — bukan kegagalan yang menyesatkan. */
export class DatabaseNotConfiguredError extends Error {
  override readonly name = 'DatabaseNotConfiguredError';
  readonly missing: string;
  readonly hint: string;

  // Bidang dideklarasikan dan diisi eksplisit: parameter property
  // (`constructor(readonly x: T)`) adalah sintaks yang **menghasilkan kode**,
  // sehingga tidak kompatibel dengan `erasableSyntaxOnly` — mode yang dipakai
  // repo ini karena Node menjalankan TypeScript dengan type stripping.
  constructor(missing: string, hint: string) {
    super(`Database belum dikonfigurasi: ${missing}. ${hint}`);
    this.missing = missing;
    this.hint = hint;
  }
}

/**
 * Kode error Node/driver yang berarti database **tidak dapat dihubungi** —
 * gangguan infrastruktur, bukan bug aplikasi. Route memakainya untuk menjawab
 * 503 `UNAVAILABLE` alih-alih 500 `INTERNAL`, supaya klien dan monitor tidak
 * menyalahkan kode atas jaringan/kredensial yang bermasalah (PRD §24).
 */
const CONNECTIVITY_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
]);

/**
 * Apakah error ini berarti database tidak tersedia (bukan bug kode)?
 *
 * Mencakup: konfigurasi yang hilang, kode konektivitas Node/TLS, SQLSTATE
 * kelas `08` (connection exception), dan shutdown server. Sengaja **tidak**
 * menebak dari pesan kecuali untuk kasus TLS yang muncul sebagai pesan tanpa
 * `code` pada sebagian versi Node.
 */
export function isDatabaseUnavailable(error: unknown): boolean {
  if (error instanceof DatabaseNotConfiguredError) return true;
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === 'string') {
    if (CONNECTIVITY_CODES.has(code)) return true;
    if (/^08[0-9A-Z]{3}$/.test(code)) return true;
    if (code === '57P01' || code === '57P03') return true;
  }
  const message = error instanceof Error ? error.message : '';
  return /self-signed certificate|certificate chain|unable to verify|getaddrinfo/i.test(message);
}

/**
 * Apakah `DATABASE_URL` tersedia?
 *
 * Dipakai pemilih sumber data (database vs dataset demo) — **bukan** pengganti
 * `getSqlClient()`: fungsi ini hanya membaca konfigurasi, tidak membuka koneksi,
 * dan tidak menyembunyikan database yang dikonfigurasi tetapi sedang rusak.
 * Dalam kasus itu galat koneksi asli tetap diteruskan ke pemanggil.
 */
export function isDatabaseConfigured(): boolean {
  return typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.trim() !== '';
}

let injected: SqlClient | null = null;

/**
 * Menyuntik klien (worker, test, CLI). Dipakai alih-alih singleton lingkungan
 * supaya tidak ada modul yang diam-diam membuka koneksi saat diimpor.
 */
export function setSqlClient(client: SqlClient | null): void {
  injected = client;
}

import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import postgres from 'postgres';

import { SUPABASE_ROOT_2021_CA } from './supabase-ca.ts';

/** Path `sslrootcert` dari URL koneksi, atau `null` bila tidak ada/tidak dipakai. */
function sslRootCertPath(url: string): string | null {
  try {
    const value = new URL(url).searchParams.get('sslrootcert');
    // Nilai `system` bukan berkas — postgres.js memakainya sebagai penanda
    // "verifikasi dengan CA sistem", jadi jangan diperlakukan sebagai path.
    return !value || value === 'system' ? null : value;
  } catch {
    return null;
  }
}

/**
 * Opsi TLS untuk driver Postgres.
 *
 * Kenapa perlu ada: Supabase memakai CA **privat** ("Supabase Root 2021 CA"),
 * sehingga `sslmode=verify-full` — yang memverifikasi terhadap CA bawaan Node —
 * gagal dengan `self-signed certificate in certificate chain` pada setiap
 * halaman ber-DB, meski kredensialnya benar. Lebih buruk: `sslrootcert` di URL
 * **tidak dibaca postgres.js** (hanya nilai `system` yang dikenali), jadi
 * mencantumkan path CA di connection string tidak berpengaruh sama sekali.
 *
 * Tiga sumber CA, semuanya eksplisit dan dapat diperiksa:
 *  1. `DATABASE_CA_CERT` — isi PEM; menang bila diisi. Bentuk berkutip maupun
 *     satu-baris dengan `\n` literal diterima (lihat `normalizedCaValue`).
 *  2. `sslrootcert` pada URL — path berkas, mengikuti perilaku libpq; dibaca
 *     hanya bila berkasnya benar-benar ada di mesin ini.
 *  3. Root CA Supabase yang disalin ke repo (`supabase-ca.ts`) — dipakai
 *     **hanya** untuk host Supabase bila dua sumber di atas tidak menghasilkan
 *     CA. Inilah yang membuat deployment serverless bekerja tanpa konfigurasi:
 *     `DATABASE_URL` yang disalin dari mesin lokal sering membawa
 *     `sslrootcert=C:/Users/...` — path yang tidak ada di runner. Sebelum ini,
 *     deployment itu mati meski kredensialnya benar.
 *
 * `ssl` sengaja dibiarkan berupa objek **tanpa** `rejectUnauthorized`: dengan
 * objek, postgres.js memakai default Node, yaitu verifikasi tetap AKTIF.
 * Fungsi ini tidak pernah melonggarkan verifikasi — jalur yang melonggarkan
 * (mis. `sslmode=require`) hanya muncul bila operator menuliskannya sendiri di
 * `DATABASE_URL`, dan itu dihormati (`LOOSE_SSL_MODES`).
 */
/**
 * Apakah nilai ini benar-benar PEM sertifikat (punya kepala **dan** ekor)?
 *
 * Cek bentuk, bukan parsing penuh: berkas CA sah sering berisi beberapa
 * sertifikat (bundle), dan itu tetap harus diterima.
 */
function isPemCertificate(value: string): boolean {
  return value.includes('-----BEGIN CERTIFICATE-----') && value.includes('-----END CERTIFICATE-----');
}

/** Nilai `sslmode` yang sengaja TIDAK memverifikasi sertifikat (pilihan operator). */
const LOOSE_SSL_MODES = new Set(['require', 'allow', 'prefer', 'disable']);

/**
 * Nilai `DATABASE_CA_CERT` yang siap dipakai TLS, atau `null` bila kosong.
 *
 * Dua bentuk yang sengaja diterima, keduanya nyata di lapangan:
 *  - dibungkus tanda kutip — kebiasaan menulis nilai `.env`;
 *  - satu baris dengan `\n` literal — dashboard/CI yang tidak menerima newline
 *    memaksa operator menempelkannya begitu. `\` tidak pernah muncul di base64,
 *    jadi membuka escape-nya tidak dapat merusak isi sertifikat.
 */
function normalizedCaValue(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let value = raw.trim();
  if (value === '') return null;

  const quoted =
    (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
  if (quoted) value = value.slice(1, -1);

  if (!value.includes('\n') && value.includes('\\n')) {
    value = value.replace(/\\r\\n|\\n/g, '\n').replace(/\\r/g, '');
  }

  return value.trim();
}

/** Nilai `sslmode` pada URL (huruf kecil), atau `null` bila tidak ada/tak terurai. */
function sslModeOf(url: string): string | null {
  try {
    return new URL(url).searchParams.get('sslmode')?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/**
 * Host Supabase: `*.supabase.co`, `*.supabase.com`, `*.supabase.in` — termasuk
 * pooler `*.pooler.supabase.com`. Pembatas ini penting: CA bawaan hanya berisi
 * root Supabase, jadi memberikannya ke host lain justru menyempitkan kepercayaan.
 */
function isSupabaseHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === '') return false;
  return ['supabase.co', 'supabase.com', 'supabase.in'].some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

export function databaseSslOptions(
  url: string = process.env.DATABASE_URL ?? '',
  env: NodeJS.ProcessEnv = process.env,
): { ssl?: { ca: string | string[] } } {
  const pem = normalizedCaValue(env.DATABASE_CA_CERT);
  if (pem) {
    if (isPemCertificate(pem)) return { ssl: { ca: pem } };

    // Nilai cacat jangan diteruskan ke TLS — hasilnya galat sertifikat yang
    // membingungkan dan sulit dilacak. Penyebab paling umum: PEM multi-baris di
    // `.env` ditulis **tanpa tanda kutip**, sehingga dotenv hanya membaca baris
    // pertama (tanpa kepala/ekor PEM). Dicatat ke log server, lalu dilanjutkan ke
    // sumber CA berikutnya.
    console.warn(
      '[database] DATABASE_CA_CERT bukan PEM sertifikat yang utuh (kepala/ekor hilang) dan diabaikan. ' +
        'Bila memakai .env, bungkus nilai multi-baris dengan tanda kutip (lihat .env.example).',
    );
  }

  const path = sslRootCertPath(url);
  if (path) {
    try {
      // `turbopackIgnore` disengaja: path datang dari connection string operator
      // (semantik libpq), jadi tidak mungkin diketahui saat build — dan justru
      // **tidak boleh** ikut di-trace. Tanpa anotasi ini Turbopack menyalin
      // seluruh proyek ke output server (peringatan "tracing of the whole
      // project"), memperbesar deployment. Berkasnya dibaca dari disk saat
      // runtime bila ada (mesin lokal); di Vercel tidak ada dan dilewati.
      return { ssl: { ca: readFileSync(/*turbopackIgnore: true*/ path, 'utf8') } };
    } catch {
      // Berkas tidak ada di mesin ini (kasus nyata: path Windows dari `.env`
      // lokal dipakai di Vercel): bukan alasan menggagalkan koneksi — lanjut ke
      // CA bawaan Supabase di bawah, bukan berhenti dengan galat "file hilang".
    }
  }

  const mode = sslModeOf(url);
  if (isSupabaseHost(url) && (mode === null || !LOOSE_SSL_MODES.has(mode))) {
    // Verifikasi tetap penuh: root bawaan Node **plus** root Supabase, sehingga
    // host publik lain tetap dapat diverifikasi bila hostnya berubah.
    return { ssl: { ca: [SUPABASE_ROOT_2021_CA, ...rootCertificates] } };
  }

  return {};
}

/**
 * Tanggal → string ISO 8601.
 *
 * postgres.js mengembalikan `timestamptz` sebagai `Date`, sedangkan klien yang
 * disuntikkan (PGlite, worker, test) mengembalikannya sebagai string — dan
 * halaman sudah memperlakukan nilai itu sebagai string (`verse.updated_at`,
 * `source.fetched_at` dipotong `.slice(0, 10)`). Tanpa normalisasi, kontrak yang
 * lulus di test berbeda dari produksi: halaman detail karakter dan verse
 * menjawab HTTP 500 `x.slice is not a function` pada kontak pertama dengan
 * database terisi (2026-10-10). Normalisasi di pintu masuk berarti setiap
 * pemanggil menerima bentuk yang sama, apa pun drivernya.
 *
 * Objek dari jsonb sengaja ikut ditelusuri: nilainya memang string JSON, tetapi
 * menyalin hanya saat ada perubahan membuat biaya ini sekali jalan per baris.
 */
function normalizeTimestamps(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((entry) => {
      const next = normalizeTimestamps(entry);
      if (next !== entry) changed = true;
      return next;
    });
    return changed ? items : value;
  }
  if (value !== null && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(row)) {
      const converted = normalizeTimestamps(entry);
      if (converted !== entry) changed = true;
      next[key] = converted;
    }
    return changed ? next : value;
  }
  return value;
}

let defaultClient: SqlClient | null = null;

export function getSqlClient(): SqlClient {
  if (injected) return injected;

  if (!process.env.DATABASE_URL) {
    throw new DatabaseNotConfiguredError(
      'DATABASE_URL',
      'Isi DATABASE_URL pada .env.local (lihat docs/PRD.md §39). Kredensial tidak boleh di-hardcode.',
    );
  }

  if (!defaultClient) {
    const sql = postgres(process.env.DATABASE_URL, {
      max: 10, // batas koneksi agar tidak membanjiri pool
      ...databaseSslOptions(),
    });
    
    defaultClient = {
      async query<T = Row>(text: string, params?: readonly unknown[]): Promise<T[]> {
        // postgres.js unsafe method mendukung sintaks $1, $2 beserta array parameternya
        const rows = (await sql.unsafe(text, (params as any[]) || [])) as unknown[];
        return rows.map(normalizeTimestamps) as T[];
      }
    };
  }

  return defaultClient;
}
