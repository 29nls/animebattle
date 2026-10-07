/**
 * Klasifikasi tabel: mana yang "besar" sehingga `select *` dilarang.
 *
 * Aturan PRD §39 hanya berbunyi "tidak ada `select *` pada tabel besar". Dua kata
 * itu harus dijawab sebelum aturannya bisa ditegakkan, dan jawaban yang tidak
 * diverifikasi akan membusuk: daftar tabel di sini pasti akan tertinggal dari
 * `docs/schema.sql` seiring waktu. Karena itu klasifikasi ini **lengkap** dan
 * diverifikasi: setiap tabel di schema harus muncul tepat sekali — sebagai besar
 * atau kecil. Menambah tabel baru tanpa memutuskan klasifikasinya akan
 * menggagalkan `npm run check:architecture`, bukan lolos diam-diam.
 *
 * Kriteria "besar" (artinya: `select *` di sini dapat menarik ratusan ribu baris
 * atau kolom berat/jsonb dalam satu query):
 *   (a) bertambah sebanding dengan jumlah karakter/form/fakta — target 100k
 *       karakter, dan banyak di antaranya berlipat per form (statistik ±13 baris
 *       per form; abilities, resistances, dan feats juga berlipat), atau
 *   (b) bertambah sebanding dengan trafik/fakta pengguna (analytics, audit,
 *       laporan, favorite, battles), atau
 *   (c) menyimpan payload besar (jsonb, teks bukti, potongan halaman) — di sini
 *       jumlah barisnya tidak perlu besar untuk membuat `select *` mahal.
 */

/** Nama tabel → alasan. Alasan wajib: daftar tanpa alasan tidak dapat ditinjau. */
export const LARGE_TABLES = {
  characters:
    'Tabel utama; target 10k–100k baris, dan `select *` ikut mengangkut description, seluruh kolom lisensi gambar, dan kolom audit.',
  character_aliases:
    'Beberapa alias per karakter (latin, kanji, romaji), jadi 3–5× jumlah karakter.',
  character_versions:
    'Satu karakter memiliki banyak form/era — inti model data (PRD §11); selalu lebih banyak dari `characters`.',
  character_traits: 'Banyak sifat per form; bertambah sebanding jumlah form.',
  equipment: 'Daftar equipment per form; bertambah sebanding jumlah form.',
  statistics:
    '±13 metrik per form (tier, AP, speed, durability, …); tabel fakta terbesar di skema.',
  character_abilities: 'Banyak ability per form, dengan kolom bukti dan sumber.',
  character_resistances: 'Banyak resistance per form, dengan kolom bukti.',
  feats: 'Banyak feat per form, menyimpan evidence_text yang panjang.',
  character_sources: 'Satu baris per pasangan karakter×sumber; bertambah dengan jumlah impor.',
  character_source_conflicts:
    'Tumbuh saat impor berulang menemukan data berbeda; justru bertambah seiring pemakaian (PRD §22).',
  ingestion_jobs: 'Satu baris per job; tumbuh dengan setiap sinkronisasi terjadwal.',
  ingestion_errors: 'Satu baris atau lebih per kegagalan job; tumbuh dengan volume ingestion.',
  ingestion_raw_pages:
    'Menyimpan parsed_json dan potongan halaman mentah — payload besar (retensi 90 hari, PRD §22).',
  source_snapshots: 'Snapshot konten sumber per waktu; jumlahnya bertambah setiap sinkronisasi.',
  battles: 'Satu baris per pasangan form yang pernah dipertarungkan; tumbuh mendekati kuadratik.',
  battle_results: 'Satu baris per (battles × versi rule set); disebut eksplisit di PRD §37 sebagai kandidat partisi.',
  battle_narratives: 'Naskah panjang per hasil; payload besar meskipun barisnya sedikit.',
  analytics_events: 'Event per interaksi; volume tertinggi di skema (retensi 400 hari, PRD §22).',
  audit_logs:
    'Satu baris per tindakan admin, menyimpan jsonb before/after — payload besar dan tak terbatas.',
  data_reports: 'Laporan pengguna; tumbuh dengan trafik.',
  favorites: 'Bertambah sebanding jumlah pengguna aktif (Phase 2).',
  users:
    'Bertambah dengan pendaftaran. Selain itu `select *` di sini bukan hanya soal performa: daftar kolomnya memuat kredensial, dan kebiasaan `select *` adalah cara paling umum kolom sensitif bocor ke UI.',
  mv_character_search:
    'Materialized view pencarian yang menggabungkan kolom karakter, verse, dan tier — lebar, dan dibaca di setiap pencarian.',
};

/** Tabel/agregat kecil yang wajar dibaca utuh. */
export const SMALL_TABLES = {
  sources:
    'Registri sumber eksternal (nama, base_url, status legal, rate limit) — jumlahnya ratusan, bukan per halaman.',
  stat_scale_metrics: 'Matriks skala × metrik; ukurannya tetap.',
  stat_scales: 'Tangga nilai per metrik; konfigurasi, bukan data tumbuh.',
  tiers: 'Tangga tier (±40 baris) yang di-seed sekali.',
  verses: 'Daftar verse/asal karya; ratusan hingga ribuan, bukan ratusan ribu.',
  ability_categories: 'Taksonomi kategori ability; dibatasi jumlah kategorinya.',
  abilities: 'Katalog ability (bukan per karakter); dibatasi taksonomi.',
  resistance_types: 'Katalog tipe resistance; dibatasi taksonomi.',
  hax_interactions: 'Katalog aturan interaksi ability↔resistance; dikelola admin, berjumlah ratusan.',
  merge_candidates: 'Pasangan kandidat duplikat; dibatasi tingkat duplikasi, bukan jumlah karakter.',
  slug_redirects: 'Satu baris per penggantian slug; tipis dan selalu diakses lewat primary key.',
  battle_rule_sets: 'Versi bobot engine; satu baris per rilis rule set.',
  battle_conditions:
    'Kombinasi kondisi yang dideduplikasi lewat `conditions_hash` — ruangnya terbatas (mode × jarak × knowledge × prep × win condition).',
  user_roles: 'Satu baris per (pengguna, peran); tipis dan hanya dibaca saat otorisasi.',
  mv_verse_tier_distribution: 'Agregat distribusi tier per verse; beberapa baris per verse.',
  mv_battle_popularity: 'Agregat matchup populer; dibatasi jumlah matchup yang melewati ambang.',
};
