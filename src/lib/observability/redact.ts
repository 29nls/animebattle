/**
 * Redaksi nilai yang masuk ke log atau laporan error.
 *
 * Tujuan modul ini bukan menyensor semua hal, melainkan memastikan nilai yang
 * *secara struktural* rahasia (password, token, DSN, cookie) tidak pernah
 * keluar dari proses. Log yang cantik tetapi membocorkan `DATABASE_URL` lebih
 * berbahaya daripada tidak punya log sama sekali.
 *
 * Fungsi di sini murni: tidak membaca environment dan tidak menulis output,
 * sehingga dapat diuji tanpa menjalankan server.
 */

const MAX_STRING_LENGTH = 1_000;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 40;
const MAX_DEPTH = 6;

/** Nama field yang nilainya tidak boleh pernah muncul di log. */
const SENSITIVE_KEY =
  /(?:pass(?:word|wd|phrase)?|secret|token|api[-_]?key|access[-_]?key|authorization|cookie|session|database_url|dsn|private[-_]?key|service[-_]?role|anon[-_]?key)/i;

/** Field yang mengidentifikasi seseorang; tidak diperlukan untuk diagnosa. */
const PII_KEY = /^(?:e?mail|reporter_e?mail|reporter_name|name|phone|address|ip|ip_address)$/i;

export const REDACTED = '[redacted]';

function redactString(value: string): string {
  let output = value
    // `postgres://user:password@host` — bentuk yang paling sering bocor lewat
    // pesan error driver atau URL konfigurasi.
    .replace(/(postgres(?:ql)?:\/\/)[^@\s/]+@/gi, `$1${REDACTED}@`)
    // `Authorization: Bearer …` dan varian tanpa header.
    .replace(/((?:authorization|bearer)\s*[:=]?\s*)[a-z0-9._~+/=-]+/gi, `$1${REDACTED}`)
    // `api_key=…`, `token: …`, dan sejenisnya.
    .replace(
      /((?:api[-_]?key|access[-_]?token|refresh[-_]?token|secret|password)\s*[=:]\s*)[^\s,;]+/gi,
      `$1${REDACTED}`,
    );

  if (output.length > MAX_STRING_LENGTH) {
    output = `${output.slice(0, MAX_STRING_LENGTH)}…[truncated]`;
  }
  return output;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function serializeError(error: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  if (seen.has(error)) return { name: error.name, message: '[circular]' };
  seen.add(error);

  const result: Record<string, unknown> = {
    name: error.name,
    message: redactString(error.message),
  };
  if (typeof error.stack === 'string' && error.stack !== '') {
    // Delapan baris pertama cukup untuk menunjukkan titik kegagalan; stack
    // penuh membuat satu error menghabiskan seluruh anggaran log.
    result.stack = error.stack
      .split('\n')
      .slice(0, 8)
      .map((line) => redactString(line))
      .join('\n');
  }
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause !== undefined) {
    result.cause = sanitizeValue(cause, 'cause', depth + 1, seen);
  }
  return result;
}

/**
 * Ubah nilai apa pun menjadi bentuk aman untuk `JSON.stringify`.
 *
 * `seen` mencegah objek melingkar membuat logger melempar error — logger yang
 * gagal saat menangani error adalah kegagalan ganda.
 */
export function sanitizeValue(
  value: unknown,
  key = '',
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (key !== '' && (SENSITIVE_KEY.test(key) || PII_KEY.test(key))) return REDACTED;
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol' || typeof value === 'function') return `[${typeof value}]`;

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return serializeError(value, depth, seen);

  if (depth >= MAX_DEPTH) return '[max-depth]';

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, key, depth + 1, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);

    if (!isPlainObject(value)) {
      return `[${value.constructor?.name ?? 'object'}]`;
    }

    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      output[entryKey] = sanitizeValue(entryValue, entryKey, depth + 1, seen);
    }
    return output;
  }

  return String(value);
}

/** Redaksi record datar (mis. header HTTP) tanpa mengubah tipe nilai lain. */
export function sanitizeRecord(record: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    output[key] = sanitizeValue(value, key);
  }
  return output;
}
