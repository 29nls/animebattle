/**
 * Metrik katalog untuk homepage — **semua angka berasal dari database**.
 *
 * Kenapa modul ini ada: homepage pernah mengiklankan "lebih dari 10.000
 * karakter" sementara database produksi berisi 3 karakter, dan bagian *Popular
 * Battles* dirender sebagai tiga kartu skeleton berlabel "Menunggu data
 * mv_battle_popularity" — placeholder yang menunggu selamanya. Keduanya klaim
 * tanpa sumber, dan itu dua pelanggaran berbeda:
 *
 *  1. **Angka aspirasional sebagai angka saat ini.** Angka yang tidak dibaca
 *     dari database akan tetap "10.000" bahkan saat katalognya kosong, jadi
 *     pembaca tidak dapat membedakan target dari kenyataan.
 *  2. **Keadaan kosong yang menyerupai keadaan memuat.** Skeleton yang menunggu
 *     data yang belum pernah ada membuat pengunjung menunggu, bukan memberi tahu
 *     bahwa matchup populer memang belum ada.
 *
 * Dua keputusan sadar di berkas ini:
 *
 *   * **Tidak ada jalur dataset demo.** Pemilih sumber di `features/characters`
 *     dan `features/verses` boleh jatuh ke dataset sintetis, tetapi angka
 *     katalog **tidak**: mencampur baris sintetis ke total yang ditampilkan
 *     sebagai katalog membuatnya tidak dapat diaudit (AC-09). Karena itu bila
 *     database belum dikonfigurasi, fungsi ini melempar — halaman menampilkan
 *     keadaan "statistik belum tersedia", bukan angka nol atau angka demo.
 *   * **Nol adalah hasil yang sah, bukan kegagalan.** Katalog kosong menjawab
 *     `0` dan UI mengatakan katalognya kosong; yang tidak boleh terjadi adalah
 *     angka nol yang menyamar sebagai katalog terisi, atau sebaliknya.
 *
 * Pola query mengikuti berkas fitur lain: kolom selalu eksplisit (tidak ada
 * `select *`), pagination di server, dan tidak ada SQL di komponen.
 */

import { getSqlClient, type SqlClient } from '../../lib/db/client.ts';

/** Jumlah baris katalog yang benar-benar tersimpan. */
export interface HomeCatalogCounts {
  characters: number;
  /** Form/era/wujud (`character_versions`), form yang sudah di-soft-delete tidak dihitung. */
  forms: number;
  verses: number;
  /** Katalog ability yang tersedia (bukan jumlah kepemilikan per form). */
  abilities: number;
  resistances: number;
}

export interface RecentImport {
  id: string;
  scope: string;
  status: 'completed' | 'partial' | 'failed';
  source_name: string | null;
  records_found: number;
  records_created: number;
  records_updated: number;
  records_failed: number;
  /** `completed_at` bila ada, jika tidak `created_at`; selalu ISO 8601. */
  finished_at: string;
}

export interface PopularBattle {
  /** Kunci matchup tersimpan (`battles.slug`), dipakai sebagai tautan stabil. */
  matchup_key: string;
  side_a_character: string;
  side_a_form: string;
  side_b_character: string;
  side_b_form: string;
  simulations: number;
  last_simulated_at: string | null;
}

export interface HomeMetrics {
  counts: HomeCatalogCounts;
  recentImports: RecentImport[];
  popularBattles: PopularBattle[];
}

/**
 * Satu round-trip untuk kelima hitungan.
 *
 * Subquery skalar, bukan lima query terpisah: halaman ini dirender tiap
 * permintaan (tidak ada cache yang boleh menyembunyikan katalog yang baru
 * berubah), sehingga lima perjalanan ke database per kunjungan homepage adalah
 * biaya yang tidak perlu. `count(*)` pada tabel besar justru yang diperbolehkan
 * lint — yang dilarang adalah `select *`.
 */
export async function countCatalog(sql: SqlClient): Promise<HomeCatalogCounts> {
  const rows = await sql.query<HomeCatalogCounts>(
    `select (select count(*) from characters)::int as characters,
            (select count(*) from character_versions where deleted_at is null)::int as forms,
            (select count(*) from verses)::int as verses,
            (select count(*) from abilities)::int as abilities,
            (select count(*) from resistance_types)::int as resistances`,
  );
  return rows[0] ?? { characters: 0, forms: 0, verses: 0, abilities: 0, resistances: 0 };
}

/**
 * Impor terakhir yang **selesai diputuskan** — termasuk yang gagal.
 *
 * Job `pending`/`processing` sengaja tidak ikut: ia belum punya hasil, dan
 * menampilkannya sebagai "impor terakhir" akan membuat baris ber-count nol
 * terbaca seperti impor kosong. Kegagalan ikut ditampilkan justru karena itu
 * yang perlu dilihat operator (AC-10: kegagalan tidak boleh hilang diam-diam).
 */
export async function listRecentImports(sql: SqlClient, limit = 3): Promise<RecentImport[]> {
  const capped = Math.min(Math.max(1, Math.floor(limit)), 10);
  return sql.query<RecentImport>(
    `select j.id, j.scope, j.status,
            s.name as source_name,
            j.records_found, j.records_created, j.records_updated, j.records_failed,
            coalesce(j.completed_at, j.created_at) as finished_at
       from ingestion_jobs j
       left join sources s on s.id = j.source_id
      where j.status in ('completed', 'partial', 'failed')
      order by coalesce(j.completed_at, j.created_at) desc
      limit $1`,
    [capped],
  );
}

/**
 * Matchup tersimpan, diurutkan menurut jumlah simulasi nyata.
 *
 * Sumbernya `mv_battle_popularity` — materialized view yang dihitung dari
 * `battles`/`battle_results`, bukan skor karangan. Bila belum ada hasil
 * pertarungan yang tersimpan, view-nya kosong dan fungsi ini mengembalikan
 * daftar kosong: halaman lalu mengatakan belum ada data, bukan menunggu.
 */
export async function listPopularBattles(sql: SqlClient, limit = 3): Promise<PopularBattle[]> {
  const capped = Math.min(Math.max(1, Math.floor(limit)), 12);
  return sql.query<PopularBattle>(
    `select p.matchup_key,
            ca.name as side_a_character, va.name as side_a_form,
            cb.name as side_b_character, vb.name as side_b_form,
            p.simulations, p.last_simulated_at
       from mv_battle_popularity p
       join character_versions va on va.id = p.side_a_version_id
       join characters ca on ca.id = va.character_id
       join character_versions vb on vb.id = p.side_b_version_id
       join characters cb on cb.id = vb.character_id
      order by p.simulations desc, p.matchup_key asc
      limit $1`,
    [capped],
  );
}

/**
 * Metrik lengkap homepage.
 *
 * Melempar bila database belum dikonfigurasi atau tidak dapat dihubungi —
 * pemanggil (`app/page.tsx`) membungkusnya dengan `attemptLoad`, sehingga galat
 * menjadi panel "belum tersedia", bukan HTTP 500 dan bukan angka palsu.
 */
export async function loadHomeMetrics(): Promise<HomeMetrics> {
  const sql = getSqlClient();
  const [counts, recentImports, popularBattles] = await Promise.all([
    countCatalog(sql),
    listRecentImports(sql),
    listPopularBattles(sql),
  ]);
  return { counts, recentImports, popularBattles };
}
