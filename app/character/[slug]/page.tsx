import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const name = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  return {
    title: `${name}`,
    description: `Statistik, abilities, resistances, dan form dari ${name}.`,
    alternates: { canonical: `/character/${slug}` },
  };
}

export default async function CharacterPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ form?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const activeFormSlug = query.form || 'default';
  const name = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  // Mock data for UI presentation (Sprint 1 DB connection will replace this)
  const isMock = true;
  const mockForms = [
    { slug: 'default', name: 'Base Form', era: 'Pre-Timeskip', is_default: true },
    { slug: 'awakened', name: 'Awakened State', era: 'War Arc', is_default: false },
    { slug: 'final', name: 'Final Form', era: 'End of Series', is_default: false },
  ];

  return (
    <div className="animate-fade-in">
      {/* ─── Warning Mock Data ─── */}
      {isMock && (
        <div className="mb-6 rounded-lg border border-accent-flag/30 bg-accent-flag/10 p-3 text-sm text-accent-flag flex items-center gap-2">
          <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p>Tampilan ini menggunakan data mock. Koneksi ke `battle_dataset` sedang dalam pengembangan (Sprint 1).</p>
        </div>
      )}

      {/* ─── Hero Section ─── */}
      <div className="relative overflow-hidden rounded-2xl border border-line-strong bg-surface-1 shadow-card">
        <div className="absolute inset-0 bg-gradient-to-r from-accent-a/10 to-transparent opacity-50 pointer-events-none" />
        
        <div className="relative flex flex-col gap-6 p-6 sm:flex-row sm:items-end sm:p-8">
          {/* Avatar */}
          <div className="relative h-32 w-32 shrink-0 sm:h-40 sm:w-40">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-accent-a to-accent-b blur-md opacity-40 animate-pulse-glow" />
            <div className="relative h-full w-full overflow-hidden rounded-2xl border-2 border-line-strong bg-surface-2">
              <div className="flex h-full w-full items-center justify-center text-4xl text-ink-3">👤</div>
            </div>
          </div>

          {/* Info */}
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <span className="tier-badge tier-peak text-xs px-2 py-0.5">Tier 2-A</span>
              <span className="rounded bg-surface-3 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-ink-1">
                Data Lengkap
              </span>
            </div>
            
            <h1 className="text-3xl font-black text-ink-0 sm:text-5xl">{name}</h1>
            
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-2">
              <p><span className="font-semibold text-ink-3">Asal:</span> Mock Verse Universe</p>
              <p><span className="font-semibold text-ink-3">Klasifikasi:</span> Human, Fighter</p>
              <p><span className="font-semibold text-ink-3">Gender:</span> Male</p>
            </div>
          </div>

          {/* Battle Action */}
          <div className="sm:ml-auto">
            <a 
              href={`/versus?a=${slug}&af=${activeFormSlug}`}
              className="btn-battle flex w-full items-center justify-center gap-2 sm:w-auto"
            >
              Battle Character
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </a>
          </div>
        </div>
      </div>

      {/* ─── Form Tabs (Era/Versi) ─── */}
      <div className="mt-8 flex flex-wrap gap-2 border-b border-line pb-px">
        {mockForms.map((form) => {
          const isActive = form.slug === activeFormSlug;
          return (
            <a
              key={form.slug}
              href={`/character/${slug}?form=${form.slug}`}
              className={`relative rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-surface-2 text-accent-a border-x border-t border-line-strong'
                  : 'text-ink-2 hover:bg-surface-1 hover:text-ink-0'
              }`}
            >
              {form.name}
              {form.is_default && (
                <span className="ml-2 text-[0.6rem] uppercase tracking-wider text-ink-3">(Default)</span>
              )}
              {isActive && (
                <div className="absolute -bottom-px left-0 right-0 h-px bg-surface-2" />
              )}
            </a>
          );
        })}
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[2fr_1fr]">
        
        {/* ─── Left Column (Stats & Core) ─── */}
        <div className="space-y-8">
          
          {/* Stat Grid */}
          <section className="rounded-2xl border border-line bg-surface-1 p-6">
            <h2 className="mb-6 flex items-center gap-2 text-xl font-bold text-ink-0">
              <span className="text-accent-a">📊</span> Combat Statistics
            </h2>
            
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Mock Stat items */}
              <div className="rounded-xl border border-line-strong bg-surface-0/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-3 mb-1">Attack Potency</p>
                <p className="text-sm font-medium text-ink-0">Multiverse level+</p>
                <p className="mt-1 text-xs text-ink-2 italic">"Mampu menghancurkan ruang dan waktu..."</p>
              </div>
              
              <div className="rounded-xl border border-line-strong bg-surface-0/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-3 mb-1">Speed</p>
                <p className="text-sm font-medium text-ink-0">Massively FTL+</p>
                <p className="mt-1 text-xs text-ink-2 italic">"Melingkupi alam semesta dalam sedetik"</p>
              </div>
              
              <div className="rounded-xl border border-line-strong bg-surface-0/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-3 mb-1">Durability</p>
                <p className="text-sm font-medium text-ink-0">Multiverse level+</p>
                <p className="mt-1 text-xs text-ink-2 italic">"Menerima serangan eksistensial tanpa luka"</p>
              </div>
              
              <div className="rounded-xl border border-line-strong bg-surface-0/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-3 mb-1">Stamina</p>
                <p className="text-sm font-medium text-ink-0">Limitless</p>
                <p className="mt-1 text-xs text-ink-2 italic">"Bertarung tanpa henti selama 1000 tahun"</p>
              </div>
            </div>
          </section>

          {/* Abilities (Hax) */}
          <section className="rounded-2xl border border-line bg-surface-1 p-6">
            <h2 className="mb-6 flex items-center gap-2 text-xl font-bold text-ink-0">
              <span className="text-accent-b">✨</span> Abilities & Hax
            </h2>
            
            <div className="space-y-3">
              <div className="group rounded-xl border border-line-strong bg-surface-0/50 p-4 transition-colors hover:border-accent-b/50">
                <div className="flex items-start justify-between">
                  <h3 className="font-bold text-ink-0 group-hover:text-accent-b transition-colors">Time Manipulation</h3>
                  <span className="rounded bg-accent-b/10 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-accent-b">Master</span>
                </div>
                <p className="mt-2 text-sm text-ink-2">Dapat menghentikan waktu secara instan dan menyerang saat musuh terdiam.</p>
                <p className="mt-3 border-l-2 border-line-strong pl-3 text-xs italic text-ink-3">Bukti: Manga Chapter 142, hal 15.</p>
              </div>
              
              <div className="group rounded-xl border border-line-strong bg-surface-0/50 p-4 transition-colors hover:border-accent-b/50">
                <div className="flex items-start justify-between">
                  <h3 className="font-bold text-ink-0 group-hover:text-accent-b transition-colors">Existence Erasure</h3>
                  <span className="rounded bg-accent-b/10 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-accent-b">Advanced</span>
                </div>
                <p className="mt-2 text-sm text-ink-2">Menghapus target dari realitas. Membutuhkan kontak fisik.</p>
                <p className="mt-3 border-l-2 border-line-strong pl-3 text-xs italic text-ink-3">Bukti: Novel Vol 4.</p>
              </div>
            </div>
          </section>

        </div>

        {/* ─── Right Column (Resistances & Meta) ─── */}
        <div className="space-y-8">
          
          {/* Resistances */}
          <section className="rounded-2xl border border-line bg-surface-1 p-6">
            <h2 className="mb-6 flex items-center gap-2 text-xl font-bold text-ink-0">
              <span className="text-accent-win">🛡️</span> Resistances
            </h2>
            
            <ul className="space-y-3">
              <li className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm border border-line">
                <span className="font-medium text-ink-1">Mind Manipulation</span>
                <span className="text-xs font-bold text-accent-win">Absolute</span>
              </li>
              <li className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm border border-line">
                <span className="font-medium text-ink-1">Soul Manipulation</span>
                <span className="text-xs font-bold text-accent-win">High</span>
              </li>
              <li className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm border border-line">
                <span className="font-medium text-ink-1">Space-Time Hax</span>
                <span className="text-xs font-bold text-accent-win">Moderate</span>
              </li>
              <li className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm border border-line opacity-50">
                <span className="font-medium text-ink-1">Poison</span>
                <span className="text-xs font-bold text-ink-3">None</span>
              </li>
            </ul>
          </section>

          {/* Sources (Traceability) */}
          <section className="rounded-2xl border border-line bg-surface-1 p-6">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-ink-3">
              Data Traceability
            </h2>
            <div className="space-y-3">
              <p className="text-xs text-ink-2 leading-relaxed">
                Setiap klaim angka dan kemampuan yang digunakan dalam engine berasal dari sumber tercatat.
              </p>
              <ul className="space-y-2 border-t border-line/50 pt-3">
                <li className="flex flex-col gap-1">
                  <a href="#" className="text-xs font-medium text-accent-b hover:underline">Official Databook Vol 3</a>
                  <span className="text-[0.65rem] text-ink-3">Fetched: 05 Oct 2026 • Verified</span>
                </li>
                <li className="flex flex-col gap-1">
                  <a href="#" className="text-xs font-medium text-accent-b hover:underline">Manga Chapter 100-150</a>
                  <span className="text-[0.65rem] text-ink-3">Fetched: 01 Oct 2026 • Verified</span>
                </li>
              </ul>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
