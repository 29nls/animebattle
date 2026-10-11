import type { Metadata } from 'next';

import { attemptLoad } from '@/features/data-source.ts';
import { loadHomeMetrics } from '@/features/home/metrics.ts';
import type { HomeCatalogCounts, PopularBattle, RecentImport } from '@/features/home/metrics.ts';
import { isAdminAuthenticated } from '@/features/admin/session.ts';
import { DatabaseUnavailable } from '@/components/database-unavailable.tsx';

/**
 * Deskripsi ini tampil di hasil pencarian dan kartu pratinjau tautan, jadi ia
 * tidak boleh menjanjikan ukuran katalog: versi sebelumnya menjanjikan jumlah
 * karakter yang besar sementara katalog produksi berisi tiga karakter. Janji
 * ukuran katalog ditempatkan di halaman, di tempat angka sebenarnya dibaca dari
 * database — bukan di metadata statis yang tidak dapat menyesuaikan diri.
 *
 * `tests/web/home-metrics.test.ts` menjaga teks ini tetap bebas klaim jumlah.
 */
export const metadata: Metadata = {
  title: 'Anime VS Battle - Who Would Win?',
  description:
    'Pilih dua karakter, pilih form-nya, dan lihat analisis statistik, hax, serta resistances dari simulasi yang dapat dipertanggungjawabkan.',
  alternates: { canonical: '/' },
};

/**
 * Angka katalog dibaca dari database tiap permintaan. Tanpa `force-dynamic`,
 * build statis akan menyajikan jumlah karakter dari saat build dan membuat
 * homepage "berbohong" setelah impor berikutnya — persis masalah yang modul
 * `features/home/metrics.ts` ada untuk mencegahnya.
 */
export const dynamic = 'force-dynamic';

const NUMBER = new Intl.NumberFormat('id-ID');

/** Tanggal ringkas untuk daftar impor/matchup; `—` bila tidak ada. */
function formatDay(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toISOString().slice(0, 10);
}

const IMPORT_STATUS_LABEL: Record<RecentImport['status'], string> = {
  completed: 'selesai',
  partial: 'sebagian',
  failed: 'gagal',
};

export default async function HomePage() {
  // Galat database tidak boleh menjatuhkan homepage: `attemptLoad` mengubahnya
  // menjadi panel jujur, bukan HTTP 500 dan bukan angka contoh.
  const outcome = await attemptLoad(() => loadHomeMetrics());
  const metrics = outcome.status === 'ok' ? outcome.data : null;
  const counts: HomeCatalogCounts | null = metrics?.counts ?? null;
  const recentImports: RecentImport[] = metrics?.recentImports ?? [];
  const popularBattles: PopularBattle[] = metrics?.popularBattles ?? [];

  const statCards: Array<{ label: string; value: number; hint: string }> = counts
    ? [
        { label: 'Karakter', value: counts.characters, hint: 'entitas identitas' },
        { label: 'Form', value: counts.forms, hint: 'era/wujud' },
        { label: 'Verse', value: counts.verses, hint: 'semesta asal' },
        { label: 'Ability', value: counts.abilities, hint: 'katalog' },
        { label: 'Resistensi', value: counts.resistances, hint: 'tipe' },
      ]
    : [];

  return (
    <>
      {/* ─── Hero Section ─── */}
      <section className="relative -mt-12 overflow-hidden pb-16 pt-24 sm:pt-32">
        {/* Background elements */}
        <div className="absolute inset-0 -z-10 hero-radial" />
        <div className="absolute inset-0 -z-10 hero-grid opacity-50" />
        <div className="absolute top-1/4 left-1/4 -z-10 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-a/20 blur-[80px]" />
        <div className="absolute top-1/3 right-1/4 -z-10 h-64 w-64 translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-b/20 blur-[80px]" />

        <div className="relative mx-auto flex max-w-4xl flex-col items-center text-center">
          <div className="animate-fade-in-up">
            <span className="mb-4 inline-flex items-center rounded-full border border-line-strong bg-surface-1/50 px-3 py-1 text-xs font-medium text-ink-2 backdrop-blur-md">
              <span className="mr-2 flex h-2 w-2 rounded-full bg-accent-a animate-pulse-glow" />
              Battle Engine v1.0 Live
            </span>
          </div>

          <h1 className="animate-fade-in-up delay-100 mt-6 text-5xl font-black tracking-tight text-ink-0 sm:text-7xl">
            Selesaikan <span className="text-gradient-hero">Debat</span> Anda
          </h1>
          
          <p className="animate-fade-in-up delay-200 mt-6 max-w-2xl text-lg text-ink-2 sm:text-xl leading-relaxed">
            Pilih dua karakter. Kami menganalisis statistik, kemampuan (hax), dan pertahanan
            mereka untuk memberikan hasil simulasi pertarungan yang dapat dipertanggungjawabkan.
          </p>

          {/* VS Builder Form */}
          <div className="animate-fade-in-up delay-300 mt-12 w-full max-w-3xl relative">
            <div className="absolute inset-0 -z-10 rounded-2xl bg-gradient-to-r from-accent-a/20 to-accent-b/20 blur-xl animate-pulse-glow opacity-50" />
            
            <form action="/versus" method="get" className="glass-strong rounded-2xl border border-line-strong p-2 sm:p-4 shadow-card">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                
                {/* Character A */}
                <div className="relative flex-1 group">
                  <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-accent-a" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <input
                    name="a"
                    type="search"
                    required
                    placeholder="Karakter Pertama..."
                    className="w-full rounded-xl border border-line bg-surface-0/50 py-3 pl-10 pr-4 text-ink-0 placeholder:text-ink-3 outline-none transition-all focus:border-accent-a focus:bg-surface-0 focus:ring-1 focus:ring-accent-a"
                  />
                </div>

                {/* VS Badge */}
                <div className="relative flex justify-center -my-2 z-10 sm:my-0 sm:-mx-2">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 border-2 border-line-strong shadow-lg">
                    <span className="text-sm font-black text-gradient-vs">VS</span>
                  </div>
                </div>

                {/* Character B */}
                <div className="relative flex-1 group">
                  <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-accent-b" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <input
                    name="b"
                    type="search"
                    required
                    placeholder="Lawan..."
                    className="w-full rounded-xl border border-line bg-surface-0/50 py-3 pl-10 pr-4 text-ink-0 placeholder:text-ink-3 outline-none transition-all focus:border-accent-b focus:bg-surface-0 focus:ring-1 focus:ring-accent-b"
                  />
                </div>

                {/* Submit */}
                <div className="sm:ml-2">
                  <button
                    type="submit"
                    className="btn-battle w-full sm:w-auto h-[48px] flex items-center justify-center whitespace-nowrap"
                  >
                    Simulate
                  </button>
                </div>
                
              </div>
            </form>
          </div>
        </div>
      </section>

      {/* ─── Catalog Stats (dari database) ─── */}
      <section className="animate-fade-in-up delay-400 mt-4">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-bold text-ink-0">Katalog saat ini</h2>
          <p className="text-xs text-ink-3">
            {counts ? 'angka langsung dari database, tanpa cache' : 'sumber: database'}
          </p>
        </div>

        {outcome.status === 'failed' ? (
          <DatabaseUnavailable
            detail={outcome.message}
            viewerIsOperator={await isAdminAuthenticated()}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {statCards.map((card) => (
              <div
                key={card.label}
                className="rounded-xl border border-line bg-surface-1 p-4 shadow-sm"
              >
                <p className="text-2xl font-black tabular-nums text-ink-0">
                  {NUMBER.format(card.value)}
                </p>
                <p className="mt-1 text-xs font-medium text-ink-2">{card.label}</p>
                <p className="text-[0.65rem] text-ink-3">{card.hint}</p>
              </div>
            ))}
          </div>
        )}

        {counts && counts.characters === 0 && (
          <p className="mt-3 text-xs text-ink-2">
            Katalog masih kosong. Angka ini akan berubah setelah impor data pertama tercatat.
          </p>
        )}
      </section>

      {/* ─── Secondary Sections ─── */}
      <section className="animate-fade-in-up delay-400 mt-8 grid gap-6 sm:grid-cols-2">
        {/* Features / Database Intro */}
        <div className="group relative overflow-hidden rounded-2xl border border-line bg-surface-1 p-8 card-hover">
          <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-accent-b/10 blur-3xl transition-colors group-hover:bg-accent-b/20" />
          
          <div className="relative z-10">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-surface-2 border border-line-strong shadow-sm text-2xl">
              📚
            </div>
            <h2 className="text-xl font-bold text-ink-0">Character Database</h2>
            <p className="mt-3 text-sm text-ink-2 leading-relaxed">
              Pencarian dijalankan di server dengan PostgreSQL full text dan trigram,
              dengan pembagian form (era/wujud) sebagai entitas kelas satu.{' '}
              {counts
                ? `Saat ini tersimpan ${NUMBER.format(counts.characters)} karakter dalam ${NUMBER.format(counts.forms)} form dari ${NUMBER.format(counts.verses)} verse.`
                : 'Statistik katalog belum dapat dimuat; angka akan tampil setelah database dapat dihubungi.'}
            </p>
            <a className="mt-6 inline-flex items-center text-sm font-medium text-accent-b transition-colors hover:text-ink-0" href="/characters">
              Jelajahi Database
              <svg className="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </a>
          </div>
        </div>

        {/* Engine Intro */}
        <div className="group relative overflow-hidden rounded-2xl border border-line bg-surface-1 p-8 card-hover">
          <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-accent-a/10 blur-3xl transition-colors group-hover:bg-accent-a/20" />
          
          <div className="relative z-10">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-surface-2 border border-line-strong shadow-sm text-2xl">
              ⚙️
            </div>
            <h2 className="text-xl font-bold text-ink-0">Layered Battle Engine</h2>
            <p className="mt-3 text-sm text-ink-2 leading-relaxed">
              Bukan sekadar membandingkan angka besar. Engine kami mempertimbangkan hax, 
              resistensi, kondisi lingkungan, dan logika perlawanan untuk hasil deterministik.
            </p>
            <a className="mt-6 inline-flex items-center text-sm font-medium text-accent-a transition-colors hover:text-ink-0" href="/legal/methodology">
              Pelajari Metodologi
              <svg className="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </a>
          </div>
        </div>
      </section>

      {/* ─── Recent Imports (dari ingestion_jobs) ─── */}
      <section className="animate-fade-in-up delay-500 mt-16 border-t border-line/40 pt-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-bold text-ink-0">📥 Impor terakhir</h2>
            <p className="mt-1 text-sm text-ink-2">
              Hasil impor terkelola yang sudah selesai dicatat, termasuk yang gagal
            </p>
          </div>
        </div>

        {recentImports.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-strong bg-surface-1/50 p-6 text-sm text-ink-2">
            Belum ada impor tercatat. Impor terkelola (JSON/CSV) lewat panel admin akan muncul
            di sini bersama jumlah baris yang dibuat, diperbarui, dan gagal.
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-3">
            {recentImports.map((job) => (
              <li key={job.id} className="rounded-xl border border-line bg-surface-1 p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-bold text-ink-0">
                    {job.source_name ?? 'tanpa sumber terdaftar'}
                  </span>
                  <span className="shrink-0 rounded-full border border-line-strong px-2 py-0.5 text-[0.65rem] font-medium text-ink-2">
                    {IMPORT_STATUS_LABEL[job.status] ?? job.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-3">
                  {job.scope} · {formatDay(job.finished_at)}
                </p>
                <p className="mt-3 text-xs text-ink-2 tabular-nums">
                  {NUMBER.format(job.records_created)} dibuat · {NUMBER.format(job.records_updated)} diperbarui
                  {job.records_failed > 0 && (
                    <span className="text-accent-lose"> · {NUMBER.format(job.records_failed)} gagal</span>
                  )}
                </p>
                <p className="mt-1 text-[0.65rem] text-ink-3 tabular-nums">
                  {NUMBER.format(job.records_found)} record ditemukan
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ─── Popular Battles (dari mv_battle_popularity) ─── */}
      <section className="animate-fade-in-up delay-500 mt-12 pb-8">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-bold text-ink-0">🔥 Popular Battles</h2>
            <p className="mt-1 text-sm text-ink-2">Matchup dengan simulasi tersimpan terbanyak</p>
          </div>
        </div>

        {popularBattles.length === 0 ? (
          // Keadaan kosong yang jujur: sebelumnya bagian ini hanya menampilkan
          // rangka pemuatan tanpa pernah selesai, sehingga pengunjung menunggu
          // data yang memang belum ada. Angka di sini dihitung dari
          // `battles`/`battle_results`, jadi ia kosong sampai ada pertarungan
          // yang tersimpan — dan halaman mengatakannya, bukan menunggu.
          <div className="rounded-xl border border-dashed border-line-strong bg-surface-1/50 p-6 text-sm text-ink-2">
            Belum ada matchup populer yang tercatat. Daftar ini dihitung dari hasil pertarungan
            yang tersimpan (<span className="font-mono text-xs">battle_results</span>) &mdash; ia
            terisi setelah ada simulasi yang disimpan, bukan diisi angka contoh.
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {popularBattles.map((battle) => (
              <li
                key={battle.matchup_key}
                className="rounded-xl border border-line bg-surface-1 p-4 shadow-sm"
              >
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-bold text-ink-0" title={battle.side_a_form}>
                    {battle.side_a_character}
                  </span>
                  <span className="shrink-0 text-[0.65rem] font-bold text-ink-3">VS</span>
                  <span className="truncate font-bold text-ink-0" title={battle.side_b_form}>
                    {battle.side_b_character}
                  </span>
                </div>
                <p className="mt-3 text-xs text-ink-2 tabular-nums">
                  {NUMBER.format(battle.simulations)} simulasi · terakhir {formatDay(battle.last_simulated_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
