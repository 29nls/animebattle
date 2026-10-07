import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const name = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  return {
    title: `${name} Verse`,
    description: `Daftar karakter, peringkat kekuatan, dan informasi semesta ${name}.`,
    alternates: { canonical: `/verse/${slug}` },
  };
}

export default async function VersePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const name = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  // Mock data for UI presentation
  const topCharacters = [
    { id: '1', slug: 'char-1', name: 'Mock God', tier: 'Tier 1-A', popularity: 950 },
    { id: '2', slug: 'char-2', name: 'Mock Protagonist', tier: 'Tier 2-C', popularity: 820 },
    { id: '3', slug: 'char-3', name: 'Mock Villain', tier: 'Tier 3-A', popularity: 750 },
  ];

  // Blok "Terbaru" — syarat US-04 bersama deskripsi, jumlah karakter,
  // karakter terkuat, distribusi tier, dan terpopuler.
  const recentCharacters = [
    { id: 'r1', slug: 'char-2', name: 'Mock Protagonist', updated: '2 hari lalu' },
    { id: 'r2', slug: 'char-4', name: 'Mock Rival', updated: '5 hari lalu' },
    { id: 'r3', slug: 'char-1', name: 'Mock God', updated: '1 minggu lalu' },
  ];

  return (
    <div className="animate-fade-in">
      <div className="mb-6 rounded-lg border border-accent-flag/30 bg-accent-flag/10 p-3 text-sm text-accent-flag flex items-center gap-2">
        <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <p>Tampilan ini menggunakan data mock. Koneksi ke database verse sedang dalam pengembangan (Sprint 1).</p>
      </div>

      {/* ─── Hero Section ─── */}
      <div className="relative overflow-hidden rounded-2xl border border-line-strong bg-surface-1 p-8 shadow-card mb-8">
        <div className="absolute inset-0 bg-gradient-to-r from-accent-b/10 to-transparent opacity-50 pointer-events-none" />
        
        <div className="relative flex flex-col sm:flex-row sm:items-center gap-6">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl border-2 border-line-strong bg-surface-2 text-4xl shadow-lg">
            🌌
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-ink-3 mb-1">Verse / Universe</h2>
            <h1 className="text-3xl font-black text-ink-0 sm:text-5xl">{name}</h1>
            <p className="mt-3 text-sm text-ink-2 max-w-xl">
              Informasi kolektif mengenai semesta {name}. Menampilkan karakter terkuat, distribusi tier, dan hukum alam (cosmology) yang berlaku di dalam universe ini.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
        {/* ─── Left Column: Characters ─── */}
        <div className="space-y-6">
          <h2 className="text-xl font-bold text-ink-0 border-b border-line pb-2">Karakter Terpopuler</h2>
          
          <div className="grid gap-4">
            {topCharacters.map((char, i) => (
              <a
                key={char.id}
                href={`/character/${char.slug}`}
                className="group flex items-center justify-between rounded-xl border border-line bg-surface-1 p-4 shadow-sm transition-all hover:border-accent-b/50 hover:bg-surface-2"
              >
                <div className="flex items-center gap-4">
                  <div className="font-bold text-ink-3 w-4">{i + 1}</div>
                  <div className="h-12 w-12 rounded-lg bg-surface-3 flex items-center justify-center text-ink-3 border border-line-strong">
                    👤
                  </div>
                  <div>
                    <h3 className="font-bold text-ink-0 group-hover:text-accent-b transition-colors">{char.name}</h3>
                    <p className="text-xs text-ink-2 mt-0.5">Popularity: {char.popularity}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="tier-badge tier-high text-xs">{char.tier}</span>
                </div>
              </a>
            ))}
          </div>
          
          <div className="pt-4 text-center">
            <a href={`/characters?q=${slug}`} className="btn-primary inline-flex text-sm px-6">
              Lihat Semua Karakter {name}
            </a>
          </div>
        </div>

        {/* ─── Right Column: Stats & Meta ─── */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-line bg-surface-1 p-6">
            <h2 className="text-lg font-bold text-ink-0 mb-4">Cosmology & Stats</h2>
            
            <ul className="space-y-4 text-sm">
              <li className="flex justify-between border-b border-line pb-2">
                <span className="text-ink-2">Total Karakter</span>
                <span className="font-bold text-ink-0">142</span>
              </li>
              <li className="flex justify-between border-b border-line pb-2">
                <span className="text-ink-2">Top Tier Limit</span>
                <span className="font-bold text-accent-win">Tier 1-A</span>
              </li>
              <li className="flex justify-between pb-2">
                <span className="text-ink-2">Primary Medium</span>
                <span className="font-bold text-ink-0">Manga</span>
              </li>
            </ul>
          </div>
          
          <div className="rounded-2xl border border-line bg-surface-1 p-6">
            <h2 className="text-lg font-bold text-ink-0 mb-4">Baru Diperbarui</h2>
            <ul className="space-y-2 text-sm">
              {recentCharacters.map((char) => (
                <li key={char.id}>
                  <a
                    href={`/character/${char.slug}`}
                    className="flex items-center justify-between rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2"
                  >
                    <span className="font-medium text-ink-1 hover:text-accent-b">{char.name}</span>
                    <span className="text-xs text-ink-3">{char.updated}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-line bg-surface-1 p-6">
            <h2 className="text-lg font-bold text-ink-0 mb-4">Tier Distribution</h2>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center gap-2">
                <span className="w-12 text-ink-2">Tier 1</span>
                <div className="flex-1 h-2 bg-surface-2 rounded-full overflow-hidden">
                  <div className="bg-accent-a h-full" style={{ width: '15%' }} />
                </div>
                <span className="w-6 text-right font-bold">15%</span>
              </div>
              <div className="flex justify-between items-center gap-2">
                <span className="w-12 text-ink-2">Tier 2-3</span>
                <div className="flex-1 h-2 bg-surface-2 rounded-full overflow-hidden">
                  <div className="bg-accent-b h-full" style={{ width: '45%' }} />
                </div>
                <span className="w-6 text-right font-bold">45%</span>
              </div>
              <div className="flex justify-between items-center gap-2">
                <span className="w-12 text-ink-2">Tier 4+</span>
                <div className="flex-1 h-2 bg-surface-2 rounded-full overflow-hidden">
                  <div className="bg-accent-flag h-full" style={{ width: '40%' }} />
                </div>
                <span className="w-6 text-right font-bold">40%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
