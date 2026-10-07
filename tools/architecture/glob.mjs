/**
 * Pencocokan glob kecil, sengaja ditulis sendiri.
 *
 * Kenapa tidak memakai dependensi matcher: glob yang sama harus mengevaluasi
 * dua hal yang berbeda — konfigurasi ESLint (`files`/`ignores`) dan invarian
 * "setiap berkas berada di tepat satu zona" pada `check-architecture.mjs`. Kalau
 * keduanya memakai implementasi berbeda, invariannya hanya membuktikan bahwa
 * kedua implementasi itu berbeda, bukan bahwa cakupan zona benar. Satu
 * implementasi, dipakai keduanya.
 *
 * Mendukung: `**`, `*`, `{a,b}`, dan `?` — cukup untuk seluruh pola di repo ini.
 */

/** Mengubah pola glob menjadi RegExp yang cocok dengan seluruh string. */
export function globToRegExp(pattern) {
  let out = '^';

  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];

    if (char === '*') {
      const isDouble = pattern[i + 1] === '*';
      if (isDouble) {
        // `**/` juga harus cocok saat berada di awal pola (nol direktori).
        if (pattern[i + 2] === '/') {
          out += '(?:[^/]+/)*';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
      continue;
    }

    if (char === '?') {
      out += '[^/]';
      continue;
    }

    if (char === '{') {
      const close = pattern.indexOf('}', i);
      if (close === -1) throw new Error(`Pola glob tidak seimbang: ${pattern}`);
      const options = pattern
        .slice(i + 1, close)
        .split(',')
        .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&'));
      out += `(?:${options.join('|')})`;
      i = close;
      continue;
    }

    out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }

  return new RegExp(`${out}$`);
}

/** Zona cocok bila berkas sesuai `files` dan tidak sesuai `ignores`. */
export function matchesZone(path, zone) {
  const inFiles = zone.files.some((pattern) => globToRegExp(pattern).test(path));
  if (!inFiles) return false;

  const ignored = (zone.ignores ?? []).some((pattern) => globToRegExp(pattern).test(path));
  return !ignored;
}
