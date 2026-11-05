/**
 * Memecah berkas SQL gaya psql menjadi pernyataan yang dapat dijalankan driver.
 *
 * `scripts/refresh-mv.sql` sengaja ditulis untuk psql (memuat `\timing`), tetapi
 * refresh CONCURRENTLY juga harus dapat dijalankan dari CI tanpa psql. Fungsi ini
 * membuang meta-command psql dan komentar baris, lalu memecah pada `;`.
 *
 * Batasan yang disengaja: berkas yang dipakai hanya berisi pernyataan sederhana
 * tanpa `;` di dalam string/dollar-quote. Jika suatu saat itu berubah, pakai
 * pemecah yang sadar-kutip (atau jalankan lewat psql).
 */
export function parseSqlStatements(sql) {
  const withoutMeta = sql
    .split(/\r?\n/)
    .filter((line) => !/^\s*\\/.test(line))
    .join('\n');

  return withoutMeta
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

export function countConcurrentRefreshes(statements) {
  return statements.filter((statement) =>
    /^refresh\s+materialized\s+view\s+concurrently\s+/i.test(statement),
  ).length;
}
