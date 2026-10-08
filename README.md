# Anime VS Battle — Dokumentasi Produk

Repo ini berisi **dokumentasi perencanaan plus tiga bagian yang sudah benar-benar berjalan**: skema database, **battle engine** beserta case library-nya, dan **scaffolding Next.js dengan lint batas arsitektur**. Isinya adalah PRD lengkap, diagram arsitektur, spesifikasi database, dan skrip verifikasi untuk produk **Anime VS Battle**: platform database karakter fiksi ber-form dengan mesin simulasi pertarungan yang deterministic dan traceable.

> **Orisinalitas.** Semua taksonomi, skala nilai, aturan engine, dan struktur data di dokumen ini dirancang sendiri. Tidak ada desain visual, branding, CSS, kode sumber, atau aset dari platform lain yang disalin.

## Isi

| Dokumen | Isi | Baris |
|---|---|---|
| [docs/PRD.md](docs/PRD.md) | PRD utama: 40 seksi (executive summary → roadmap), decision log 20 entri, risk register 18 risiko, glosarium | 2.091 |
| [docs/APPENDICES.md](docs/APPENDICES.md) | Lampiran A–J: architecture diagram, ERD, DFD, battle engine flow, ingestion pipeline, feature matrix, API endpoint table, database table specification, user journey, roadmap — plus **Lampiran K**: format data case library | 952 |
| [docs/schema.sql](docs/schema.sql) | PostgreSQL DDL lengkap: 37 tabel, 3 materialized view, index, constraint, trigger integritas, RLS, RPC | 1.633 |
| [docs/seed.sql](docs/seed.sql) | Seed konfigurasi: ladder tier, skala stat per metrik, kategori ability, tipe resistensi, aturan interaksi hax, rule set battle default | 566 |
| [scripts/validate-schema.mjs](scripts/validate-schema.mjs) | Validator: menjalankan DDL + seed di Postgres nyata lalu 56 uji fungsional | 614 |
| [scripts/refresh-mv.sql](scripts/refresh-mv.sql) | Refresh materialized view `CONCURRENTLY` (di luar transaksi) untuk cron | 29 |
| [docs/runbooks/README.md](docs/runbooks/README.md) | Rencana runbook operasional wajib (AC-30) | 24 |

### Aplikasi & lint batas arsitektur (kode berjalan)

| Berkas | Isi | Baris |
|---|---|---|
| [app/](app/) | Next.js App Router: homepage VS bar, `/characters` (pagination server-side), `/versus`, `/compare`, `/verse/[slug]`, halaman legal, dan **8 route API** (`health`, `health/ready`, `search`, `battle/simulate`, `admin/ingestion/run`, `admin/ingestion/import`, `admin/stats`, `cron/sync`) | — |
| [src/lib/security/](src/lib/security/) | Guard otentikasi rute admin (**fail-closed** Bearer + `timingSafeEqual`) dan rate limiter jendela-tetap murni (jam disuntikkan) — AC-26/§28 tahap jembatan sebelum Supabase Auth | — |
| [.github/workflows/](.github/workflows/) | Trio workflow PRD §39, **terpasang**: `ci.yml` (9 gerbang), `lighthouse.yml` (anggaran §29.1/AC-21–22), `scheduled-ingest.yml` (cron */15m, fail-closed stub) | — |
| [src/services/queue/](src/services/queue/) | Antrian job: `enqueueIngestionJob` (dipakai jalur request), `claimNextPendingJob`/`markJobCompleted`/`markJobFailed` (dipakai worker) | — |
| [src/features/](src/features/) | Query karakter (kolom eksplisit) dan penghubung data→engine (`battle_dataset` → `runBattle`) | — |
| [worker/ingest.ts](worker/ingest.ts) | Entrypoint worker: satu job, lalu keluar — proses terpisah dari web | — |
| [tools/architecture/](tools/architecture/) | Definisi zona, klasifikasi tabel besar, perakit aturan ESLint | 351 |
| [tools/eslint-plugin-architecture/](tools/eslint-plugin-architecture/) | Tiga rule batas arsitektur + uji unitnya | 943 |
| [tests/architecture/fixtures/](tests/architecture/fixtures/) | 22 fixture (melanggar & bersih) + `expected.mjs`, termasuk probe per-zona untuk AC-25 | — |
| [scripts/check-architecture.mjs](scripts/check-architecture.mjs) | Pemeriksa: fixture, false-positive pada kode nyata, dan empat invarian | 336 |

**Tiga aturan yang ditegakkan, dan mengapa ditulis sendiri** (detail: [PRD §39.1](docs/PRD.md#391-model-zona)):

| Rule | Yang dijaga |
|---|---|
| `engine-purity` | Engine pertarungan bebas I/O: hanya impor relatif **di dalam zonanya** + `node:crypto.createHash`. `Date`, `process`, `console`, `fetch`, `Math.random`, dan `randomUUID` dilarang — satu `Date.now()` cukup untuk membatalkan jaminan bahwa hasil dapat direproduksi dari `input_hash` |
| `boundary-import` | Zona **tidak dapat** mencapai ingestion kecuali worker dan endpoint cron terjadwal. Menangkap bentuk alias **dan** relatif — bentuk relatif awalnya lolos sepenuhnya, dan itu ditemukan oleh fixture, bukan oleh review |
| `no-select-star` | `select *` pada tabel besar, termasuk bintang yang disembunyikan lewat konstanta lokal dan rantai `.from(...).select('*')`. `count(*)`, perkalian, tabel kecil, dan `select * from fungsi(...)` tidak ditandai |

### Battle engine (kode berjalan)

| Berkas | Isi | Baris |
|---|---|---|
| [src/services/battle/](src/services/battle/) | Engine 8 lapis: `gates` (kelayakan + dominasi), `hax-engine` (ability ↔ resistance ↔ counter), `metrics`, `scoring`, `qualifiers`, `difficulty`, `reasoning`, `rule-set`, `stable-json` — plus **`calibration`** (D19: harness kalibrasi bobot murni, koordinat-descent dengan Σ=100 dijaga eksak) | 2.392 |
| [src/services/battle/cases/](src/services/battle/cases/) | Case library AC-31: **39 kasus dalam 6 berkas** + `roster.json` fixture sintetis | ~919 |
| [src/services/battle/fixtures/rule-set.default.json](src/services/battle/fixtures/rule-set.default.json) | Cermin rule set dari [docs/seed.sql](docs/seed.sql); uji drift otomatis menjaga keduanya identik | 156 |
| [scripts/run-battle-cases.mjs](scripts/run-battle-cases.mjs) | Runner: mengeksekusi seluruh kasus, memeriksa harapan, determinisme, RG-1, invarian AC-32, sensitivitas AC-33 | 471 |
| [scripts/mutate-battle-guards.mjs](scripts/mutate-battle-guards.mjs) | Uji mutasi guard: membuktikan runner menolak library rusak, dengan alasan yang spesifik | 162 |
| [tests/battle-engine/](tests/battle-engine/) | **223 unit test** per modul: normalisasi metrik, gate, rule engine hax, scoring, kalibrasi Layer 4–5, harness kalibrasi bobot, reasoning/RG-1, plus determinisme dan kemurnian | 2.780 |
| [tests/security/](tests/security/) | **21 test keamanan**: guard fail-closed, pembanding timing-safe, rate limiter (unit) + **8 integration test** yang memanggil handler rute admin dengan `Request` nyata (503/401/429 di level request, tanpa DB) | — |
| [scripts/calibrate-weights.mjs](scripts/calibrate-weights.mjs) | CLI harness kalibrasi (D19): muat kasus berlabel → baseline vs hasil kalibrasi vs leave-one-out; label `insufficient_data` dikecualikan secara prinsip | — |

Aturan penting yang membuat library ini berguna: **kasus adalah data, engine tidak tahu kasus mana yang ada.** Menambah cakupan berarti menambah JSON, bukan menambah `if` di engine. Setiap kasus menyatakan `expect` (pemenang, rentang probabilitas, difficulty, decisive edges, limitations) — runner menolak kasus tanpa harapan, id duplikat, `side_a === side_b`, atau rujukan fixture yang tidak ada di `roster.json`.

Pembagian tugas antara keduanya disengaja. Case library menjawab *"apakah engine masih menghasilkan jawaban yang diharapkan untuk 39 situasi nyata?"* — gambaran luas, data-driven, dan menangkap regresi lintas lapis. Unit test menjawab *"apakah modul ini masih berperilaku persis seperti kontraknya?"* — sempit, terisolasi, dan memakai angka eksak. Fixture unit test ditulis dalam TypeScript, sehingga `npm run typecheck` menolak fixture yang tidak sah (nama enum salah, field hilang) sebelum satu test pun berjalan; fixture JSON pada case library tidak bisa memberi jaminan itu.

## Verifikasi

Skema **dieksekusi sungguhan** (PostgreSQL 16 via PGlite) — bukan hanya dibaca. 56 pengujian lulus, mencakup: 37 tabel + 3 MV (sesuai klaim PRD §22), setiap MV punya unique index (syarat `REFRESH CONCURRENTLY`), RLS di setiap tabel, Σbobot rule set = 100, satu form default per karakter, riwayat statistik (`superseded` bukan ditimpa), penolakan fakta tanpa `source_id`, artwork tanpa lisensi, label resistensi tidak konsisten, `absolute` tanpa bukti, toleransi typo pencarian, alias kanji/hangul, idempotensi staging, dan invarian probabilitas hasil battle.

```bash
npm install
npm run typecheck              # TS strict: engine, app/, src/, worker/
npm run lint                   # ESLint: lint batas arsitektur
npm run check:architecture     # fixture + false-positive + 4 invarian batas
npm run test:engine            # 223 unit test engine per modul (tanpa database)
npm run test:security          # guard admin + rate limiter (unit) + integration handler
npm run test:lint-rules        # uji unit aturan lint (RuleTester)
npm test                        # ketiganya sekaligus (223 + 21 + 3)
npm run validate:schema        # skema + seed, keluar 1 bila ada uji gagal
npm run validate:battle-cases  # engine + case library
npm run check:battle-guards    # uji mutasi: guard runner benar-benar menolak library rusak
npm run build                  # Next.js production build
```

Keluaran yang diharapkan: `Total: 56 · lulus 56 · gagal 0` (skema) dan `Total: 425 · gagal 0` (case library), serta `ℹ tests 223 · ℹ pass 223` (unit test engine), `ℹ tests 21 · ℹ pass 21` (keamanan), `ℹ tests 3 · ℹ pass 3` (aturan lint).

### Yang dibuktikan runner engine (bukan diklaim)

| Pemeriksaan | Hasil |
|---|---|
| Kasus terpenuhi harapannya + determinisme + RG-1 | 425 pemeriksaan, 0 gagal |
| RG-1 traceability reasoning (AC-34) | 39/39 kasus dapat dirujuk |
| Invarian AC-32 (tidak ada hasil mustahil) | 0 pelanggaran di seluruh 39 kasus |
| Sensitivitas kondisi (AC-33) | 8 pasangan diperiksa, 1 dikecualikan (dua-duanya `insufficient_data`) |
| Determinisme antar proses | Dua eksekusi terpisah menghasilkan keluaran **identik byte-for-byte** |
| Mutasi guard runner (AC-36) | 6/6 mutasi tertangkap: id duplikat, tanpa `expect`, `side_a === side_b`, rujukan roster tak dikenal, ekspektasi dibalik, kategori kasus dihapus |
| Batas arsitektur (38 pemeriksaan) | 22 fixture cocok dengan harapannya (kurang **maupun** lebih sama-sama gagal), 27 berkas produksi nol pelanggaran, 4 invarian: cakupan zona, jalur impor ingestion, kelengkapan klasifikasi 40 tabel/MV, kecocokan daftar enum route↔engine |
| Uji unit engine (per modul) | 213/213 test lulus di 7 berkas; 1 bug produksi ditemukan dan diperbaiki (ambang `difficulty_thresholds.low` terlewat karena representasi biner `0,95 - 0,5`) |
| Uji unit aturan lint | 3/3 suite RuleTester, termasuk empat kasus regresi bug yang ditemukan saat pemeriksaan (dua di antaranya: bentuk relatif yang lolos penuh, dan specifier bare `postgres` yang salah tuduh saat zona `relativeImportsOnly`) |
| Jalur HTTP | `next dev` + `curl`: `/api/health` 200, simulasi 200 (`winner=a`, p=0.95 lewat gate dominasi, 14 baris `score_breakdown`), payload tak sah 400, jalur pratinjau 403 di `next start`, admin & cron 503 dengan pesan yang menyebut penyebabnya. Rute admin (`ingestion/run`, `ingestion/import`, `stats`) kini juga **fail-closed**: 503 tanpa `ADMIN_INGESTION_SECRET`, 401 kredensial salah, 429 setelah 6 permintaan/menit — dibuktikan oleh integration test `tests/security/` |
| Keamanan rute admin (AC-26/§28) | Guard Bearer fail-closed + `timingSafeEqual` (13 unit test) + integration test handler: 503 tanpa secret, 401 secret salah, auth-lulus → DB menolak 503 (urutan terbukti), 429 pada permintaan ke-7 |

Uji mutasi dijalankan oleh [scripts/mutate-battle-guards.mjs](scripts/mutate-battle-guards.mjs): setiap mutasi diterapkan ke `cases/*.json`, runner dijalankan sebagai proses terpisah, dan hasilnya **harus** non-zero **dengan alasan yang benar** (bukan sekadar ada kegagalan di suatu tempat). Berkas selalu dipulihkan, dan pemulihannya diverifikasi lewat sha256. Script ini juga sudah diuji gagal: bila penolakan yang diharapkan tidak muncul, ia keluar dengan status 1.

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
| Skema database | Selesai & terverifikasi eksekusi (56 uji) |
| Battle engine + case library | Selesai & terverifikasi (39 kasus, 425 pemeriksaan) |
| Scaffolding Next.js + lint batas | Selesai & terverifikasi (38 pemeriksaan batas, build hijau) |
| Guard keamanan rute admin + suite security | Selesai & terverifikasi (21 test; `ADMIN_INGESTION_SECRET` — Supabase Auth menyusul Sprint 4) |
| Harness kalibrasi bobot (D19) | Selesai — modul murni + CLI; dataset berlabel produksi menyusul dengan battle history |
| Pipeline CI/CD (PRD §39) | Terpasang: `ci.yml` 9 gerbang, `lighthouse.yml`, `scheduled-ingest.yml`; eksekusi runner pertama menunggu push ke GitHub |
| Pipeline ingestion, UI/UX penuh, auth, benchmark 10k | Belum dimulai (Sprint 1–2 pada [roadmap pengembangan](docs/PRD.md#40-implementation-roadmap)) |

## Pertanyaan terbuka yang butuh keputusan manusia

1. **Review legal per sumber.** Setiap sumber eksternal perlu status `legal_status='allowed'` sebelum adapter boleh berjalan. Perlu satu kali review, bukan keputusan teknis.
2. **Tier ladder final.** Ladder seed bersifat konfigurasi; jika ada skema penilaian internal yang disepakati, cukup satu insert — tidak ada kode yang perlu berubah.
3. **Ambang probabilitas & bobot.** Angka default (`k=2.2`, bobot 14 metrik) adalah titik awal yang dapat diaudit lewat case library, bukan harga mati.
