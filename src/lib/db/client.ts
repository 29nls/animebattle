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

import postgres from 'postgres';

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
    });
    
    defaultClient = {
      async query<T = Row>(text: string, params?: readonly unknown[]): Promise<T[]> {
        // postgres.js unsafe method mendukung sintaks $1, $2 beserta array parameternya
        return (await sql.unsafe(text, params as any[] || [])) as T[];
      }
    };
  }

  return defaultClient;
}
