/**
 * `GET /api/characters/:slug/versions` — daftar form aktif satu karakter.
 *
 * Dipakai combobox `/versus`: setelah pengguna memilih karakter dari saran
 * pencarian, halaman hanya perlu form milik karakter itu. Sebelumnya seluruh
 * katalog dimuat sekali di server untuk mengisi `<select>`; endpoint ini membuat
 * payload sebanding dengan form satu karakter.
 *
 * Kontrak (APPENDICES G baris 3): `s-maxage=600`, 120/menit/IP. Slug divalidasi
 * sebelum database disentuh, dan karakter yang tidak ada dijawab 404 — bukan
 * daftar kosong yang membuat pengguna mengira karakternya ada tetapi kosong.
 */

import {
  DatabaseNotConfiguredError,
  getSqlClient,
  isDatabaseUnavailable,
} from '@/lib/db/client.ts';
import { apiError } from '@/lib/errors.ts';
import { enforcePublicRateLimit } from '@/lib/security/distributed-rate-limit.ts';
import { listPickerForms } from '@/features/battle/picker-queries.ts';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const RATE_LIMIT = { scope: 'character-versions', limit: 120, windowMs: 60_000 } as const;

/** Panjang maksimum slug di repo ini; cukup longgar untuk nama panjang. */
const MAX_SLUG_LENGTH = 120;

function validSlug(value: string): boolean {
  return value.length > 0 && value.length <= MAX_SLUG_LENGTH && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  if (!validSlug(slug)) {
    return apiError('INVALID_INPUT', 'Slug karakter tidak sah.', 400);
  }

  const limited = await enforcePublicRateLimit(request.headers, RATE_LIMIT);
  if (limited) return limited;

  try {
    const result = await listPickerForms(getSqlClient(), slug);
    if (!result) {
      return apiError('NOT_FOUND', `Karakter "${slug}" tidak ditemukan.`, 404);
    }

    return Response.json(
      { character: { slug, name: result.characterName }, data: result.options },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600',
        },
      },
    );
  } catch (error) {
    if (error instanceof DatabaseNotConfiguredError) {
      return apiError('UNAVAILABLE', error.message, 503);
    }
    if (isDatabaseUnavailable(error)) {
      console.error('[api/characters/versions] database tidak dapat dihubungi:', error);
      return apiError('UNAVAILABLE', 'Database tidak dapat dihubungi saat ini.', 503);
    }
    console.error('[api/characters/versions] kesalahan tak terduga:', error);
    return apiError('INTERNAL', 'Terjadi kesalahan internal.', 500);
  }
}
