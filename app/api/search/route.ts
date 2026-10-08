import {
  DatabaseNotConfiguredError,
  getSqlClient,
  isDatabaseUnavailable,
} from '@/lib/db/client.ts';
import { apiError } from '@/lib/errors.ts';
import { searchCharacters } from '@/features/characters/queries.ts';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const q = searchParams.get('q');
  const limitStr = searchParams.get('limit');
  const limit = limitStr ? parseInt(limitStr, 10) : 10;

  if (!q || q.trim() === '') {
    return Response.json([]);
  }

  try {
    const sql = getSqlClient();
    const hits = await searchCharacters(sql, q, limit);
    return Response.json(hits);
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
