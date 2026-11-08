/**
 * Klien D1: menerjemahkan SQL gaya Postgres milik repo ini ke SQLite/D1.
 *
 * Kenapa terjemahan, bukan menulis ulang 100+ query: query aplikasi ditulis
 * untuk Postgres dan diverifikasi `tests/web/database-queries.test.ts` di atas
 * PGlite. Menulis ulang semuanya sekaligus berarti dua sumber kebenaran yang
 * cepat menyimpang. Di sini yang berbeda hanya **permukaan dialek** yang
 * memang tidak ada di SQLite (`$n::jsonb`, `now() - interval '1 day'`,
 * `count(*)::text`, `any($1::uuid[])`, operator jsonb), bukan bentuk query-nya.
 *
 * Yang TIDAK diterjemahkan dengan sengaja: `for update skip locked` dan
 * `power()`. Keduanya bukan perbedaan penulisan melainkan perbedaan semantik
 * (SQLite tidak punya penguncian baris), jadi pemanggilnya memilih jalur
 * sendiri lewat `sql.dialect` — lihat `services/queue/job-lifecycle.ts`.
 */

/** Baris hasil D1 — selalu objek biasa. */
export type D1Row = Record<string, unknown>;

/** Bagian `SqlClient` yang dipakai penerjemah ini. */
export interface D1LikeClient {
  query<T = D1Row>(text: string, params?: readonly unknown[]): Promise<T[]>;
  dialect?: 'postgres' | 'sqlite';
}

/** Kolom bertipe boolean di `docs/schema.d1.sql` (INTEGER 0/1). */
const BOOLEAN_COLUMNS = new Set([
  'active',
  'dry_run',
  'fact_check_passed',
  'good_faith',
  'higher_is_better',
  'is_active',
  'is_default',
  'is_defensive',
  'is_negation',
  'is_offensive',
  'is_passive',
  'is_physical',
  'is_prep_required',
  'is_primary',
  'is_public',
  'is_rankable',
  'is_resistible',
  'is_variant',
  'only_public',
  'requires_source_evidence',
  'respect_robots',
  'speed_equalized',
]);

/** Kolom bertipe jsonb di Postgres; di D1 disimpan sebagai TEXT. */
const JSON_COLUMNS = new Set([
  'after',
  'assumptions',
  'before',
  'constants',
  'cursor',
  'decisive_edges',
  'limitations',
  'params',
  'parsed_json',
  'payload',
  'props',
  'reasoning_refs',
  'result_payload',
  'score_breakdown',
  'secondary_factors',
  'select',
  'signals',
  'weights',
]);

/**
 * Apakah teks ini JSON yang aman diurai?
 *
 * Hanya objek/array: skalar seperti `5` atau `"x"` juga JSON yang sah, tetapi
 * kolom teks biasa (mis. `name = '5'`) tidak boleh berubah menjadi angka hanya
 * karena kebetulan dapat diurai.
 */
function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalisasi satu baris: `Date` → ISO, jsonb TEXT → objek, 0/1 → boolean.
 *
 * Dilakukan di pintu masuk supaya pemanggil tidak perlu tahu drivernya.
 */
export function normalizeD1Row<T>(row: D1Row): T {
  const next: D1Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      next[key] = value.toISOString();
    } else if (BOOLEAN_COLUMNS.has(key)) {
      next[key] = value === null || value === undefined ? null : value === 1 || value === true;
    } else if (JSON_COLUMNS.has(key)) {
      next[key] = typeof value === 'string' && looksLikeJson(value) ? JSON.parse(value) : value;
    } else {
      next[key] = value;
    }
  }
  return next as T;
}

/** `$1` → `?1`; tanda kutip tunggal dan komentar dilewati. */
export function rewritePlaceholders(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'") {
      const end = skipQuoted(text, i, "'");
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '"') {
      const end = skipQuoted(text, i, '"');
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '-' && text[i + 1] === '-') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '$' && /[0-9]/.test(text[i + 1] ?? '')) {
      let j = i + 1;
      while (j < text.length && /[0-9]/.test(text[j]!)) j += 1;
      out += `?${text.slice(i + 1, j)}`;
      i = j;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Buang cast Postgres (`::text`, `::jsonb`, `::uuid[]`, `::double precision`).
 *
 * SQLite tidak punya sintaks cast itu. Membuangnya aman karena kolom D1 sudah
 * bertipe TEXT/INTEGER/REAL: `count(*)::text` menjadi angka (pemanggil memakai
 * `Number(...)`), dan `$1::jsonb` tetap string yang disimpan apa adanya.
 */
export function stripCasts(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      const end = skipQuoted(text, i, ch);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '-' && text[i + 1] === '-') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === ':' && text[i + 1] === ':') {
      let j = i + 2;
      while (j < text.length && /[a-zA-Z0-9_ ]/.test(text[j]!)) {
        // `double precision` satu tipe; spasi hanya boleh di antaranya.
        if (text[j] === ' ' && !/^precision\b/.test(text.slice(j + 1))) break;
        j += 1;
      }
      if (text[j] === '[' && text[j + 1] === ']') j += 2;
      i = j;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Format waktu yang sama dengan `Date.prototype.toISOString()`. */
const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/**
 * Terjemahkan sisa dialek Postgres yang muncul di query aplikasi.
 *
 * Daftar ini sengaja sempit dan eksplisit: setiap aturan di sini adalah bentuk
 * yang benar-benar dipakai repo (diverifikasi lewat inventaris query), bukan
 * upaya menjadi penerjemah SQL umum. Bentuk yang tidak ada di daftar akan gagal
 * di D1 dengan pesan SQLite yang jelas — bukan diam-diam salah hasil.
 */
export function translateSql(text: string): string {
  let out = rewritePlaceholders(stripCasts(text));

  // `now() - interval '24 hours'` → `strftime(...,'-24 hours')`.
  // Format ISO (bukan `datetime()`) penting: kolom waktu di D1 berisi ISO 8601
  // dengan `T` dan `Z`, dan membandingkan `T` dengan spasi membuat baris di hari
  // yang sama ikut terhitung lebih baru daripada seharusnya.
  out = out.replace(
    /now\(\)\s*-\s*interval\s+'([^']+)'/gi,
    (_m, span: string) => `strftime('%Y-%m-%dT%H:%M:%fZ','now','-${span.trim()}')`,
  );
  // Sisa `now()` (tanpa aritmetika) memakai format ISO agar dapat dibandingkan
  // dengan parameter tanggal dari JavaScript.
  out = out.replace(/\bnow\(\)/gi, NOW_SQL);

  // `job_id = any(?1)` → `job_id in (select value from json_each(?1))`.
  out = out.replace(
    /([a-zA-Z_][\w.]*)\s*=\s*any\s*\(\s*\?(\d+)\s*\)/gi,
    (_m, column: string, index: string) =>
      `${column} in (select value from json_each(?${index}))`,
  );

  // `a.after -> 'params'` → `json_extract(a.after, '$.params')`.
  out = out.replace(
    /([a-zA-Z_]\w*\.[a-zA-Z_]\w*)\s*->>?\s*'([^']+)'/g,
    (_m, column: string, key: string) => `json_extract(${column}, '$.${key}')`,
  );

  return out;
}

/**
 * Nilai parameter yang dapat diikat D1.
 *
 * D1 hanya menerima null/string/number/ArrayBuffer. Tiga konversi di sini
 * menyamakan perilaku dengan postgres.js: `Date` → ISO, boolean → 0/1, dan
 * array (mis. `text[]`) → JSON yang dibaca `json_each`.
 */
export function bindValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (Array.isArray(value)) return JSON.stringify(value);
  return value;
}

/** Pernyataan D1 yang sudah/belum diikat parameter. */
export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  all<T = D1Row>(): Promise<{ results?: T[] }>;
}

/** Bagian `D1Database` yang dipakai, cukup untuk diuji dengan stub. */
export interface D1DatabaseLike {
  prepare(sql: string): D1StatementLike;
}

/**
 * Bungkus `env.DB` menjadi `SqlClient`.
 *
 * Tidak ada cache koneksi: binding D1 sudah merupakan handle ke database, dan
 * menyimpannya di modul justru berbahaya karena `env` berbeda per request di
 * Worker (isolate dipakai ulang, tetapi `env` diambil dari context request).
 */
export function createD1SqlClient(db: D1DatabaseLike): D1LikeClient {
  return {
    dialect: 'sqlite',
    async query<T = D1Row>(text: string, params: readonly unknown[] = []): Promise<T[]> {
      const statement = db.prepare(translateSql(text));
      const bound = params.length > 0 ? statement.bind(...params.map(bindValue)) : statement;
      const result = await bound.all<D1Row>();
      const rows = Array.isArray(result.results) ? result.results : [];
      return rows.map((row: D1Row) => normalizeD1Row<T>(row));
    },
  };
}

/** Akhir string berkutip (indeks setelah kutip penutup), termasuk escape `''`. */
function skipQuoted(text: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === quote) {
      if (text[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return text.length;
}
