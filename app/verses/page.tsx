import type { Metadata } from 'next';

import { loadVerseList } from '@/features/verses/queries.ts';
import { attemptLoad } from '@/features/data-source.ts';
import { isAdminAuthenticated } from '@/features/admin/session.ts';
import { DatabaseUnavailable } from '@/components/database-unavailable.tsx';
import { DEMO_LABEL, DEMO_NOTICE } from '@/features/demo/provider.ts';
import type { VerseListItem } from '@/features/verses/queries.ts';

export const metadata: Metadata = {
  title: 'Verses / Universes',
  description: 'Jelajahi semua semesta fiksi yang terdaftar dalam database.',
  alternates: { canonical: '/verses' },
};

export const dynamic = 'force-dynamic';

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

export default async function VersesPage() {
  // Galat database tidak boleh menjatuhkan halaman: `attemptLoad` mengubahnya
  // menjadi hasil `failed` yang dirender sebagai panel, bukan HTTP 500
  // (audit Lighthouse pernah gagal di sini dengan ERRORED_DOCUMENT_REQUEST).
  const outcome = await attemptLoad(() => loadVerseList());
  const rows: VerseListItem[] = outcome.status === 'ok' ? outcome.data.rows : [];

  return (
    <div className="animate-fade-in">
      {outcome.status === 'ok' && outcome.data.source === 'demo' && (
        <div className="mb-6 rounded-lg border border-accent-flag/30 bg-accent-flag/10 p-3 text-sm text-accent-flag">
          <strong>{DEMO_LABEL}.</strong> {DEMO_NOTICE}
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight text-ink-0 sm:text-4xl">
          Verse <span className="text-gradient-vs">Encyclopedia</span>
        </h1>
        <p className="mt-2 text-sm text-ink-2 max-w-2xl">
          Setiap verse memiliki kosmologi, hukum alam, dan skala kekuatan yang berbeda.
          Jelajahi semesta yang tersedia di database.
        </p>
      </div>

      {outcome.status === 'failed' ? (
        // Detail teknis hanya untuk operator (lihat visibleFailureMessage);
        // pengunjung anonim menerima pesan generik.
        <DatabaseUnavailable
          detail={outcome.message}
          viewerIsOperator={await isAdminAuthenticated()}
        />
      ) : rows.length === 0 ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface-1/50 p-8 text-center">
          <div className="h-12 w-12 text-4xl mb-4 opacity-50">🌌</div>
          <h2 className="text-lg font-medium text-ink-0">Belum ada verse</h2>
          <p className="mt-1 text-sm text-ink-2 max-w-sm">
            Database masih kosong. Verse muncul setelah ingestion data berjalan.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((verse) => (
            <a
              key={verse.id}
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

                {verse.description && (
                  <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-ink-2">{verse.description}</p>
                )}

                <div className="mt-4 flex items-center gap-3 text-xs text-ink-2">
                  <span className="flex items-center gap-1">
                    <span className="font-bold text-ink-0">{verse.character_count}</span> characters
                  </span>
                  <span className="h-3 w-px bg-line" />
                  <span>{MEDIA_LABELS[verse.media_type] ?? verse.media_type}</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
