import type { Metadata } from 'next';

import { loadCharacterList, normalizePageSize } from '@/features/characters/queries.ts';
import { attemptLoad } from '@/features/data-source.ts';
import { isAdminAuthenticated } from '@/features/admin/session.ts';
import { DatabaseUnavailable } from '@/components/database-unavailable.tsx';
import { DEMO_LABEL, DEMO_NOTICE } from '@/features/demo/provider.ts';
import type { CharacterListItem } from '@/features/characters/queries.ts';

export const metadata: Metadata = {
  title: 'Character Database',
  description:
    'Cari karakter fiksi berdasarkan nama, alias, verse, tier, dan ability. Filter dan pagination dijalankan di server.',
  alternates: { canonical: '/characters' },
};

export const dynamic = 'force-dynamic';

export default async function CharactersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; per_page?: string; q?: string }>;
}) {
  const params = await searchParams;
  const perPage = normalizePageSize(Number(params.per_page));
  const page = Math.max(1, Math.floor(Number(params.page) || 1));
  const offset = (page - 1) * perPage;
  const query = params.q || '';

  // Pemilih sumber data: database dulu; dataset demo hanya bila database belum
  // dikonfigurasi dan ALLOW_DEMO_DATA=1 (lihat features/characters/queries.ts).
  // Galatnya lewat `attemptLoad`: halaman tetap 200 dengan panel jujur, bukan 500.
  const outcome = await attemptLoad(() => loadCharacterList({ limit: perPage, offset, query }));
  const rows: CharacterListItem[] = outcome.status === 'ok' ? outcome.data.rows : [];
  const total: number | null = outcome.status === 'ok' ? outcome.data.total : null;
  const failure: string | null = outcome.status === 'failed' ? outcome.message : null;
  const demoSource = outcome.status === 'ok' && outcome.data.source === 'demo';

  const totalPages = total ? Math.ceil(total / perPage) : 1;

  return (
    <div className="animate-fade-in-up">
      {demoSource && (
        <div className="mb-6 rounded-lg border border-accent-flag/30 bg-accent-flag/10 p-3 text-sm text-accent-flag">
          <strong>{DEMO_LABEL}.</strong> {DEMO_NOTICE}
        </div>
      )}

      {/* ─── Header Section ─── */}
      <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-ink-0 sm:text-4xl">
            Character <span className="text-gradient-vs">Database</span>
          </h1>
          <p className="mt-2 text-sm text-ink-2 max-w-2xl">
            Jelajahi entitas kanon, statistik, hax, dan resistensi dari berbagai verse.
            {total !== null && (
              <span className="block mt-1">
                Menampilkan <strong className="text-ink-0">{rows.length}</strong> dari total{' '}
                <strong className="text-ink-0">{total.toLocaleString('id-ID')}</strong> karakter (Halaman {page}/{totalPages}).
              </span>
            )}
          </p>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="w-full sm:w-auto flex flex-col gap-3 sm:flex-row sm:items-center">
          <form action="/characters" method="get" className="relative">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <svg className="h-4 w-4 text-ink-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Cari karakter..."
              className="input-field pl-9 h-10 w-full sm:w-64"
            />
          </form>
          <button className="h-10 rounded-lg border border-line bg-surface-1 px-4 text-sm font-medium text-ink-1 hover:bg-surface-2 transition-colors flex items-center gap-2">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filter
          </button>
        </div>
      </div>

      {/* ─── State Handling ─── */}
      {failure ? (
        // Detail teknis hanya untuk operator (lihat visibleFailureMessage);
        // pengunjung anonim menerima pesan generik.
        <DatabaseUnavailable detail={failure} viewerIsOperator={await isAdminAuthenticated()} />
      ) : rows.length === 0 ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface-1/50 p-8 text-center">
          <div className="h-12 w-12 text-4xl mb-4 opacity-50">🔍</div>
          <h2 className="text-lg font-medium text-ink-0">Belum ada karakter</h2>
          <p className="mt-1 text-sm text-ink-2 max-w-sm">
            {query 
              ? `Tidak ada hasil yang cocok dengan pencarian "${query}". Coba kata kunci lain.`
              : 'Database masih kosong. Lakukan ingestion data via admin dashboard.'}
          </p>
        </div>
      ) : (
        <>
          {/* ─── Character Grid ─── */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rows.map((character, index) => (
              <a
                key={character.id}
                href={`/character/${character.slug}`}
                className={`group flex flex-col justify-between overflow-hidden rounded-xl border border-line bg-surface-1 p-4 shadow-sm transition-all hover:-translate-y-1 hover:border-accent-b/50 hover:shadow-glow-b delay-${(index % 5) * 100}`}
              >
                <div className="flex items-start gap-4">
                  {/* Avatar / Image Placeholder */}
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-surface-2 border border-line-strong relative">
                    {character.image_url ? (
                      /* CSS-only preview: `next/image` membutuhkan konfigurasi remote
                         domain per sumber gambar (PRD F-23) dan dipasang bersama
                         pipeline atribusi artwork. Box ini menjaga bentuk kartu agar
                         layout daftar tidak berubah sebelum itu. */
                      <div
                        role="img"
                        aria-label={character.name}
                        title={`Artwork: ${character.name}`}
                        className="h-full w-full bg-surface-3"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-3 to-surface-1 text-ink-3">
                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                    )}
                    
                    {/* Completeness Badge */}
                    <div className="absolute -bottom-1 -right-1">
                      {character.data_completeness === 'complete' ? (
                        <div className="h-3 w-3 rounded-full bg-accent-win border-2 border-surface-1" title="Data lengkap" />
                      ) : character.data_completeness === 'partial' ? (
                        <div className="h-3 w-3 rounded-full bg-accent-flag border-2 border-surface-1" title="Data sebagian" />
                      ) : (
                        <div className="h-3 w-3 rounded-full bg-accent-lose border-2 border-surface-1" title="Data minimal" />
                      )}
                    </div>
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-base font-bold text-ink-0 group-hover:text-accent-b transition-colors">
                      {character.name}
                    </h2>
                    {character.native_name && (
                      <p className="truncate text-xs text-ink-3 mt-0.5">{character.native_name}</p>
                    )}
                    
                    <div className="mt-2 flex items-center gap-2">
                      {character.tier_code ? (
                        <span className="tier-badge tier-high text-[10px]">{character.tier_code}</span>
                      ) : (
                        <span className="tier-badge tier-high opacity-50 text-[10px]">Tier TBD</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Footer / Stats */}
                <div className="mt-4 flex items-center justify-between border-t border-line/50 pt-3 text-[0.65rem] text-ink-3">
                  <div className="flex items-center gap-1.5">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                    Pop: {Math.round(character.popularity_score)}
                  </div>
                  <div>
                    {new Date(character.updated_at).toLocaleDateString('id-ID', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </div>
                </div>
              </a>
            ))}
          </div>

          {/* ─── Pagination ─── */}
          {totalPages > 1 && (
            <div className="mt-10 flex items-center justify-center gap-2">
              <a
                href={`/characters?page=${page - 1}${query ? `&q=${query}` : ''}`}
                className={`flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-surface-1 text-ink-1 transition-colors hover:bg-surface-2 hover:text-ink-0 ${page <= 1 ? 'pointer-events-none opacity-50' : ''}`}
              >
                <span className="sr-only">Previous</span>
                &larr;
              </a>
              
              <div className="flex items-center px-4 text-sm font-medium text-ink-2">
                Halaman <span className="mx-1 text-ink-0">{page}</span> dari <span className="mx-1 text-ink-0">{totalPages}</span>
              </div>

              <a
                href={`/characters?page=${page + 1}${query ? `&q=${query}` : ''}`}
                className={`flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-surface-1 text-ink-1 transition-colors hover:bg-surface-2 hover:text-ink-0 ${page >= totalPages ? 'pointer-events-none opacity-50' : ''}`}
              >
                <span className="sr-only">Next</span>
                &rarr;
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}
