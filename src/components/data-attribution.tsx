/**
 * Atribusi sumber + lisensi untuk halaman data.
 *
 * Satu komponen, bukan empat salinan: kewajiban atribusi (PRD §30, AC-09)
 * berlaku sama di daftar karakter, daftar verse, detail verse, homepage, dan
 * hasil pertarungan. Halaman karakter memakai panel Jejak Sumber Data yang lebih
 * rinci (per baris), tetapi tetap dapat memakai komponen ini untuk ringkasan
 * tingkat dataset.
 *
 * Komponen ini presentasional: tidak membaca database sendiri. Pemanggil
 * menyerahkan hasil `loadAttribution()`, yang membedakan `demo`, `unavailable`,
 * `failed`, dan `database` supaya ketiadaan data tidak tampil sebagai "tidak ada
 * sumber".
 */

import type { Attribution } from '@/features/attribution/queries.ts';

function externalHttpUrl(value: string | null): string | null {
  if (value === null) return null;
  return value.startsWith('https://') || value.startsWith('http://') ? value : null;
}

export function DataAttribution({ attribution }: { attribution: Attribution }) {
  const { rows, status } = attribution;

  return (
    <section
      aria-labelledby="sumber-lisensi-data"
      className="mt-12 rounded-2xl border border-line bg-surface-1 p-5 sm:p-6"
    >
      <h2 id="sumber-lisensi-data" className="text-sm font-bold uppercase tracking-wider text-ink-2">
        Sumber &amp; lisensi data
      </h2>
      <p className="mt-2 max-w-3xl text-xs leading-relaxed text-ink-2">
        Setiap statistik, kemampuan, dan resistensi di halaman ini berasal dari sumber publik yang
        tercatat. Nama karakter dan karya tetap milik pemegang hak masing-masing; data dipakai untuk
        referensi dan analisis komparatif.
      </p>

      {status === 'demo' && (
        <p className="mt-3 rounded-lg border border-accent-flag/30 bg-accent-flag/10 p-3 text-xs text-accent-flag">
          Dataset demo sintetis tidak memiliki sumber eksternal. Nama dan angkanya dibuat untuk
          pengujian, bukan data kanon dan tidak dapat ditelusuri.
        </p>
      )}

      {status === 'unavailable' && (
        <p className="mt-3 text-xs text-ink-3">
          Database belum terhubung, sehingga daftar sumber tidak dapat ditampilkan. Halaman data lain
          akan menampilkan panel yang sama sampai koneksi tersedia.
        </p>
      )}

      {status === 'failed' && (
        <p className="mt-3 text-xs text-ink-3">
          Daftar sumber gagal dimuat saat ini. Data yang tampil tetap berasal dari database, tetapi
          atribusinya belum dapat ditampilkan — coba muat ulang halaman.
        </p>
      )}

      {status === 'database' && rows.length === 0 && (
        <p className="mt-3 text-xs text-ink-3">
          Belum ada sumber eksternal yang tercatat untuk data yang ditampilkan.
        </p>
      )}

      {rows.length > 0 && (
        <ul className="mt-4 grid gap-3 border-t border-line/50 pt-4 sm:grid-cols-2">
          {rows.map((entry) => {
            const sourceUrl = externalHttpUrl(entry.source_url);
            const licenseUrl = externalHttpUrl(entry.license_url);
            return (
              <li key={`${entry.source_name}-${entry.license ?? ''}`} className="text-xs">
                {sourceUrl ? (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="nofollow noopener"
                    className="font-medium text-accent-b hover:underline"
                  >
                    {entry.source_name} ↗
                  </a>
                ) : (
                  <span className="font-medium text-ink-1">{entry.source_name}</span>
                )}
                <p className="mt-1 text-ink-3">
                  Lisensi:{' '}
                  {entry.license ? (
                    licenseUrl ? (
                      <a
                        href={licenseUrl}
                        target="_blank"
                        rel="nofollow noopener"
                        className="text-accent-b hover:underline"
                      >
                        {entry.license}
                      </a>
                    ) : (
                      entry.license
                    )
                  ) : (
                    'tidak dicantumkan oleh sumber'
                  )}
                </p>
                {entry.attribution_text && (
                  <p className="mt-1 leading-relaxed text-ink-3">{entry.attribution_text}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 border-t border-line/40 pt-3 text-[0.65rem] text-ink-3">
        Ingin data diperbaiki atau dihapus? Lihat{' '}
        <a href="/legal/takedown" className="text-accent-b hover:underline">
          prosedur takedown
        </a>{' '}
        dan{' '}
        <a href="/legal/methodology" className="text-accent-b hover:underline">
          metodologi
        </a>
        .
      </p>
    </section>
  );
}
