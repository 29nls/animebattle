/**
 * Query untuk permalink matchup dan "Popular Battles".
 *
 * Sumber popularitas adalah `mv_battle_popularity` — materialized view yang
 * dihitung dari `battles`/`battle_results`. Tidak ada daftar hardcode: matchup
 * baru muncul di sana setelah benar-benar disimulasikan dan hasilnya tersimpan
 * (lihat `persistence.ts`). Refresh-nya dijalankan `npm run refresh:mv` lewat
 * `.github/workflows/refresh-views.yml`.
 *
 * Modul ini hanya SQL; pemanggil memutuskan apa yang ditampilkan bila database
 * belum dikonfigurasi atau view belum pernah di-refresh.
 */

import type { SqlClient } from '../../lib/db/client.ts';
import { parseMatchupSlug } from './share.ts';

/** Satu baris Popular Battles, sudah diurai menjadi dua sisi. */
export interface PopularMatchup {
  slug: string;
  simulations: number;
  shareCount: number;
  lastSimulatedAt: string;
}

interface PopularRow {
  matchup_key: string;
  simulations: number | string;
  share_count: number | string;
  last_simulated_at: string | Date | null;
}

/**
 * Matchup terpopuler, urut simulasi lalu share.
 *
 * Baris yang slug-nya tidak lagi dapat diurai dilewati: `matchup_key` adalah
 * `battles.slug` yang ditulis versi lama aplikasi, dan menautkan URL yang
 * jawabannya 404 lebih buruk daripada tidak menampilkannya. `null` tanggal
 * (MV belum di-refresh sejak tabel kosong) dianggap waktu nol, bukan `now()` —
 * kalau tidak, sitemap akan mengklaim konten berubah setiap kali dibaca.
 */
export async function listPopularMatchups(sql: SqlClient, limit = 12): Promise<PopularMatchup[]> {
  const rows = await sql.query<PopularRow>(
    `select matchup_key, simulations, share_count, last_simulated_at
       from mv_battle_popularity
      where simulations > 0
      order by simulations desc, share_count desc, matchup_key asc
      limit $1`,
    [limit],
  );

  const out: PopularMatchup[] = [];
  for (const row of rows) {
    if (!parseMatchupSlug(row.matchup_key)) continue;
    out.push({
      slug: row.matchup_key,
      simulations: Number(row.simulations),
      shareCount: Number(row.share_count),
      lastSimulatedAt:
        row.last_simulated_at === null ? new Date(0).toISOString() : new Date(row.last_simulated_at).toISOString(),
    });
  }
  return out;
}

/** Jumlah matchup yang tercatat, dipakai untuk teks "dari N pertarungan". */
export async function countPopularMatchups(sql: SqlClient): Promise<number> {
  const rows = await sql.query<{ n: number | string }>(
    `select count(*)::int as n from mv_battle_popularity where simulations > 0`,
  );
  return Number(rows[0]?.n ?? 0);
}
