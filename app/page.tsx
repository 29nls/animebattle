import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Who Would Win?',
  description:
    'Compare thousands of fictional characters and simulate the battle. Pilih dua karakter, pilih form-nya, dan lihat analisis statistik, hax, serta resistances.',
  alternates: { canonical: '/' },
};

/**
 * Homepage (PRD §29). Server component tanpa state klien: satu-satunya
 * interaktivitas di MVP adalah form VS yang dikirim sebagai GET ke /versus,
 * sehingga halaman ini tetap terkirim sebagai HTML dan JS-nya minimal.
 *
 * Daftar "popular battles" sengaja TIDAK di-hardcode: PRD §31.4 menuntut daftar
 * itu berasal dari agregat `battle_popularity`. Sampai aggregatnya terisi, yang
 * ditampilkan adalah keadaan kosong beserta alasannya — bukan isian karangan.
 */
export default function HomePage() {
  return (
    <>
      <section className="py-10">
        <h1 className="text-4xl font-semibold tracking-tight text-ink-0 sm:text-5xl">
          Who Would Win?
        </h1>
        <p className="mt-3 max-w-2xl text-ink-2">
          Compare thousands of fictional characters and simulate the battle.
        </p>

        <form action="/versus" method="get" className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-ink-2">Character A</span>
            <input
              name="a"
              type="search"
              required
              placeholder="Cari karakter…"
              className="w-full rounded-md border border-line bg-surface-1 px-3 py-2 text-ink-0 placeholder:text-ink-3"
            />
          </label>

          <span aria-hidden className="self-center pb-2 text-lg font-bold text-accent-a">
            VS
          </span>

          <label className="flex-1 text-sm">
            <span className="mb-1 block text-ink-2">Character B</span>
            <input
              name="b"
              type="search"
              required
              placeholder="Cari karakter…"
              className="w-full rounded-md border border-line bg-surface-1 px-3 py-2 text-ink-0 placeholder:text-ink-3"
            />
          </label>

          <button
            type="submit"
            className="rounded-md bg-accent-b px-5 py-2 font-medium text-surface-0 hover:opacity-90"
          >
            Start Battle
          </button>
        </form>
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface-1 p-5">
          <h2 className="font-medium text-ink-0">Popular battles</h2>
          <p className="mt-2 text-sm text-ink-2">
            Belum ada data. Daftar ini diisi dari materialized view{' '}
            <code className="font-mono text-xs text-ink-1">mv_battle_popularity</code> setelah ada
            simulasi nyata — bukan daftar hardcode.
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface-1 p-5">
          <h2 className="font-medium text-ink-0">Character database</h2>
          <p className="mt-2 text-sm text-ink-2">
            Pencarian dijalankan di server (PostgreSQL full text + trigram). Browser tidak pernah
            menerima seluruh tabel karakter.
          </p>
          <a className="mt-3 inline-block text-sm text-accent-b hover:underline" href="/characters">
            Buka database →
          </a>
        </div>
      </section>
    </>
  );
}
