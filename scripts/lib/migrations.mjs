/**
 * Daftar migrasi berversi. Berkas di `migrations/` adalah sumber kebenaran;
 * `docs/schema.sql` adalah snapshot yang dibandingkan CI.
 *
 * Checksum dinormalisasi ke LF supaya checkout Windows (CRLF) dan runner Linux
 * (LF) menghasilkan nilai yang sama. Isi SQL tidak boleh diubah setelah
 * diterapkan — perubahan skema selalu berupa berkas migrasi baru.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MIGRATION_FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

export function migrationChecksum(sql) {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

/**
 * @param {string} dir
 * @returns {{ version: string, file: string, path: string, sql: string, checksum: string }[]}
 */
export function listMigrations(dir) {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  if (files.length === 0) throw new Error(`Tidak ada migrasi di ${dir}`);

  const seen = new Set();
  return files.map((file) => {
    const match = MIGRATION_FILE_PATTERN.exec(file);
    if (!match) {
      throw new Error(
        `Nama migrasi tidak sah: ${file}. Gunakan format 0001_nama_berhuruf_kecil.sql.`,
      );
    }
    const version = file.replace(/\.sql$/, '');
    const prefix = match[1];
    if (seen.has(prefix)) {
      throw new Error(`Nomor migrasi ganda: ${prefix} (${file})`);
    }
    seen.add(prefix);

    const path = join(dir, file);
    const sql = readFileSync(path, 'utf8');
    return { version, file, path, sql, checksum: migrationChecksum(sql) };
  });
}
