import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Compare Characters',
  description:
    'Bandingkan statistik dan skala kekuatan dari dua karakter tanpa simulasi pertarungan.',
  alternates: { canonical: '/compare' },
};

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const params = await searchParams;
  const sideA = params.a?.trim() ?? '';
  const sideB = params.b?.trim() ?? '';
  const bothChosen = sideA !== '' && sideB !== '';

  // Mock comparison stats
  const stats = [
    { name: 'Attack Potency', a: 'Multiverse level', b: 'Universe level+', advantage: 'a' },
    { name: 'Speed', a: 'Massively FTL+', b: 'Immeasurable', advantage: 'b' },
    { name: 'Durability', a: 'Multiverse level', b: 'Universe level+', advantage: 'a' },
    { name: 'Lifting Strength', a: 'Stellar', b: 'Universal', advantage: 'b' },
    { name: 'Striking Strength', a: 'Multiversal', b: 'Universal+', advantage: 'a' },
    { name: 'Stamina', a: 'Limitless', b: 'Limitless', advantage: 'equal' },
    { name: 'Intelligence', a: 'Extraordinary Genius', b: 'Supergenius', advantage: 'b' },
    { name: 'Battle IQ', a: 'Extraordinary Genius', b: 'Genius', advantage: 'a' },
  ];

  return (
    <div className="animate-fade-in">
      {/* ─── Header ─── */}
      <div className="mb-8 text-center sm:text-left">
        <h1 className="text-3xl font-black tracking-tight text-ink-0 sm:text-4xl">
          Stat <span className="text-gradient-vs">Comparison</span>
        </h1>
        <p className="mt-2 text-sm text-ink-2 max-w-2xl mx-auto sm:mx-0">
          Mode perbandingan metrik secara mentah tanpa menjalankan engine pertarungan.
          Berguna untuk melihat keunggulan statistik tanpa mempertimbangkan hax atau kondisi.
        </p>
      </div>

      {/* ─── Character Selection ─── */}
      <form action="/compare" method="GET" className="mb-10">
        <div className="glass-strong rounded-2xl border border-line-strong p-2 sm:p-4 shadow-card">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            
            <div className="relative flex-1 group">
              <input
                name="a"
                type="search"
                defaultValue={sideA}
                required
                placeholder="Karakter A..."
                className="w-full rounded-xl border border-line bg-surface-0/50 py-3 px-4 text-ink-0 placeholder:text-ink-3 outline-none transition-all focus:border-accent-a focus:bg-surface-0 focus:ring-1 focus:ring-accent-a"
              />
            </div>

            <div className="relative flex justify-center -my-2 z-10 sm:my-0 sm:-mx-2">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 border-2 border-line-strong shadow-lg">
                <span className="text-sm font-black text-ink-2">VS</span>
              </div>
            </div>

            <div className="relative flex-1 group">
              <input
                name="b"
                type="search"
                defaultValue={sideB}
                required
                placeholder="Karakter B..."
                className="w-full rounded-xl border border-line bg-surface-0/50 py-3 px-4 text-ink-0 placeholder:text-ink-3 outline-none transition-all focus:border-accent-b focus:bg-surface-0 focus:ring-1 focus:ring-accent-b"
              />
            </div>

            <div className="sm:ml-2">
              <button type="submit" className="btn-primary w-full sm:w-auto h-[48px] flex items-center justify-center whitespace-nowrap px-6">
                Compare
              </button>
            </div>
            
          </div>
        </div>
      </form>

      {/* ─── Comparison Result ─── */}
      {bothChosen ? (
        <div className="animate-fade-in-up mt-8">
          
          <div className="mb-6 rounded-lg border border-accent-flag/30 bg-accent-flag/10 p-3 text-sm text-accent-flag flex items-center gap-2">
             <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p>Ini adalah tampilan mock. Mode perbandingan mentah tanpa engine diimplementasikan pada Sprint 3.</p>
          </div>

          <div className="rounded-2xl border border-line bg-surface-1 overflow-hidden">
            {/* Headers */}
            <div className="grid grid-cols-[1fr_120px_1fr] sm:grid-cols-[1fr_200px_1fr] bg-surface-2 border-b border-line p-4 text-center">
              <div className="font-bold text-accent-a truncate px-2 text-lg">{sideA}</div>
              <div className="font-semibold uppercase tracking-wider text-ink-3 text-xs self-center">Metric</div>
              <div className="font-bold text-accent-b truncate px-2 text-lg">{sideB}</div>
            </div>

            {/* Rows */}
            <div className="divide-y divide-line/50">
              {stats.map((stat, i) => (
                <div key={i} className="grid grid-cols-[1fr_120px_1fr] sm:grid-cols-[1fr_200px_1fr] p-4 text-sm items-center hover:bg-surface-2/30 transition-colors">
                  <div className={`text-right px-4 font-medium ${stat.advantage === 'a' ? 'text-accent-a' : 'text-ink-2'}`}>
                    {stat.a}
                  </div>
                  
                  <div className="text-center font-bold text-ink-1 uppercase text-[0.65rem] tracking-widest relative">
                    <span className="relative z-10 bg-surface-1 px-2">{stat.name}</span>
                    <div className="absolute top-1/2 left-0 right-0 h-px bg-line/30 -z-0" />
                  </div>
                  
                  <div className={`text-left px-4 font-medium ${stat.advantage === 'b' ? 'text-accent-b' : 'text-ink-2'}`}>
                    {stat.b}
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="mt-8 flex justify-center">
            <a href={`/versus?a=${sideA}&b=${sideB}`} className="btn-battle px-8 py-4 text-sm">
              Mulai Simulasi Engine ⚔️
            </a>
          </div>

        </div>
      ) : (
        <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface-1/50 p-8 text-center mt-8">
          <div className="h-12 w-12 text-4xl mb-4 opacity-50">⚖️</div>
          <h3 className="text-lg font-medium text-ink-0">Mulai Perbandingan</h3>
          <p className="mt-1 text-sm text-ink-2 max-w-sm">
            Ketikkan dua nama karakter pada kolom di atas untuk membandingkan statistik dasar mereka.
          </p>
        </div>
      )}
    </div>
  );
}
