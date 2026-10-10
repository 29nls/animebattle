# Anime VS Battle — Dokumentasi Produk

Repo ini berisi **dokumentasi perencanaan plus empat bagian yang sudah benar-benar berjalan**: skema database, **battle engine** beserta case library-nya, **pipeline ingestion** (antrian → worker → staging → upsert ber-atribusi) dengan **panel admin** yang membaca database sungguhan, dan **scaffolding Next.js dengan lint batas arsitektur**. Isinya adalah PRD lengkap, diagram arsitektur, spesifikasi database, dan skrip verifikasi untuk produk **Anime VS Battle**: platform database karakter fiksi ber-form dengan mesin simulasi pertarungan yang deterministic dan traceable.

> **Orisinalitas.** Semua taksonomi, skala nilai, aturan engine, dan struktur data di dokumen ini dirancang sendiri. Tidak ada desain visual, branding, CSS, kode sumber, atau aset dari platform lain yang disalin.

## Isi

| Dokumen | Isi | Baris |
|---|---|---|
| [docs/PRD.md](docs/PRD.md) | PRD utama: 40 seksi (executive summary → roadmap), decision log 22 entri, risk register 18 risiko, glosarium | 2.166 |
| [docs/APPENDICES.md](docs/APPENDICES.md) | Lampiran A–J: architecture diagram, ERD, DFD, battle engine flow, ingestion pipeline, feature matrix, API endpoint table, database table specification, user journey, roadmap — plus **Lampiran K**: format data case library | 956 |
| [docs/schema.sql](docs/schema.sql) | PostgreSQL DDL lengkap: 37 tabel, 3 materialized view, index, constraint, trigger integritas, RLS, RPC | 1.633 |
| [docs/seed.sql](docs/seed.sql) | Seed konfigurasi: ladder tier, skala stat per metrik, kategori ability, tipe resistensi, aturan interaksi hax, rule set battle default | 566 |
| [scripts/validate-schema.mjs](scripts/validate-schema.mjs) | Validator: menjalankan DDL + seed di Postgres nyata lalu 56 uji fungsional | 614 |
| [scripts/refresh-mv.sql](scripts/refresh-mv.sql) | Refresh materialized view `CONCURRENTLY` (di luar transaksi) untuk cron | 29 |
| [docs/runbooks/](docs/runbooks/) | Runbook operasional (AC-30): **enam lengkap** — [ingestion](docs/runbooks/ingestion.md), [conflict-review](docs/runbooks/conflict-review.md), [merge](docs/runbooks/merge.md), [takedown](docs/runbooks/takedown.md), [rollback](docs/runbooks/rollback.md), [incident](docs/runbooks/incident.md); SQL lima runbook baru teruji di PGlite (2026-10-09) | — |

### Aplikasi & lint batas arsitektur (kode berjalan)

| Berkas | Isi | Baris |
|---|---|---|
| [app/](app/) | Next.js App Router: homepage VS bar, `/characters` (pagination server-side), `/versus`, `/compare`, `/verse/[slug]`, halaman legal, panel `/admin` (login sesi + dashboard + job ingestion + konflik), dan **12 route API** (`health`, `health/ready`, `search`, `battle/simulate`, `admin/ingestion/run`, `admin/ingestion/import`, `admin/ingestion/jobs`, `admin/ingestion/jobs/:id/errors`, `admin/ingestion/jobs/:id/retry`, `admin/ingestion/jobs/:id/cancel`, `admin/metrics`, `cron/sync`) | — |
| [src/lib/security/](src/lib/security/) | Guard otentikasi rute admin (**fail-closed** Bearer + `timingSafeEqual`) dan rate limiter jendela-tetap murni (jam disuntikkan) — AC-26/§28 tahap jembatan sebelum Supabase Auth | — |
| [.github/workflows/](.github/workflows/) | Trio workflow PRD §39, **terpasang**: `ci.yml` (9 gerbang), `lighthouse.yml` (anggaran §29.1/AC-21–23, profil mobile, kelima assertion `error`), `scheduled-ingest.yml` (cron */15m, fail-closed stub) | — |
| [src/services/queue/](src/services/queue/) | Antrian job: `enqueueIngestionJob`/`retryIngestionJob`/`cancelIngestionJob` (jalur request) dan `claimNextPendingJob`/`markJobCompleted`/`markJobFailed` (worker, termasuk backoff eksponensial & kegagalan terminal) | — |
| [src/services/ingestion/](src/services/ingestion/) | Pipeline 7 tahap: registry sumber + allow-list, gerbang `robots.txt` fail-closed, token bucket per host, fetcher ber-SSRF (redirect manual + penolakan alamat privat), parser dataset JSON, validator, dan upsert idempoten ber-atribusi | — |
| [src/features/admin/](src/features/admin/) | Query panel admin (ringkasan, job + atribusi, error), penyiapan impor di jalur request (staging + antrian), guard rute, dan token sesi `HMAC` untuk halaman `/admin` | — |
| [src/features/](src/features/) | Query karakter (kolom eksplisit) dan penghubung data→engine (`battle_dataset` → `runBattle`) | — |
| [worker/ingest.ts](worker/ingest.ts) | Entrypoint worker: satu job, lalu keluar — proses terpisah dari web | — |
| [tools/architecture/](tools/architecture/) | Definisi zona, klasifikasi tabel besar, perakit aturan ESLint | 351 |
| [tools/eslint-plugin-architecture/](tools/eslint-plugin-architecture/) | Tiga rule batas arsitektur + uji unitnya | 968 |
| [tests/architecture/fixtures/](tests/architecture/fixtures/) | 22 fixture (melanggar & bersih) + `expected.mjs`, termasuk probe per-zona untuk AC-25 | — |
| [scripts/check-architecture.mjs](scripts/check-architecture.mjs) | Pemeriksa: fixture, false-positive pada kode nyata, dan empat invarian | 340 |

**Tiga aturan yang ditegakkan, dan mengapa ditulis sendiri** (detail: [PRD §39.1](docs/PRD.md#391-model-zona)):

| Rule | Yang dijaga |
|---|---|
| `engine-purity` | Engine pertarungan bebas I/O: hanya impor relatif **di dalam zonanya** + `node:crypto.createHash`. `Date`, `process`, `console`, `fetch`, `Math.random`, dan `randomUUID` dilarang — satu `Date.now()` cukup untuk membatalkan jaminan bahwa hasil dapat direproduksi dari `input_hash` |
| `boundary-import` | Zona **tidak dapat** mencapai ingestion kecuali worker dan endpoint cron terjadwal. Menangkap bentuk alias **dan** relatif — bentuk relatif awalnya lolos sepenuhnya, dan itu ditemukan oleh fixture, bukan oleh review |
| `no-select-star` | `select *` pada tabel besar, termasuk bintang yang disembunyikan lewat konstanta lokal dan rantai `.from(...).select('*')`. `count(*)`, perkalian, tabel kecil, dan `select * from fungsi(...)` tidak ditandai |

### Battle engine (kode berjalan)

| Berkas | Isi | Baris |
|---|---|---|
| [src/services/battle/](src/services/battle/) | Engine 8 lapis: `gates` (kelayakan + dominasi), `hax-engine` (ability ↔ resistance ↔ counter), `metrics`, `scoring`, `qualifiers`, `difficulty`, `reasoning`, `rule-set`, `stable-json` — plus **`calibration`** (D21: harness kalibrasi bobot murni, koordinat-descent dengan Σ=100 dijaga eksak) | 2.698 |
| [src/services/battle/cases/](src/services/battle/cases/) | Case library AC-31: **39 kasus dalam 6 berkas** + `roster.json` fixture sintetis | ~919 |
| [src/services/battle/fixtures/rule-set.default.json](src/services/battle/fixtures/rule-set.default.json) | Cermin rule set dari [docs/seed.sql](docs/seed.sql); uji drift otomatis menjaga keduanya identik | 156 |
| [scripts/run-battle-cases.mjs](scripts/run-battle-cases.mjs) | Runner: mengeksekusi seluruh kasus, memeriksa harapan, determinisme, RG-1, invarian AC-32, sensitivitas AC-33 | 471 |
| [scripts/mutate-battle-guards.mjs](scripts/mutate-battle-guards.mjs) | Uji mutasi guard: membuktikan runner menolak library rusak, dengan alasan yang spesifik | 162 |
| [tests/battle-engine/](tests/battle-engine/) | **225 unit test** per modul: normalisasi metrik, gate, rule engine hax, scoring, kalibrasi Layer 4–5, harness kalibrasi bobot, reasoning/RG-1, plus determinisme dan kemurnian | 2.961 |
| [tests/security/](tests/security/) | **32 test keamanan**: guard fail-closed, pembanding timing-safe, rate limiter, dan klasifikasi error database (unit) + **17 test yang memanggil handler rute** dengan `Request` nyata — 8 rute admin (503/401/429), 3 rute cron (fail-closed + timing-safe), 6 kontrak error route anonim (503 vs 500, tanpa bocoran pesan driver, termasuk `no-store` pada `/api/health/ready`), semuanya tanpa DB | — |
| [scripts/calibrate-weights.mjs](scripts/calibrate-weights.mjs) | CLI harness kalibrasi (D21): muat kasus berlabel → baseline vs hasil kalibrasi vs leave-one-out; label `insufficient_data` dikecualikan secara prinsip | — |

Aturan penting yang membuat library ini berguna: **kasus adalah data, engine tidak tahu kasus mana yang ada.** Menambah cakupan berarti menambah JSON, bukan menambah `if` di engine. Setiap kasus menyatakan `expect` (pemenang, rentang probabilitas, difficulty, decisive edges, limitations) — runner menolak kasus tanpa harapan, id duplikat, `side_a === side_b`, atau rujukan fixture yang tidak ada di `roster.json`.

Pembagian tugas antara keduanya disengaja. Case library menjawab *"apakah engine masih menghasilkan jawaban yang diharapkan untuk 39 situasi nyata?"* — gambaran luas, data-driven, dan menangkap regresi lintas lapis. Unit test menjawab *"apakah modul ini masih berperilaku persis seperti kontraknya?"* — sempit, terisolasi, dan memakai angka eksak. Fixture unit test ditulis dalam TypeScript, sehingga `npm run typecheck` menolak fixture yang tidak sah (nama enum salah, field hilang) sebelum satu test pun berjalan; fixture JSON pada case library tidak bisa memberi jaminan itu.

## Konfigurasi lingkungan

Aplikasi membaca tujuh variabel (`src/lib/db/client.ts`, guard rute, dan metadata
SEO). Nilai nyata **tidak pernah** di-commit: `.env*` ada di `.gitignore`, dan
[`.env.example`](.env.example) hanya memuat placeholder.

| Variabel | Fungsi | Perilaku bila kosong |
|---|---|---|
| `DATABASE_CA_CERT` | Isi PEM CA tambahan untuk verifikasi TLS Postgres — **opsional**. Root CA Supabase (`prod-ca-2021.crt`, "Supabase Root 2021 CA") sudah disalin ke [`src/lib/db/supabase-ca.ts`](src/lib/db/supabase-ca.ts) dan dipakai otomatis untuk host `*.supabase.co/.com/.in`; verifikasi selalu penuh, `rejectUnauthorized` tidak pernah dimatikan | Untuk host Supabase tidak ada yang perlu diisi. Urutan jalur CA: `DATABASE_CA_CERT` → berkas `sslrootcert` pada URL bila benar-benar ada → CA bawaan (khusus host Supabase). Tanpa satu pun, verifikasi mengikuti `sslmode`: `verify-full` gagal `self-signed certificate in certificate chain` (pengunjung anonim melihat pesan generik; detail + saran perbaikan masuk log server). Nilai cacat diabaikan dengan peringatan, bukan dikirim ke TLS |
| `DATABASE_URL` | Satu-satunya koneksi Postgres | `/api/health/ready` → 503 `not_configured`; route berbasis DB → 503 `UNAVAILABLE` dengan pesan generik (detail driver hanya di log server, termasuk pada `/api/health/ready`) |
| `ADMIN_INGESTION_SECRET` | Bearer token rute `/api/admin/*` **dan** token login panel `/admin` (cookie sesi HMAC 12 jam) — jembatan §28 sebelum Supabase Auth | Rute API dan seluruh halaman `/admin/*` **fail-closed**: 503 untuk rute, panel terkunci untuk halaman |
| `CRON_SECRET` | Bearer token `GET /api/cron/sync` | Endpoint cron **fail-closed**: 503 |
| `ALLOW_BATTLE_PREVIEW` | `1` membuka jalur pratinjau simulasi (body berisi `sides`) — hanya bila `NODE_ENV !== 'production'` | Jalur pratinjau menolak 403 |
| `ALLOW_DEMO_DATA` | `1` memakai **dataset demo sintetis** (`src/features/demo`) bila `DATABASE_URL` kosong, supaya halaman karakter/verse dan alur battle dapat dijalankan tanpa PostgreSQL | Dataset demo tidak dipakai — halaman menampilkan status database |
| `NEXT_PUBLIC_SITE_URL` | Base URL metadata/OG/robots/sitemap | Default `http://localhost:3000`. String kosong atau berisi spasi saja diperlakukan sebagai **belum diatur** ([`src/lib/site-url.ts`](src/lib/site-url.ts)): tanpa itu `new URL('')` melempar saat modul layout dievaluasi dan setiap halaman dinamis menjawab 500 |

Rahasia Bearer cukup string acak panjang (`openssl rand -hex 32`); rotasi =
ganti env lalu deploy ulang.

## Verifikasi

Skema **dieksekusi sungguhan** (PostgreSQL 16 via PGlite) — bukan hanya dibaca. 56 pengujian lulus, mencakup: 37 tabel + 3 MV (sesuai klaim PRD §22), setiap MV punya unique index (syarat `REFRESH CONCURRENTLY`), RLS di setiap tabel, Σbobot rule set = 100, satu form default per karakter, riwayat statistik (`superseded` bukan ditimpa), penolakan fakta tanpa `source_id`, artwork tanpa lisensi, label resistensi tidak konsisten, `absolute` tanpa bukti, toleransi typo pencarian, alias kanji/hangul, idempotensi staging, dan invarian probabilitas hasil battle.

```bash
npm install
npm run typecheck              # TS strict: engine, app/, src/, worker/
npm run lint                   # ESLint: lint batas arsitektur
npm run check:architecture     # fixture + false-positive + 4 invarian batas
npm run test:engine            # 225 unit test engine per modul (tanpa database)
npm run test:security          # guard admin + rute cron + rate limiter (unit & integration handler)
npm run test:web               # dataset demo + pemilih sumber data + penjaga galat halaman & base URL + token sesi admin + query halaman di atas skema nyata (PGlite)
npm run test:ingestion         # pipeline + route admin + cron di atas skema nyata (PGlite)
npm run test:lint-rules        # uji unit aturan lint (RuleTester)
npm run test:lighthouse-config # guard anggaran Lighthouse CI (AC-21–23 tetap `error`)
npm test                        # keenamnya sekaligus (225 + 48 + 34 + 28 + 3 + 4)
npm run validate:schema        # skema + seed, keluar 1 bila ada uji gagal
npm run validate:battle-cases  # engine + case library
npm run check:battle-guards    # uji mutasi: guard runner benar-benar menolak library rusak
npm run build                  # Next.js production build
```

Keluaran yang diharapkan: `Total: 56 · lulus 56 · gagal 0` (skema) dan `Total: 425 · gagal 0` (case library), serta `ℹ tests 225 · ℹ pass 225` (unit test engine), `ℹ tests 48 · ℹ pass 48` (keamanan, termasuk konfigurasi TLS database + CA Supabase bawaan), `ℹ tests 34 · ℹ pass 34` (dataset demo, pemilihan sumber data, penjaga galat pemuatan halaman + visibilitas panel + base URL situs, token sesi admin, dan query baca halaman di atas skema nyata PGlite), `ℹ tests 28 · ℹ pass 28` (pipeline ingestion + route admin + cron di atas skema nyata), `ℹ tests 3 · ℹ pass 3` (aturan lint), `ℹ tests 4 · ℹ pass 4` (guard konfigurasi Lighthouse) — total 342 uji pada `npm test`.

Pipeline ingestion diuji dengan cara yang sama seperti skema: **dieksekusi di atas DDL sungguhan**. `tests/ingestion/` memuat `docs/schema.sql` + `docs/seed.sql` ke PGlite, menyuntikkan klien itu lewat `setSqlClient()`, lalu menjalankan jalur produksi apa adanya — `POST /api/admin/ingestion/import` (hanya staging + antrian) → `GET /api/cron/sync` (worker) → `runIngestionJob` (fetch/parse/normalize/validate/dedupe/upsert) → `GET /api/admin/ingestion/jobs` + `.../errors` (panel). Yang dibuktikan di sana: menjalankan dataset yang sama **3×** menghasilkan `records_created = 0` pada eksekusi kedua dan ketiga (AC-08), kegagalan per record muncul di `ingestion_errors` dengan tipe dan pesan penyebabnya (AC-10), atribusi (`source_id`/`source_url`/`source_name`) terisi di setiap baris kanonik, dan kebijakan sumber benar-benar menggigit: allow-list, `robots.txt` (termasuk gagal tertutup), penolakan alamat privat (SSRF), `Retry-After`, serta token bucket per host. Fetch dan DNS disuntik, jadi hasilnya deterministik dan tidak menyentuh jaringan.

Sejak 2026-10-10 suite web juga memuat [tests/web/database-queries.test.ts](tests/web/database-queries.test.ts): satu dataset kecil ditulis lewat `applyDataset` produksi ke PGlite (skema + seed yang sama), lalu **setiap query baca halaman** dijalankan terhadapnya — daftar & detail karakter, pencarian FTS/trigram (`search_characters`), daftar & detail verse, atribusi `character_sources`, dan `battle_dataset` lewat `simulateFromVersions`. Suite inilah yang menangkap empat kolom query detail yang tidak ada di DDL, `character_sources` yang belum pernah ditulis pipeline, dan bentuk keluaran `battle_dataset` yang tidak cocok dengan `SideData` — semuanya baru terlihat setelah database benar-benar berisi data.

### Yang dibuktikan runner engine (bukan diklaim)

| Pemeriksaan | Hasil |
|---|---|
| Kasus terpenuhi harapannya + determinisme + RG-1 | 425 pemeriksaan, 0 gagal |
| RG-1 traceability reasoning (AC-34) | 39/39 kasus dapat dirujuk |
| Invarian AC-32 (tidak ada hasil mustahil) | 0 pelanggaran di seluruh 39 kasus |
| Sensitivitas kondisi (AC-33) | 8 pasangan diperiksa, 1 dikecualikan (dua-duanya `insufficient_data`) |
| Determinisme antar proses | Dua eksekusi terpisah menghasilkan keluaran **identik byte-for-byte** |
| Mutasi guard runner (AC-36) | 6/6 mutasi tertangkap: id duplikat, tanpa `expect`, `side_a === side_b`, rujukan roster tak dikenal, ekspektasi dibalik, kategori kasus dihapus |
| Batas arsitektur (38 pemeriksaan) | 22 fixture cocok dengan harapannya (kurang **maupun** lebih sama-sama gagal), 54 berkas produksi nol pelanggaran, 4 invarian: cakupan zona, jalur impor ingestion, kelengkapan klasifikasi 40 tabel/MV, kecocokan daftar enum route↔engine |
| Uji unit engine (per modul) | 225/225 test lulus di 8 berkas; 2 bug produksi ditemukan dan diperbaiki (ambang `difficulty_thresholds.low` terlewat karena representasi biner `0,95 - 0,5`; `experience` tidak terdokumentasi dihukum −1 alih-alih netral 0 sesuai PRD §17.1) |
| Uji unit aturan lint | 3/3 suite RuleTester, termasuk empat kasus regresi bug yang ditemukan saat pemeriksaan (dua di antaranya: bentuk relatif yang lolos penuh, dan specifier bare `postgres` yang salah tuduh saat zona `relativeImportsOnly`) |
| Jalur HTTP | `next dev` + `curl`: `/api/health` 200, simulasi 200 (`winner=a`, p=0.95 lewat gate dominasi, 14 baris `score_breakdown`), payload tak sah 400, jalur pratinjau 403 di `next start`, admin & cron 503 dengan pesan yang menyebut penyebabnya. Rute admin (`ingestion/run`, `ingestion/import`, `metrics`) kini juga **fail-closed**: 503 tanpa `ADMIN_INGESTION_SECRET`, 401 kredensial salah, 429 setelah 6 permintaan/menit — dibuktikan oleh integration test `tests/security/` (termasuk rute cron: 503 tanpa `CRON_SECRET`, 401 dengan secret salah) |
| Keamanan rute (AC-26/§28) | Guard Bearer fail-closed + `timingSafeEqual` (15 unit test) + 17 test handler: rute admin (503 tanpa secret, 401 secret salah, auth-lulus → DB menolak 503, 429 pada permintaan ke-7), rute cron (503 fail-closed, 401 termasuk panjang secret berbeda), dan kontrak error route anonim (gangguan DB → 503 `UNAVAILABLE`, bug → 500 `INTERNAL`, keduanya tanpa membocorkan pesan driver; `/api/health/ready` memakai dokumen status dengan `no-store` di semua cabang) |

Uji mutasi dijalankan oleh [scripts/mutate-battle-guards.mjs](scripts/mutate-battle-guards.mjs): setiap mutasi diterapkan ke `cases/*.json`, runner dijalankan sebagai proses terpisah, dan hasilnya **harus** non-zero **dengan alasan yang benar** (bukan sekadar ada kegagalan di suatu tempat). Berkas selalu dipulihkan, dan pemulihannya diverifikasi lewat sha256. Script ini juga sudah diuji gagal: bila penolakan yang diharapkan tidak muncul, ia keluar dengan status 1.

**Batasan verifikasi (jujur):** PGlite adalah Postgres WASM, sehingga `REFRESH MATERIALIZED VIEW CONCURRENTLY` dan kebijakan RLS berbasis klaim JWT Supabase (butuh `auth.uid()` nyata) tidak diuji di sana. Dua hal itu perlu diverifikasi sekali di instance Supabase sebelum rilis. Semua bagian lain dari skema dijalankan apa adanya.

Batas itu **sebagian sudah dilunasi (2026-10-10)**: ingestion pertama dijalankan pada instance Supabase produksi lewat jalur panel — `POST /api/admin/ingestion/import` → `GET /api/cron/sync` → 73 baris kanonik (1 verse, 3 karakter, 3 form, 27 statistik, 13 ability, 13 resistance, plus atribusi `character_sources`), re-run dataset yang sama `records_created = 0`, dan halaman `/characters`, `/verses`, `/character/*`, `/verse/*`, `/versus`, serta `/admin/ingestion` dirender dari data itu dengan driver `postgres` sungguhan. Tiga bug yang hanya muncul di driver nyata ikut ketahuan dan diperbaiki di jalur ini: jsonb staging tersimpan sebagai string, `battle_dataset` mengembalikan satu jsonb (bukan setof baris), dan `timestamptz` kembali sebagai `Date` sementara halaman memakainya sebagai string. Yang masih belum terverifikasi: satu pun sumber HTTP nyata (adapter crawling belum ada), `REFRESH MATERIALIZED VIEW` setelah impor besar, dan cache `robots.txt` lintas job. Halaman `/admin` juga sudah dijalankan untuk keadaan gagal-tertutup (panel terkunci tanpa secret, rute admin 503 tanpa `DATABASE_URL`, redirect login).

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
| Guard keamanan rute (admin + cron) + suite security | Selesai & terverifikasi (32 test; `ADMIN_INGESTION_SECRET`/`CRON_SECRET` fail-closed — Supabase Auth menyusul Sprint 4) |
| Harness kalibrasi bobot (D21) | Selesai — modul murni + CLI; dataset berlabel produksi menyusul dengan battle history |
| Pipeline ingestion + panel admin (Sprint 2) | Selesai & terverifikasi di atas skema nyata (28 uji PGlite): antrian → staging → 7 tahap → upsert idempoten ber-atribusi (AC-08), panel error per job (AC-10), allow-list/robots/SSRF/rate limit, retry & cancel; halaman `/admin` berpenjaga sesi membaca database sungguhan. **Sudah dijalankan pada instance Supabase produksi (2026-10-10)**: impor dataset terkelola One-Punch Man (3 karakter, 3 form, 27 statistik) → 73 baris kanonik tanpa kegagalan per record, re-run `created = 0`, atribusi per karakter di `character_sources`, dan halaman publik dirender dari data produksi — jalur ini menemukan lalu memperbaiki 3 bug hanya-driver (jsonb string, bentuk `battle_dataset`, `Date` vs string) |
| Anggaran performa (Lighthouse CI) | Terpasang & terukur lokal (build produksi, **profil mobile**, 5 URL): Performance 94–96 (best-of-3, agregasi `optimistic`), Best-Practices 96, a11y 100, SEO 100 (AC-21/22 lulus); script 142,3 KB ≤ 150 KB (AC-23, anggaran dikalibrasi — PRD §35.2) — **kelima assertion `error`** |
| Pipeline CI/CD (PRD §39) | Terpasang: `ci.yml` 9 gerbang, `lighthouse.yml`, `scheduled-ingest.yml`; eksekusi runner pertama menunggu push ke GitHub |
| Alur inti UI: `/versus` → `/versus/result` + halaman karakter/verse | Selesai di atas **dataset demo sintetis** (`ALLOW_DEMO_DATA=1`) dengan engine asli: pemenang, probabilitas, reasoning ber-rujukan, score breakdown, limitations, dan disclaimer §18.4 dirender dari `runBattle` — bukan angka mock. Jalur database tetap prioritas begitu `DATABASE_URL` diisi |
| Adapter crawling per sumber, search hybrid, auth Supabase, benchmark 10k, UI/UX penuh | Belum dimulai (Sprint 2–5 pada [roadmap pengembangan](docs/PRD.md#40-implementation-roadmap)) |

## Pertanyaan terbuka yang butuh keputusan manusia

1. **Review legal per sumber.** Setiap sumber eksternal perlu status `legal_status='allowed'` sebelum adapter boleh berjalan. Perlu satu kali review, bukan keputusan teknis.
2. **Tier ladder final.** Ladder seed bersifat konfigurasi; jika ada skema penilaian internal yang disepakati, cukup satu insert — tidak ada kode yang perlu berubah.
3. **Ambang probabilitas & bobot.** Angka default (`k=2.2`, bobot 14 metrik) adalah titik awal yang dapat diaudit lewat case library, bukan harga mati.
