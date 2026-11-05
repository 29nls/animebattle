/**
 * Validasi laporan legal sebelum menyentuh database.
 *
 * Formulir menerima kontak dan URL, bukan data karakter. Validasi dilakukan di
 * server (bukan hanya atribut HTML) karena endpoint dapat dipanggil langsung.
 */

export const LEGAL_REPORT_KINDS = ['takedown', 'privacy'] as const;
export type LegalReportKind = (typeof LEGAL_REPORT_KINDS)[number];

export interface LegalReportInput {
  kind: LegalReportKind;
  name: string;
  email: string;
  url: string;
  description: string;
}

export type LegalReportParseResult =
  | { ok: true; value: LegalReportInput }
  | { ok: false; message: string };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Honeypot: field ini tidak pernah ditampilkan kepada manusia. */
function isFilled(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

export function parseLegalReport(input: unknown): LegalReportParseResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, message: 'Body harus berupa objek JSON.' };
  }
  const data = input as Record<string, unknown>;
  if (isFilled(data.website)) {
    return { ok: false, message: 'Permintaan tidak sah.' };
  }

  const kind = data.kind ?? 'takedown';
  if (kind !== 'takedown' && kind !== 'privacy') {
    return { ok: false, message: 'Jenis laporan tidak dikenal.' };
  }

  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (name.length < 2 || name.length > 120) {
    return { ok: false, message: 'Nama harus 2–120 karakter.' };
  }

  const email = typeof data.email === 'string' ? data.email.trim() : '';
  if (email.length < 5 || email.length > 254 || !EMAIL.test(email)) {
    return { ok: false, message: 'Alamat surel tidak sah.' };
  }

  const rawUrl = typeof data.url === 'string' ? data.url.trim() : '';
  if (rawUrl.length === 0 || rawUrl.length > 2048) {
    return { ok: false, message: 'URL yang dilaporkan wajib diisi (maksimal 2048 karakter).' };
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, message: 'URL yang dilaporkan tidak sah.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, message: 'URL harus menggunakan http atau https.' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, message: 'URL tidak boleh memuat kredensial.' };
  }

  const description = typeof data.description === 'string' ? data.description.trim() : '';
  if (description.length < 20 || description.length > 5000) {
    return { ok: false, message: 'Deskripsi harus 20–5000 karakter.' };
  }
  if (data.good_faith !== true) {
    return { ok: false, message: 'Pernyataan iktikad baik wajib dicentang.' };
  }

  return {
    ok: true,
    value: { kind, name, email, url: url.toString(), description },
  };
}
