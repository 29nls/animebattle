# Anime VS Battle — Dokumentasi Produk

Repo ini berisi **dokumentasi perencanaan**, bukan aplikasi. Isinya adalah PRD lengkap, diagram arsitektur, spesifikasi database, dan skrip verifikasi skema untuk produk **Anime VS Battle**: platform database karakter fiksi ber-form dengan mesin simulasi pertarungan yang deterministic dan traceable.

> **Orisinalitas.** Semua taksonomi, skala nilai, aturan engine, dan struktur data di dokumen ini dirancang sendiri. Tidak ada desain visual, branding, CSS, kode sumber, atau aset dari platform lain yang disalin.

## Isi

| Dokumen | Isi | Baris |
|---|---|---|
| [docs/PRD.md](docs/PRD.md) | PRD utama: 40 seksi (executive summary → roadmap), decision log 20 entri, risk register 18 risiko, glosarium | 2.006 |
| [docs/APPENDICES.md](docs/APPENDICES.md) | Lampiran A–J: architecture diagram, ERD, DFD, battle engine flow, ingestion pipeline, feature matrix, API endpoint table, database table specification, user journey, roadmap | 837 |
| [docs/schema.sql](docs/schema.sql) | PostgreSQL DDL lengkap: 37 tabel, 3 materialized view, index, constraint, trigger integritas, RLS, RPC | 1.616 |
| [docs/seed.sql](docs/seed.sql) | Seed konfigurasi: ladder tier, skala stat per metrik, kategori ability, tipe resistensi, aturan interaksi hax, rule set battle default | 525 |
| [scripts/validate-schema.mjs](scripts/validate-schema.mjs) | Validator: menjalankan DDL + seed di Postgres nyata lalu 49 uji fungsional | 505 |
| [scripts/refresh-mv.sql](scripts/refresh-mv.sql) | Refresh materialized view `CONCURRENTLY` (di luar transaksi) untuk cron | 29 |
| [docs/runbooks/README.md](docs/runbooks/README.md) | Rencana runbook operasional wajib (AC-30) | 24 |

## Verifikasi

Skema **diekskusi sungguhan** (PostgreSQL 16 via PGlite) — bukan hanya dibaca. 49 pengujian lulus, mencakup: 37 tabel + 3 MV (sesuai klaim PRD §22), setiap MV punya unique index (syarat `REFRESH CONCURRENTLY`), RLS di setiap tabel, Σbobot rule set = 100, satu form default per karakter, riwayat statistik (`superseded` bukan ditimpa), penolakan fakta tanpa `source_id`, artwork tanpa lisensi, label resistensi tidak konsisten, `absolute` tanpa bukti, toleransi typo pencarian, alias kanji/hangul, idempotensi staging, dan invarian probabilitas hasil battle.

```bash
npm install
npm run validate:schema   # keluar dengan status 1 bila ada satu uji pun gagal
```

Keluaran yang diharapkan: `Total: 49 · lulus 49 · gagal 0`.

**Batasan verifikasi (jujur):** PGlite adalah Postgres WASM, sehingga `REFRESH MATERIALIZED VIEW CONCURRENTLY` dan kebijakan RLS berbasis klaim JWT Supabase (butuh `auth.uid()` nyata) tidak diuji di sana. Dua hal itu perlu diverifikasi sekali di instance Supabase sebelum rilis. Semua bagian lain dari skema dijalankan apa adanya.

## Empat keputusan yang membentuk seluruh produk

| Keputusan | Alasan |
|---|---|
| **Form/version sebagai entity kelas satu.** Satu karakter punya banyak record kekuatan; engine hanya menerima `character_version_id`. | Sumber kesalahan paling umum dalam perbandingan kekuatan adalah pencampuran era/form. Tanpa ini, perbaikan UX apa pun tidak menyelesaikan masalah intinya. |
| **Semua fakta harus bersumber.** Tabel fakta menolak baris tanpa `source_id`; konflik antar sumber disimpan, tidak ditimpa. | Tanpa traceability, database menjadi kumpulan klaim tanpa bukti dan tidak dapat diaudit. |
| **Hasil battle = simulasi probabilistik, bukan putusan.** Engine berlapis (gate → hax rule engine → weighted score → kalibrasi) dengan `confidence`, `limitations`, dan disclaimer wajib. | Skor tunggal menghasilkan hasil absurd saat hax mendominasi; dan klaim otoritatif tidak dapat dipertanggungjawabkan. |
| **Ingestion patuh sejak desain, impor terkelola sebagai jalur utama MVP.** Adapter per sumber dengan `legal_status`; dilarang melewati anti-bot/CAPTCHA/paywall; tidak ada fetching di jalur request pengguna. | Akses sumber pihak ketiga adalah risiko terbesar produk. MVP harus tetap berfungsi penuh tanpanya, dan kepatuhan tidak boleh menjadi tambalan di kemudian hari. |

## Urutan baca yang disarankan

1. [PRD §1–§9](docs/PRD.md) — masalah, visi, user stories, alur.
2. [PRD §10–§17](docs/PRD.md) — model data, form, tier, stat, ability, resistance, engine, perhitungan.
3. [PRD §18–§21](docs/PRD.md) — ingestion, sinkronisasi, validasi, duplikasi.
4. [Appendix B & H](docs/APPENDICES.md) — ERD dan spesifikasi tabel; buka [schema.sql](docs/schema.sql) berdampingan.
5. [PRD §35–§40](docs/PRD.md) — acceptance criteria, risiko, skalabilitas, roadmap.

## Status

| Fase | Status |
|---|---|
| Dokumentasi produk (PRD + lampiran) | Selesai — v1.0 draft untuk persetujuan |
| Skema database | Selesai & terverifikasi eksekusi |
| Aplikasi | Belum dimulai (Sprint 0 pada [roadmap pengembangan](docs/PRD.md#40-implementation-roadmap)) |

## Pertanyaan terbuka yang butuh keputusan manusia

1. **Review legal per sumber.** Setiap sumber eksternal perlu status `legal_status='allowed'` sebelum adapter boleh berjalan. Perlu satu kali review, bukan keputusan teknis.
2. **Tier ladder final.** Ladder seed bersifat konfigurasi; jika ada skema penilaian internal yang disepakati, cukup satu insert — tidak ada kode yang perlu berubah.
3. **Ambang probabilitas & bobot.** Angka default (`k=2.2`, bobot 14 metrik) adalah titik awal yang dapat diaudit lewat case library, bukan harga mati.
