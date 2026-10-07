import { getSqlClient } from '@/lib/db/client.ts';
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
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('Database belum dikonfigurasi') ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
}
