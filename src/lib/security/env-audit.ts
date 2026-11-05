/**
 * Audit nama environment publik.
 *
 * `NEXT_PUBLIC_*` di-inline ke bundel browser saat build. Karena itu daftar
 * namanya harus eksplisit: variabel baru yang tidak sengaja diawali
 * `NEXT_PUBLIC_` akan membocorkan nilainya ke publik, dan tidak ada cara
 * mencabutnya setelah build. Fungsi ini hanya memeriksa **nama**, bukan nilai,
 * sehingga aman dijalankan di CI dan tidak pernah mencetak rahasia.
 */

/** Satu-satunya variabel publik yang diizinkan. Anon key Supabase memang publishable. */
export const PUBLIC_ENV_ALLOWLIST: readonly string[] = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SITE_URL',
];

const SECRET_LIKE =
  /(?:SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|SERVICE_ROLE|DATABASE_URL|DSN|CRON|WEBHOOK)/i;

/**
 * Kembalikan daftar pelanggaran. Nama publik yang tidak ada di allow-list
 * ditolak, termasuk nama yang terlihat tidak berbahaya — tujuannya mencegah
 * penambahan tanpa keputusan sadar.
 */
export function auditEnvNames(names: readonly string[]): string[] {
  const errors: string[] = [];
  for (const name of names) {
    if (!name.startsWith('NEXT_PUBLIC_')) continue;
    if (!PUBLIC_ENV_ALLOWLIST.includes(name)) {
      errors.push(
        `${name}: variabel NEXT_PUBLIC_ baru harus ditambahkan ke allow-list setelah ditinjau; nilai akan masuk bundel browser.`,
      );
      continue;
    }
    if (SECRET_LIKE.test(name) && name !== 'NEXT_PUBLIC_SUPABASE_ANON_KEY') {
      errors.push(`${name}: nama terlihat seperti rahasia dan tidak boleh publik.`);
    }
  }
  return errors;
}

/** Ambil nama variabel dari isi `.env.example`/`.env.local` tanpa membaca nilainya. */
export function extractEnvNames(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match?.[1]) names.push(match[1]);
  }
  return names;
}

/** Semua referensi `process.env.NEXT_PUBLIC_*` di sumber, untuk dicek terhadap allow-list. */
export function findPublicEnvReferences(source: string): string[] {
  const names = new Set<string>();
  const pattern = /process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1]) names.add(match[1]);
  }
  return [...names];
}
