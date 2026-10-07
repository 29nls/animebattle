import type { Metadata } from 'next';

import {
  DEFAULT_PAGE_SIZE,
  countCharacters,
  listCharacters,
  normalizePageSize,
} from '@/features/characters/queries.ts';
import { getSqlClient, DatabaseNotConfiguredError } from '@/lib/db/client.ts';
import type { CharacterListItem } from '@/features/characters/queries.ts';

export const metadata: Metadata = {
  title: 'Character database',
  description:
    'Cari karakter fiksi berdasarkan nama, alias, verse, tier, dan ability. Filter dan pagination dijalankan di server.',
  alternates: { canonical: '/characters' },
};

export const dynamic = 'force-dynamic';

/**
 * Halaman ini adalah contoh aturan PRD §18 dan §24 yang paling mudah dilanggar:
 * memuat semua karakter ke browser lalu memfilter di klien. Di sini filter dan
 * pagination dikerjakan SQL; browser hanya menerima satu halaman.
 */
export default async function CharactersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; per_page?: string }>;
}) {
  const params = await searchParams;
  const perPage = normalizePageSize(Number(params.per_page));
  const page = Math.max(1, Math.floor(Number(params.page) || 1));
  const offset = (page - 1) * perPage;

  let rows: CharacterListItem[] = [];
  let total: number | null = null;
  let failure: string | null = null;

  try {
    const sql = getSqlClient();
    [rows, total] = await Promise.all([
      listCharacters(sql, { limit: perPage, offset }),
      countCharacters(sql),
    ]);
  } catch (error) {
    // Database belum dikonfigurasi bukan kesalahan pengguna, dan menampilkan
    // halaman error 500 untuk itu menyembunyikan penyebab sebenarnya.
    failure =
      error instanceof DatabaseNotConfiguredError
        ? error.message
        : `Gagal memuat data: ${error instanceof Error ? error.message : String(error)}`;
  }

  return (
    <>
      <h1 className="text-2xl font-semibold text-ink-0">Character database</h1>
      {total !== null ? (
        <p className="mt-1 text-sm text-ink-2">
          {total.toLocaleString('id-ID')} karakter terdaftar · halaman {page} ·{' '}
          {DEFAULT_PAGE_SIZE} per halaman default (maks 200)
        </p>
      ) : null}

      {failure ? (
        <div className="mt-6 rounded-lg border border-line bg-surface-1 p-5 text-sm">
          <p className="font-medium text-accent-flag">Sumber data belum tersambung</p>
          <p className="mt-2 text-ink-2">{failure}</p>
          <p className="mt-3 text-ink-3">
            Layout, pagination server-side, dan pemilihan kolom sudah berjalan; yang belum ada hanya
            koneksi database (Sprint 1).
          </p>
        </div>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm text-ink-2">Belum ada karakter pada halaman ini.</p>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {rows.map((character) => (
            <li key={character.id} className="rounded-lg border border-line bg-surface-1 p-4">
              <a
                className="font-medium text-ink-0 hover:underline"
                href={`/character/${character.slug}`}
              >
                {character.name}
              </a>
              {character.native_name ? (
                <span className="ml-2 text-sm text-ink-3">{character.native_name}</span>
              ) : null}
              <p className="mt-2 text-xs text-ink-3">
                Kelengkapan data: {character.data_completeness} · popularitas{' '}
                {character.popularity_score}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
