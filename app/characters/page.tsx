import type { Metadata } from 'next';

import { loadCharacterList, type CharacterListItem } from '@/features/characters/queries.ts';
import {
  CHARACTER_MEDIA_VALUES,
  characterListHref,
  hasCharacterFilters,
  mediaLabel,
  parseCharacterListParams,
} from '@/features/characters/list-params.ts';
import { loadVerseFilterOptions, type VerseFilterOption } from '@/features/verses/queries.ts';
import { loadAttribution } from '@/features/attribution/queries.ts';
import { attemptLoad } from '@/features/data-source.ts';
import { isAdminAuthenticated } from '@/features/admin/session.ts';
import { DatabaseUnavailable } from '@/components/database-unavailable.tsx';
import { DataAttribution } from '@/components/data-attribution.tsx';
import { DEMO_LABEL, DEMO_NOTICE } from '@/features/demo/provider.ts';

export const metadata: Metadata = {
  title: 'Database Karakter',
  description:
    'Cari karakter fiksi berdasarkan nama, alias, verse, dan media. Filter serta pagination dijalankan di server.',
  alternates: { canonical: '/characters' },
};

export const dynamic = 'force-dynamic';

const NUMBER = new Intl.NumberFormat('id-ID');

const COMPLETENESS_LABEL: Record<CharacterListItem['data_completeness'], string> = {
  complete: 'Data lengkap',
  partial: 'Data sebagian',
  minimal: 'Data minimal',
};

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default async function CharactersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const filters = parseCharacterListParams({
    q: single(raw.q),
    verse: single(raw.verse),
    media: single(raw.media),
    page: single(raw.page),
    per_page: single(raw.per_page),
  });

  const offset = (filters.page - 1) * filters.perPage;

  // Filter verse bersifat pelengkap: kegagalan membacanya tidak boleh
  // menjatuhkan daftar karakter. Bila gagal, kontrol filter tetap tampil tanpa
  // opsi verse, bukan menghilang tanpa penjelasan.
  const [outcome, verseOptionsOutcome, attribution] = await Promise.all([
    attemptLoad(() =>
      loadCharacterList({
        limit: filters.perPage,
        offset,
        query: filters.query,
        verseSlug: filters.verseSlug,
        media: filters.media,
      }),
    ),
    attemptLoad(() => loadVerseFilterOptions()),
    loadAttribution(),
  ]);

  const rows: CharacterListItem[] = outcome.status === 'ok' ? outcome.data.rows : [];
  const total: number | null = outcome.status === 'ok' ? outcome.data.total : null;
  const failure: string | null = outcome.status === 'failed' ? outcome.message : null;
  const demoSource = outcome.status === 'ok' && outcome.data.source === 'demo';
  const verseOptions: VerseFilterOption[] =
    verseOptionsOutcome.status === 'ok' ? verseOptionsOutcome.data.rows : [];

  const totalPages = total && total > 0 ? Math.ceil(total / filters.perPage) : 1;
  const active = hasCharacterFilters(filters);

  const emptyTitle = active ? 'Tidak ada karakter yang cocok' : 'Belum ada karakter';
  const emptyDescription = filters.query
    ? `Pencarian “${filters.query}” tidak menemukan karakter pada filter yang dipilih. Coba kata kunci lain atau hapus filter.`
    : active
      ? 'Filter yang dipilih tidak menghasilkan karakter. Longgarkan salah satu filter untuk melihat lebih banyak data.'
      : 'Database masih kosong. Data karakter muncul setelah jalur impor terkelola dijalankan.';

  return (
    <div className="animate-fade-in-up">
      {demoSource && (
        <div className="mb-6 rounded-lg border border-accent-flag/30 bg-accent-flag/10 p-3 text-sm text-accent-flag">
          <strong>{DEMO_LABEL}.</strong> {DEMO_NOTICE}
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight text-ink-0 sm:text-4xl">
          Database <span className="text-gradient-vs">Karakter</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-2">
          Jelajahi entitas kanon, statistik, hax, dan resistensi dari berbagai verse. Setiap form
          (era/wujud) diperlakukan sebagai entitas terpisah karena kekuatannya dapat berbeda.
        </p>
      </div>

      {/* ─── Pencarian + filter ─── */}
      <form
        action="/characters"
        method="get"
        role="search"
        aria-label="Cari dan filter karakter"
        className="mb-6 rounded-2xl border border-line bg-surface-1 p-4 sm:p-5"
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
          <div>
            <label htmlFor="filter-q" className="mb-1.5 block text-xs font-semibold text-ink-2">
              Cari nama atau alias
            </label>
            <input
              id="filter-q"
              type="search"
              name="q"
              defaultValue={filters.query}
              placeholder="Mis. Saitama, ジェノス…"
              className="input-field h-10"
            />
          </div>

          <div>
            <label htmlFor="filter-verse" className="mb-1.5 block text-xs font-semibold text-ink-2">
              Verse
            </label>
            <select
              id="filter-verse"
              name="verse"
              defaultValue={filters.verseSlug ?? ''}
              className="input-field h-10"
            >
              <option value="">Semua verse</option>
              {verseOptions.map((verse) => (
                <option key={verse.slug} value={verse.slug}>
                  {verse.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-media" className="mb-1.5 block text-xs font-semibold text-ink-2">
              Media
            </label>
            <select
              id="filter-media"
              name="media"
              defaultValue={filters.media ?? ''}
              className="input-field h-10"
            >
              <option value="">Semua media</option>
              {CHARACTER_MEDIA_VALUES.map((media) => (
                <option key={media} value={media}>
                  {mediaLabel(media)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <input type="hidden" name="per_page" value={filters.perPage} />
            <button type="submit" className="btn-primary h-10 px-5 text-sm">
              Terapkan
            </button>
            {active && (
              <a
                href="/characters"
                className="inline-flex h-10 items-center rounded-lg border border-line bg-surface-2 px-4 text-sm text-ink-1 transition-colors hover:text-ink-0"
              >
                Hapus filter
              </a>
            )}
          </div>
        </div>

        {active && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-3">
            <span>Filter aktif:</span>
            {filters.query !== '' && (
              <span className="rounded-full border border-line-strong bg-surface-2 px-2.5 py-1 text-ink-1">
                Kata kunci: {filters.query}
              </span>
            )}
            {filters.verseSlug !== null && (
              <span className="rounded-full border border-line-strong bg-surface-2 px-2.5 py-1 text-ink-1">
                Verse: {filters.verseSlug}
              </span>
            )}
            {filters.media !== null && (
              <span className="rounded-full border border-line-strong bg-surface-2 px-2.5 py-1 text-ink-1">
                Media: {mediaLabel(filters.media)}
              </span>
            )}
          </div>
        )}
      </form>

      {total !== null && (
        <p className="mb-4 text-sm text-ink-2" aria-live="polite">
          {filters.query !== '' ? (
            <>
              Menampilkan <strong className="text-ink-0">{rows.length}</strong> dari{' '}
              <strong className="text-ink-0">{NUMBER.format(total)}</strong> hasil untuk “
              {filters.query}”.
            </>
          ) : (
            <>
              Menampilkan <strong className="text-ink-0">{rows.length}</strong> dari{' '}
              <strong className="text-ink-0">{NUMBER.format(total)}</strong> karakter.
            </>
          )}{' '}
          Halaman {filters.page} dari {totalPages}.
        </p>
      )}

      {failure ? (
        <DatabaseUnavailable detail={failure} viewerIsOperator={await isAdminAuthenticated()} />
      ) : rows.length === 0 ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface-1/50 p-8 text-center">
          <div aria-hidden="true" className="mb-4 text-4xl opacity-50">
            🔍
          </div>
          <h2 className="text-lg font-medium text-ink-0">{emptyTitle}</h2>
          <p className="mt-1 max-w-sm text-sm text-ink-2">{emptyDescription}</p>
          {active && (
            <a href="/characters" className="btn-primary mt-5 text-sm">
              Tampilkan semua karakter
            </a>
          )}
        </div>
      ) : (
        <>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rows.map((character) => {
              const updated = formatDate(character.updated_at);
              return (
                <li key={character.id}>
                  <a
                    href={`/character/${character.slug}`}
                    aria-label={`Buka karakter ${character.name}`}
                    className="group flex h-full flex-col justify-between overflow-hidden rounded-xl border border-line bg-surface-1 p-4 shadow-sm transition-all hover:-translate-y-1 hover:border-accent-b/50 hover:shadow-glow-b"
                  >
                    <div className="flex items-start gap-4">
                      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-line-strong bg-gradient-to-br from-surface-3 to-surface-1">
                        {character.image_url ? (
                          /* Placeholder CSS: `next/image` memerlukan konfigurasi
                             domain per sumber gambar (PRD F-23). Kotak ini menjaga
                             bentuk kartu sampai pipeline artwork siap. */
                          <div
                            role="img"
                            aria-label={`Artwork ${character.name}`}
                            className="h-full w-full bg-surface-3"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-ink-3">
                            <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                          </div>
                        )}
                        <span
                          className={`absolute bottom-1 right-1 h-3 w-3 rounded-full border-2 border-surface-1 ${
                            character.data_completeness === 'complete'
                              ? 'bg-accent-win'
                              : character.data_completeness === 'partial'
                                ? 'bg-accent-flag'
                                : 'bg-accent-lose'
                          }`}
                          title={COMPLETENESS_LABEL[character.data_completeness]}
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <h2 className="truncate text-base font-bold text-ink-0 transition-colors group-hover:text-accent-b">
                          {character.name}
                        </h2>
                        {character.native_name && (
                          <p className="mt-0.5 truncate text-xs text-ink-3">{character.native_name}</p>
                        )}
                        {character.verse_name && (
                          <p className="mt-1 truncate text-xs text-ink-2">{character.verse_name}</p>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          {character.tier_code ? (
                            <span className="tier-badge tier-high text-[10px]">{character.tier_code}</span>
                          ) : (
                            <span className="tier-badge tier-high text-[10px] opacity-50">
                              Tier belum tersedia
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-2 border-t border-line/50 pt-3 text-[0.65rem] text-ink-3">
                      <span className="inline-flex items-center gap-1.5">
                        <svg aria-hidden="true" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                        </svg>
                        Popularitas {Math.round(character.popularity_score)}
                      </span>
                      <span>{updated ?? 'Tanggal tidak tersedia'}</span>
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>

          {totalPages > 1 && (
            <nav aria-label="Navigasi halaman karakter" className="mt-10 flex items-center justify-center gap-2">
              {filters.page > 1 ? (
                <a
                  href={characterListHref(filters, { page: filters.page - 1 })}
                  className="flex h-10 min-w-10 items-center justify-center rounded-lg border border-line bg-surface-1 px-3 text-ink-1 transition-colors hover:bg-surface-2 hover:text-ink-0"
                  rel="prev"
                >
                  ← Sebelumnya
                </a>
              ) : (
                <span
                  aria-disabled="true"
                  className="flex h-10 min-w-10 items-center justify-center rounded-lg border border-line bg-surface-1 px-3 text-ink-3 opacity-50"
                >
                  ← Sebelumnya
                </span>
              )}

              <span className="px-3 text-sm text-ink-2">
                Halaman <strong className="text-ink-0">{filters.page}</strong> dari{' '}
                <strong className="text-ink-0">{totalPages}</strong>
              </span>

              {filters.page < totalPages ? (
                <a
                  href={characterListHref(filters, { page: filters.page + 1 })}
                  className="flex h-10 min-w-10 items-center justify-center rounded-lg border border-line bg-surface-1 px-3 text-ink-1 transition-colors hover:bg-surface-2 hover:text-ink-0"
                  rel="next"
                >
                  Berikutnya →
                </a>
              ) : (
                <span
                  aria-disabled="true"
                  className="flex h-10 min-w-10 items-center justify-center rounded-lg border border-line bg-surface-1 px-3 text-ink-3 opacity-50"
                >
                  Berikutnya →
                </span>
              )}
            </nav>
          )}
        </>
      )}

      <DataAttribution attribution={attribution} />
    </div>
  );
}
