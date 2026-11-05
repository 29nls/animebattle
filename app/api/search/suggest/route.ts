/**
 * `GET /api/search/suggest` — saran pencarian (autocomplete) dari database.
 *
 * Kontrak (APPENDICES G baris 11): maksimum 8 saran, di-cache pendek di edge.
 * Sebelum ini endpoint-nya belum ada, sehingga kotak pencarian tidak punya cara
 * mendapat saran selain memanggil `/api/search` penuh dan memotong hasilnya di
 * browser — yang berarti memuat lebih banyak kolom daripada yang dibutuhkan.
 *
 * Saran memakai **fungsi pencarian yang sama** (`search_characters_page`), bukan
 * query LIKE terpisah: dua jalur berbeda akan berpendapat berbeda tentang
 * peringkat, dan pengguna melihat hasil yang tidak cocok antara daftar saran dan
 * daftar hasil.
 *
 * Berbeda dari `/api/search`, `q` wajib diisi di sini: permintaan tanpa kueri
 * bukan permintaan saran yang sah, jadi ia dijawab 400 dengan alasan — bukan
 * dijawab delapan nama acak.
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
import { parseSuggestQuery } from '@/features/characters/search-params.ts';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

/** Batas saran yang dijanjikan kontrak. */
const SUGGEST_LIMIT = 8;

/** Autocomplete lebih murah dari pencarian penuh, tetapi tetap berkuota. */
const RATE_LIMIT = { scope: 'search-suggest', limit: 120, windowMs: 60_000 } as const;

export async function GET(request: NextRequest) {
  const parsed = parseSuggestQuery(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return apiError('INVALID_INPUT', parsed.message, 400);
  }

  const limited = await enforcePublicRateLimit(request.headers, RATE_LIMIT);
  if (limited) return limited;

  try {
    const sql = getSqlClient();
    const result = await searchCharacterPage(sql, {
      query: parsed.value.q,
      page: 1,
      perPage: SUGGEST_LIMIT,
    });

    return Response.json(
      {
        data: result.rows.map((row) => ({
          slug: row.slug,
          name: row.name,
          verse_name: row.verse_name,
          tier_code: row.tier_code,
        })),
        total: result.total,
      },
      { headers: searchCacheHeaders() },
    );
  } catch (error) {
    if (error instanceof DatabaseNotConfiguredError) {
      return apiError('UNAVAILABLE', error.message, 503);
    }
    if (isDatabaseUnavailable(error)) {
      await reportError(error, {
        event: 'api.search_suggest.database_unavailable',
        route: '/api/search/suggest',
      });
      return apiError('UNAVAILABLE', 'Database tidak dapat dihubungi saat ini.', 503);
    }
    await reportError(error, {
      event: 'api.search_suggest.unexpected',
      route: '/api/search/suggest',
    });
    return apiError('INTERNAL', 'Terjadi kesalahan internal.', 500);
  }
}
