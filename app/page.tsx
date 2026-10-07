import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Anime VS Battle - Who Would Win?',
  description:
    'Compare thousands of fictional characters and simulate the battle. Pilih dua karakter, pilih form-nya, dan lihat analisis statistik, hax, serta resistances.',
  alternates: { canonical: '/' },
};

export default function HomePage() {
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
              Pencarian dijalankan di server dengan PostgreSQL full text dan trigram. 
              Lebih dari 10.000 karakter tersimpan dengan pembagian form (era/wujud) kelas satu.
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

      {/* ─── Popular Battles Placeholder ─── */}
      <section className="animate-fade-in-up delay-500 mt-16 pt-8 border-t border-line/40">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-bold text-ink-0">🔥 Popular Battles</h2>
            <p className="mt-1 text-sm text-ink-2">Matchup yang sering diuji minggu ini</p>
          </div>
        </div>
        
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Skeleton cards for empty state - adhering to PRD §31.4 */}
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col justify-between rounded-xl border border-line bg-surface-1 p-4 shadow-sm opacity-50">
              <div className="flex items-center justify-between">
                <div className="h-4 w-24 skeleton" />
                <span className="text-[0.65rem] font-bold text-ink-3">VS</span>
                <div className="h-4 w-24 skeleton" />
              </div>
              <div className="mt-4 flex items-center gap-2">
                <div className="h-2 w-full skeleton" />
              </div>
              <p className="mt-3 text-center text-[0.65rem] text-ink-3">
                Menunggu data mv_battle_popularity
              </p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
