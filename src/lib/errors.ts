/**
 * Envelope error API (PRD §24) — `{ error: { code, message, details? } }`.
 *
 * Sebelum modul ini ada, setiap route menulis `{ error: "pesan" }` sendiri-sendiri.
 * Bentuk itu tidak dapat dibedakan oleh klien secara terprogram: pesan bahasa
 * manusia dipakai sebagai pengganti kode. PRD §24 menetapkan kode yang stabil,
 * sehingga klien (dan test) dapat memeriksa `code` tanpa mencocokkan teks.
 *
 * Modul ini sengaja hanya berisi pemetaan bentuk — bukan logika HTTP. Status
 * hanya diteruskan apa adanya, sehingga route tetap pemilik keputusan status.
 *
 * Zona `node-runtime` (PRD §39): tanpa impor apa pun; `Response` adalah global
 * web yang tersedia baik di route handler Next maupun di `node --test`.
 */

/** Kode error yang stabil, sejajar tabel kontrak error PRD §24. */
export type ApiErrorCode =
  | 'INVALID_INPUT'
  | 'MISSING_DATA'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'SOURCE_DISABLED'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  | 'UNAVAILABLE';

export interface ApiErrorOptions {
  /** Detail terstruktur (mis. `retry_after_ms`); tidak pernah bagian dari pesan. */
  details?: unknown;
  headers?: Record<string, string>;
}

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

/**
 * Bangun respons error dengan envelope kontrak. `details` hanya disertakan bila
 * diisi, sehingga respons tetap ramping untuk kasus umum.
 */
export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  options: ApiErrorOptions = {},
): Response {
  const body: ApiErrorBody = {
    error: options.details === undefined ? { code, message } : { code, message, details: options.details },
  };
  return Response.json(body, { status, headers: options.headers });
}
