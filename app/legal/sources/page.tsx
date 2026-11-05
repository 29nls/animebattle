import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sumber & Lisensi',
  description: 'Status lisensi sumber data Anime VS Battle dan batas impor otomatis.',
  alternates: { canonical: '/legal/sources' },
};

const SOURCES = [
  {
    name: 'Wikidata',
    data: 'Identitas, alias, relasi verse',
    license: 'CC0',
    status: 'allowed',
    note: 'Dump resmi; bukan crawl halaman.',
  },
  {
    name: 'Wikipedia',
    data: 'Deskripsi, alias',
    license: 'CC BY-SA 4.0',
    status: 'allowed',
    note: 'Dump/artikel dengan atribusi dan indikasi perubahan.',
  },
  {
    name: 'VS Battles Wiki / Fandom',
    data: 'Tier, statistik tempur, kemampuan',
    license: 'CC BY-SA 3.0 (per wiki)',
    status: 'restricted',
    note: 'Hanya dataset terkurasi; robots.txt 403, impor otomatis ditolak.',
  },
  {
    name: 'AniList',
    data: 'Identitas dan alias',
    license: 'ToS API (bukan lisensi data terbuka)',
    status: 'restricted',
    note: 'Hanya metadata non-bulk bila syarat komersial terpenuhi; bukan statistik tempur.',
  },
  {
    name: 'MyAnimeList, Jikan, Kitsu, AniDB, TMDB',
    data: 'Beragam',
    license: 'Tidak sesuai / tidak jelas',
    status: 'disabled',
    note: 'Tidak dipakai untuk impor.',
  },
] as const;

const STATUS_LABEL: Record<(typeof SOURCES)[number]['status'], string> = {
  allowed: 'Diizinkan untuk jalur yang tercatat',
  restricted: 'Terbatas — kurasi/manual',
  disabled: 'Dinonaktifkan',
};

export default function SourcesPage() {
  return (
    <div className="mx-auto max-w-4xl animate-fade-in pb-16 pt-8">
      <h1 className="text-3xl font-black text-ink-0 sm:text-5xl">Sumber &amp; Lisensi</h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-2">
        Halaman ini merangkum status sumber yang diperiksa pada 4 November 2026. Status{' '}
        <strong>restricted</strong> bukan izin impor otomatis: data hanya masuk melalui dataset
        terkurasi dan tetap harus memenuhi atribusi lisensi. Tidak ada gambar yang diimpor dari
        sumber berstatus restricted.
      </p>

      <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface-1">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-xs uppercase text-ink-3">
              <tr>
                <th className="px-4 py-3">Sumber</th>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Lisensi</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {SOURCES.map((source) => (
                <tr key={source.name} className="align-top">
                  <td className="px-4 py-3 font-medium text-ink-0">{source.name}</td>
                  <td className="px-4 py-3 text-ink-2">{source.data}</td>
                  <td className="px-4 py-3 text-ink-2">{source.license}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded px-2 py-0.5 text-[0.65rem] font-bold uppercase ${
                        source.status === 'allowed'
                          ? 'bg-accent-win/20 text-accent-win'
                          : source.status === 'restricted'
                            ? 'bg-accent-flag/20 text-accent-flag'
                            : 'bg-surface-3 text-ink-2'
                      }`}
                    >
                      {STATUS_LABEL[source.status]}
                    </span>
                    <p className="mt-1 text-xs text-ink-3">{source.note}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-accent-flag/30 bg-accent-flag/10 p-5 text-sm text-ink-2">
        <h2 className="font-bold text-ink-0">Batas yang jujur</h2>
        <p className="mt-2">
          Review sumber eksternal masih berupa gerbang terbuka: belum ada sumber baru yang
          diaktifkan, dan dataset awal tetap memakai impor terkurasi. Halaman ini tidak mengklaim
          bahwa seluruh data telah melalui persetujuan legal final. Bila Anda pemegang hak, gunakan{' '}
          <a href="/legal/takedown" className="text-accent-b underline underline-offset-2">
            formulir takedown
          </a>
          .
        </p>
      </div>

      <p className="mt-6 text-sm text-ink-2">
        Detail metodologi dan keterbatasan ada di{' '}
        <a href="/legal/methodology" className="text-accent-b underline underline-offset-2">
          halaman metodologi
        </a>
        .
      </p>
    </div>
  );
}
