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
import { searchCacheHeaders } from '@/lib/http-cache.ts';
import { reportError } from '@/lib/observability/report-error.ts';
import { enforcePublicRateLimit } from '@/lib/security/distributed-rate-limit.ts';
import { searchCharacterPage } from '@/features/characters/queries.ts';
import { parseSearchQuery } from '@/features/characters/search-params.ts';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Kuota PRD §24: 60/menit/IP. Diperiksa **sebelum** database data disentuh,
 * tetapi sesudah validasi parameter: permintaan yang jelas salah tetap dijawab
 * 400, bukan menghabiskan kuota.
 */
const RATE_LIMIT = { scope: 'search', limit: 60, windowMs: 60_000 } as const;

export async function GET(request: NextRequest) {
  const parsed = parseSearchQuery(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return apiError('INVALID_INPUT', parsed.message, 400);
  }
  const { q, verseSlug, media, page, perPage, types } = parsed.value;

  const limited = await enforcePublicRateLimit(request.headers, RATE_LIMIT);
  if (limited) return limited;

  try {
    const sql = getSqlClient();
    const result = await searchCharacterPage(sql, {
      query: q,
      verseSlug,
      media,
      page,
      perPage,
      types,
    });

    // Hasil anonim dan identik untuk semua pemanggil: aman di-cache bersama.
    // Header hanya dipasang pada respons sukses — galat 400/500/503 tidak boleh
    // tersimpan di edge, karena penyebabnya bisa sementara (DB down) dan
    // permintaan berikutnya berhak mendapat jawaban segar.
    return Response.json(
      {
        data: result.rows,
        page,
        per_page: perPage,
        total: result.total,
        has_more: page * perPage < result.total,
      },
      { headers: searchCacheHeaders() },
    );
  } catch (error) {
    // Konfigurasi yang hilang: pesannya operasional (menyebut env yang kurang),
    // aman ditampilkan dan berguna bagi operator.
    if (error instanceof DatabaseNotConfiguredError) {
      return apiError('UNAVAILABLE', error.message, 503);
    }
    // Gangguan konektivitas: jangan bocorkan detail driver ke pemanggil anonim
    // (host, TLS, pesan SQL); detailnya masuk log server, klien dapat 503.
    if (isDatabaseUnavailable(error)) {
      await reportError(error, {
        event: 'api.search.database_unavailable',
        route: '/api/search',
      });
      return apiError('UNAVAILABLE', 'Database tidak dapat dihubungi saat ini.', 503);
    }
    await reportError(error, { event: 'api.search.unexpected', route: '/api/search' });
    return apiError('INTERNAL', 'Terjadi kesalahan internal.', 500);
  }
}
