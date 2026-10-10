import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { loadVerseDetail } from '@/features/verses/queries.ts';
import { attemptLoad } from '@/features/data-source.ts';
import { isAdminAuthenticated } from '@/features/admin/session.ts';
import { DatabaseUnavailable } from '@/components/database-unavailable.tsx';
import { DEMO_LABEL, DEMO_NOTICE } from '@/features/demo/provider.ts';

export const dynamic = 'force-dynamic';

function titleFromSlug(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  // Metadata tidak boleh gagal sendiri: bila database belum terhubung, judul
  // jatuh ke slug dan isi halaman menampilkan panel galat yang jujur.
  const outcome = await attemptLoad(() => loadVerseDetail(slug));
  const bundle = outcome.status === 'ok' ? outcome.data : null;
  const name = bundle?.verse.name ?? titleFromSlug(slug);

  return {
    title: `${name} Verse`,
    description: bundle?.verse.description ?? `Daftar karakter, peringkat kekuatan, dan informasi semesta ${name}.`,
    alternates: { canonical: `/verse/${slug}` },
  };
}

const MEDIA_LABELS: Record<string, string> = {
  manga: 'Manga',
  anime: 'Anime',
  game: 'Game',
  novel: 'Novel',
  comic: 'Comic',
  movie: 'Movie',
  mixed: 'Mixed',
  other: 'Other',
};

export default async function VersePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const outcome = await attemptLoad(() => loadVerseDetail(slug));

  if (outcome.status === 'failed') {
    // Detail teknis hanya untuk operator; pengunjung anonim menerima pesan generik.
    return (
      <DatabaseUnavailable
        detail={outcome.message}
        viewerIsOperator={await isAdminAuthenticated()}
      />
    );
  }

  const bundle = outcome.data;
  if (!bundle) notFound();

  const { verse, characters, source } = bundle;

  return (
    <div className="animate-fade-in">
      {source === 'demo' && (
        <div className="mb-6 rounded-lg border border-accent-flag/30 bg-accent-flag/10 p-3 text-sm text-accent-flag flex items-start gap-2">
          <span className="mt-0.5">⚠️</span>
          <p>
            <strong>{DEMO_LABEL}.</strong> {DEMO_NOTICE}
          </p>
        </div>
      )}

      {/* ─── Hero Section ─── */}
      <div className="relative mb-8 overflow-hidden rounded-2xl border border-line-strong bg-surface-1 p-8 shadow-card">
        <div className="absolute inset-0 bg-gradient-to-r from-accent-b/10 to-transparent opacity-50 pointer-events-none" />

        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl border-2 border-line-strong bg-surface-2 text-4xl shadow-lg">
            🌌
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-ink-3 mb-1">Verse / Universe</h2>
            <h1 className="text-3xl font-black text-ink-0 sm:text-5xl">{verse.name}</h1>
            {verse.description && <p className="mt-3 max-w-xl text-sm text-ink-2">{verse.description}</p>}
          </div>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
        {/* ─── Left Column: Characters ─── */}
        <div className="space-y-6">
          <h2 className="border-b border-line pb-2 text-xl font-bold text-ink-0">Karakter di Verse Ini</h2>

          {characters.length === 0 ? (
            <p className="text-sm text-ink-3">Belum ada karakter terhubung ke verse ini.</p>
          ) : (
            <div className="grid gap-4">
              {characters.map((character, index) => (
                <a
                  key={character.id}
                  href={`/character/${character.slug}`}
                  className="group flex items-center justify-between rounded-xl border border-line bg-surface-1 p-4 shadow-sm transition-all hover:border-accent-b/50 hover:bg-surface-2"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-4 font-bold text-ink-3">{index + 1}</div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-line-strong bg-surface-3 text-ink-3">
                      👤
                    </div>
                    <div>
                      <h3 className="font-bold text-ink-0 transition-colors group-hover:text-accent-b">
                        {character.name}
                      </h3>
                      {character.native_name && <p className="mt-0.5 text-xs text-ink-3">{character.native_name}</p>}
                      <p className="mt-0.5 text-xs text-ink-2">Popularitas: {Math.round(character.popularity_score)}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    {character.tier_code && <span className="tier-badge tier-high text-xs">{character.tier_code}</span>}
                  </div>
                </a>
              ))}
            </div>
          )}

          <div className="pt-4 text-center">
            <a href={`/characters?q=${encodeURIComponent(verse.name)}`} className="btn-primary inline-flex px-6 text-sm">
              Lihat Karakter {verse.name}
            </a>
          </div>
        </div>

        {/* ─── Right Column: Stats & Meta ─── */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-line bg-surface-1 p-6">
            <h2 className="mb-4 text-lg font-bold text-ink-0">Ringkasan</h2>

            <ul className="space-y-4 text-sm">
              <li className="flex justify-between border-b border-line pb-2">
                <span className="text-ink-2">Total Karakter</span>
                <span className="font-bold text-ink-0">{verse.character_count}</span>
              </li>
              <li className="flex justify-between border-b border-line pb-2">
                <span className="text-ink-2">Media Utama</span>
                <span className="font-bold text-ink-0">{MEDIA_LABELS[verse.media_type] ?? verse.media_type}</span>
              </li>
              <li className="flex justify-between pb-2">
                <span className="text-ink-2">Diperbarui</span>
                <span className="font-bold text-ink-0">{verse.updated_at.slice(0, 10)}</span>
              </li>
            </ul>
          </div>

          <div className="rounded-2xl border border-line bg-surface-1 p-6">
            <h2 className="mb-4 text-lg font-bold text-ink-0">Distribusi Tier</h2>
            {characters.every((character) => !character.tier_code) ? (
              <p className="text-xs text-ink-3">Tier karakter belum tersedia di verse ini.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {characters
                  .filter((character) => character.tier_code)
                  .reduce<{ code: string; count: number }[]>((acc, character) => {
                    const existing = acc.find((entry) => entry.code === character.tier_code);
                    if (existing) existing.count += 1;
                    else acc.push({ code: character.tier_code as string, count: 1 });
                    return acc;
                  }, [])
                  .sort((a, b) => b.count - a.count)
                  .map((entry) => (
                    <li key={entry.code} className="flex items-center justify-between gap-2">
                      <span className="tier-badge tier-mid text-[10px]">{entry.code}</span>
                      <span className="font-bold text-ink-1">{entry.count} karakter</span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
