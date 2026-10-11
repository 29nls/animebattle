/**
 * `GET /api/search` — pencarian karakter hybrid (FTS + trigram + alias).
 *
 * Bentuk respons mengikuti konvensi daftar repo ini (APPENDICES G):
 * `{ data, page, per_page, total, has_more }`. Sebelum 2026-10-11 route ini
 * mengembalikan array polos tanpa pagination — artinya halaman tidak dapat
 * memberi tahu "ada berapa hasil" maupun mengambil halaman berikutnya, dan
 * pemanggil tidak dapat membedakan "kosong" dari "gagal".
 *
 * `total` dihitung di database (`search_characters_page`), bukan dari panjang
 * halaman, sehingga tetap benar pada halaman kosong.
 *
 * Urutan validasi disengaja: **parameter diperiksa sebelum database disentuh**,
 * sehingga penyalahgunaan parameter dijawab 400 tanpa membebani Postgres dan
 * tanpa bergantung pada database yang mungkin sedang bermasalah.
 */

import {
  DatabaseNotConfiguredError,
  getSqlClient,
  isDatabaseUnavailable,
} from '@/lib/db/client.ts';
import { apiError } from '@/lib/errors.ts';
import { searchCharacterPage } from '@/features/characters/queries.ts';
import { parseSearchQuery } from '@/features/characters/search-params.ts';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const parsed = parseSearchQuery(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return apiError('INVALID_INPUT', parsed.message, 400);
  }
  const { q, verseSlug, media, page, perPage } = parsed.value;

  try {
    const sql = getSqlClient();
    const result = await searchCharacterPage(sql, {
      query: q,
      verseSlug,
      media,
      page,
      perPage,
    });

    return Response.json({
      data: result.rows,
      page,
      per_page: perPage,
      total: result.total,
      has_more: page * perPage < result.total,
    });
  } catch (error) {
    // Konfigurasi yang hilang: pesannya operasional (menyebut env yang kurang),
    // aman ditampilkan dan berguna bagi operator.
    if (error instanceof DatabaseNotConfiguredError) {
      return apiError('UNAVAILABLE', error.message, 503);
    }
    // Gangguan konektivitas: jangan bocorkan detail driver ke pemanggil anonim
    // (host, TLS, pesan SQL); detailnya masuk log server, klien dapat 503.
    if (isDatabaseUnavailable(error)) {
      console.error('[api/search] database tidak dapat dihubungi:', error);
      return apiError('UNAVAILABLE', 'Database tidak dapat dihubungi saat ini.', 503);
    }
    console.error('[api/search] kesalahan tak terduga:', error);
    return apiError('INTERNAL', 'Terjadi kesalahan internal.', 500);
  }
}
