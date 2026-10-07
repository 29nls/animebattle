import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Verses / Universes',
  description: 'Jelajahi semua semesta fiksi yang terdaftar dalam database.',
  alternates: { canonical: '/verses' },
};

export const dynamic = 'force-dynamic';

export default function VersesPage() {
  // Mock data — akan terhubung ke listVerses() setelah DB aktif
  const mockVerses = [
    { slug: 'dragon-ball', name: 'Dragon Ball', characters: 245, media: 'Manga', top_tier: '2-A' },
    { slug: 'naruto', name: 'Naruto', characters: 189, media: 'Manga', top_tier: '5-B' },
    { slug: 'one-piece', name: 'One Piece', characters: 312, media: 'Manga', top_tier: '6-A' },
    { slug: 'bleach', name: 'Bleach', characters: 156, media: 'Manga', top_tier: '3-A' },
    { slug: 'jojo', name: "JoJo's Bizarre Adventure", characters: 98, media: 'Manga', top_tier: '2-A' },
    { slug: 'marvel', name: 'Marvel Comics', characters: 520, media: 'Comic', top_tier: '1-A' },
  ];

  return (
    <div className="animate-fade-in">
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight text-ink-0 sm:text-4xl">
          Verse <span className="text-gradient-vs">Encyclopedia</span>
        </h1>
        <p className="mt-2 text-sm text-ink-2 max-w-2xl">
          Setiap verse memiliki kosmologi, hukum alam, dan skala kekuatan yang berbeda.
          Jelajahi semesta yang tersedia di database.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {mockVerses.map((verse) => (
          <a
            key={verse.slug}
            href={`/verse/${verse.slug}`}
            className="group relative overflow-hidden rounded-2xl border border-line bg-surface-1 p-6 shadow-sm transition-all hover:-translate-y-1 hover:border-accent-b/50 hover:shadow-card-hover"
          >
            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-accent-b/5 blur-2xl transition-colors group-hover:bg-accent-b/10" />
            
            <div className="relative z-10">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-2 border border-line-strong text-2xl shadow-sm">
                🌌
              </div>
              
              <h2 className="text-xl font-bold text-ink-0 group-hover:text-accent-b transition-colors">
                {verse.name}
              </h2>
              
              <div className="mt-4 flex items-center gap-3 text-xs text-ink-2">
                <span className="flex items-center gap-1">
                  <span className="font-bold text-ink-0">{verse.characters}</span> characters
                </span>
                <span className="h-3 w-px bg-line" />
                <span>{verse.media}</span>
                <span className="h-3 w-px bg-line" />
                <span className="tier-badge tier-high text-[9px]">{verse.top_tier}</span>
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
