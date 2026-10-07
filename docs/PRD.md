# PRD — Anime VS Battle

**Product Requirements Document**
**Version:** 1.0 (MVP baseline)
**Status:** Draft for approval
**Owner:** Product & Engineering (small team, 1–3 engineers)
**Last updated:** 2026-10-07

**Companion documents**
| Doc | Path | Isi |
|---|---|---|
| Appendices A–J | [APPENDICES.md](APPENDICES.md) | Arsitektur, ERD, DFD, battle flow, ingestion flow, feature matrix, API table, table spec, user journey, roadmap |
| Database DDL | [schema.sql](schema.sql) | PostgreSQL DDL lengkap (tabel, index, constraint, trigger, RLS) |
| Seed data | [seed.sql](seed.sql) | Tier ladder, stat scales, rule set battle default, aturan interaksi hax |
| Design tokens | DB-3 di dokumen ini + [APPENDICES.md](APPENDICES.md#h-database-table-specification) | — |

> **Catatan orisinalitas.** Dokumen ini mendefinisikan produk, taksonomi data, skala kekuatan, dan mesin simulasi yang dirancang sendiri. Tidak ada desain visual, branding, CSS, kode sumber, atau aset dari platform lain yang disalin. Nama-nama karakter yang disebutkan hanya sebagai contoh data domain.

---

## 1. Executive Summary

**Problem Statement.** Informasi powerscaling tersebar di ratusan halaman wiki, thread forum, dan video yang tidak terstruktur; membandingkan dua karakter secara adil membutuhkan riset manual 30–90 menit, tidak dapat direproduksi, dan hasilnya bergantung pada siapa yang paling vokal berargumen.

**Proposed Solution.** Anime VS Battle adalah platform database karakter fiksi multi-verse yang menyimpan karakter sebagai **entity dengan form/version kelas satu**, dilengkapi pipeline ingestion otomatis yang traceable ke sumber, dan satu mesin simulasi bertingkat (rule engine + weighted scoring) yang menghasilkan hasil pertarungan **deterministik, dapat diaudit, dan dapat direproduksi** untuk setiap pasangan karakter + kondisi pertarungan.

**Success Criteria (KPI terukur, 90 hari setelah rilis publik)**

| # | KPI | Target | Cara ukur |
|---|---|---|---|
| K1 | Cakupan katalog | ≥ 10.000 karakter, ≥ 1.500 verse, ≥ 28.000 form | `SELECT count(*)` nightly |
| K2 | Kesegaran data | ≥ 95% karakter `updated_at` < 180 hari; sync terjadwal berhasil ≥ 97% run | `ingestion_jobs` rollup |
| K3 | Performa simulasi | Hasil battle siap < 300 ms p95 (tanpa narrator AI), < 1,5 s p95 (dengan narrator) | APM trace `POST /api/battle/simulate` |
| K4 | Performa & SEO | Lighthouse ≥ 90 (perf) / ≥ 95 (SEO) di karakter page; ≥ 8.000 halaman terindeks Google | Lighthouse CI + Search Console |
| K5 | Kualitas data | ≥ 99% record punya `source_url`; < 0,5% record `conflicting` yang belum di-review | data-quality view |
| K6 | Keterlibatan | ≥ 60% sesi memicu minimal 1 simulasi; ≥ 35% simulasi pada form non-default | analytics events |
| K7 | Keandalan | Uptime ≥ 99,5%; error rate API 5xx < 0,5% | uptime monitor |

**Estimasi biaya infrastruktur MVP:** USD 0–45/bulan (Supabase Free→Pro + Vercel Hobby→Pro + Upstash free tier). Target biaya pada skala 100k karakter: < USD 120/bulan.

---

## 2. Product Vision

Anime VS Battle adalah **"referensi pertarungan yang bisa dipercaya dan bisa diulang"** untuk dunia fiksi. Produk harus terasa seperti gabungan:

- Character Database (ensiklopedia terstruktur)
- Powerscaling Database (tier, stat, feat ber-sumber)
- VS Calculator (perbandingan kuantitatif berdampingan)
- Battle Simulator (analisis + hasil probabilistik)
- Character Comparison Tool
- Anime/Verse Encyclopedia

**Value proposition (elevator line):**
> *"Choose two characters. Understand their stats, abilities, advantages, counters, and simulated battle outcome."*

**Diferensiasi (mengapa produk ini ada, bukan sekadar wiki lain):**

| Diferensiator | Deskripsi | Alasan ini penting |
|---|---|---|
| Form sebagai entity kelas satu | Goku "Namek Saga" dan Goku "Ultra Instinct" adalah dua record berbeda dengan stat berbeda, terhubung ke satu entity karakter | 80% kesalahan debat powerscaling berasal dari pencampuran era/form |
| Traceability total | Setiap angka menyimpan `source_url`, `fetched_at`, `parser_version`, `confidence`, `verification_status` | Tanpa ini, database menjadi klaim tanpa bukti dan tak bisa diaudit |
| Determinisme simulasi | Input + `rule_set_version` yang sama → hasil byte-identik, disimpan sebagai `input_hash` | Hasil debat harus bisa dibuka ulang, bukan hilang di chat |
| Rule engine eksplisit | Interaksi ability↔resistance adalah **data**, bukan `if/else` di frontend | Admin (non-programmer) harus bisa memperbaiki meta tanpa deploy |
| Konflik sumber sebagai data | Dua sumber berbeda nilai → disimpan berdampingan, tidak saling menimpa | Menghindari silent data corruption ala "last write wins" |
| Skala kanonik terukur | Stat dipetakan ke skala ber-`rank`/`log_value` yang dapat dibandingkan, bukan string bebas | String bebas tidak dapat dibandingkan secara komputatif |

**Batasan produk (jujur sejak awal):** hasil simulasi adalah **analisis probabilistik berdasarkan data yang tersedia**, bukan hasil resmi, bukan canon, bukan klaim otoritatif. Lihat §18 dan §30.

---

## 3. Problem Statement

**Masalah inti.** Tidak ada satu tempat yang menyatukan (a) data karakter ber-form, (b) bukti sumber, dan (c) mesin pembanding yang konsisten. Akibatnya:

| P | Pain point | Dampak pengguna | Akar masalah teknis |
|---|---|---|---|
| P1 | Data tersebar & tidak terstruktur | 30–90 menit riset manual per matchup | Tidak ada schema karakter/stat yang baku |
| P2 | Era/form dicampur | Debat berputar tanpa kesepakatan premis | Karakter dimodelkan sebagai vektor stat tunggal |
| P3 | Klaim tanpa bukti | Argumen menang karena volume, bukan bukti | Tidak ada field sumber per-klaim |
| P4 | Duplikasi data | "Naruto", "Naruto Uzumaki", "Uzumaki Naruto" jadi 3 halaman berbeda | Tidak ada entity resolution/alias |
| P5 | Hasil tidak reproducible | Debat lama tidak bisa dibuka ulang | Tidak ada versioning engine & rule set |
| P6 | Konten tidak dapat di-maintain | Wiki basi karena edit manual | Tidak ada pipeline ingestion + validasi |
| P7 | Tidak ada antarmuka kuantitatif | Pengguna harus "merasakan" siapa lebih kuat | Tidak ada perbandingan stat berdampingan |
| P8 | Masalah legal abu-abu | Aset dipakai tanpa attribution | Data dan artwork tidak dipisahkan kepemilikannya |

**Why now.** (1) Tersedianya stack serverless murah (Postgres + FTS bawaan) yang mampu melayani 100k baris tanpa search engine terpisah. (2) Semakin ketatnya kebijakan sumber wiki terhadap akses otomatis → menuntut arsitektur ingestion berbasis adapter + penghormatan ToS sejak desain awal, bukan tambalan setelah insiden. (3) Ekspektasi pengguna terhadap situs data sudah bergeser ke UX aplikasi modern.

---

## 4. Goals

**Goals (MVP, 0–3 bulan)**

| G | Goal | Metrik lulus |
|---|---|---|
| G1 | Database karakter ber-form yang dapat dicari | ≥ 10.000 karakter, ≥ 28.000 form, search p95 < 200 ms |
| G2 | Ingestion otomatis, resumable, idempoten | Re-run 1 job 3x → jumlah karakter/form tidak bertambah (0 duplikat) |
| G3 | Traceability setiap record | 100% record punya ≥ 1 `character_sources` |
| G4 | Halaman karakter ber-SEO | ≥ 8.000 URL terindeks; JSON-LD valid di 100% halaman karakter |
| G5 | VS builder + simulasi bertingkat | Rule engine menyebut ability & resistance penentu pada ≥ 90% hasil yang relevan |
| G6 | Admin dashboard operasional | Admin dapat menjalankan sync, melihat job gagal, memperbaiki data tanpa deploy |
| G7 | Biaya operasional terkendali | < USD 45/bulan pada skala MVP |
| G8 | Kinerja frontend | Lighthouse perf ≥ 90, JS klien per halaman < 120 KB gzip |

**Goals (Phase 2–3, lihat §33–§34 dan §40)**

- Team battle (2v2/3v3), tournament, akun user, favorites, voting komunitas.
- AI Battle Narrator dengan hard grounding (tidak boleh menciptakan statistik).
- Simulasi turn-based dan timeline interaktif.

---

## 5. Non-Goals

| NG | Non-goal | Alasan |
|---|---|---|
| NG1 | Menyalin desain, layout, atau aset platform lain | Batasan hukum & etika; produk harus punya identitas sendiri |
| NG2 | Mengklaim hasil pertarungan sebagai canon/resmi | Merusak kredibilitas; §18 menetapkan labeling wajib |
| NG3 | Melewati anti-bot, CAPTCHA, login restriction, paywall, atau access control sumber mana pun | Melanggar ToS dan hukum; dilarang secara absolut (§12) |
| NG4 | Menyimpan/menayangkan artwork ber-lisensi tanpa sumber & attribution | Risiko takedown & pelanggaran hak cipta |
| NG5 | Menciptakan statistik, ability, atau feat yang tidak ada di sumber | Melanggar prinsip "no fabricated stats" (§41) |
| NG6 | Fitur komunitas kompleks (komentar, voting, forum) di MVP | Memecah fokus; butuh moderasi & auth yang belum ada |
| NG7 | Realtime multiplayer battle | Tidak ada nilai produk yang jelas di MVP |
| NG8 | Aplikasi mobile native | Web responsif mencukupi; hindari biaya ganda |
| NG9 | Menyediakan API publik tanpa autentikasi untuk bulk dump | Mencegah abuse & scraping balik (§29) |
| NG10 | Menyimpan full HTML sumber secara permanen | Ukuran & risiko hak cipta; simpan hash + excerpt+pointer (§12.6) |
| NG11 | Menjadi sumber utama untuk tier/stat baru hasil "kalibrasi komunitas" di MVP | Butuh governance & moderasi; Phase 3 |
| NG12 | Dukungan konten dewasa/NSFW | Kompleksitas moderasi & risiko iklan/pembayaran |

---

## 6. Target Users

| Persona | Deskripsi | Kebutuhan utama | Fitur kritis |
|---|---|---|---|
| **Rangga, 19 — Anime Fan** | Menonton 5–10 judul/musim, tidak tahu istilah tier | Jawaban cepat "siapa menang" + penjelasan bahasa manusia | Homepage VS bar, hasil battle + narasi, share card |
| **Dita, 24 — Manga Reader** | Ingin perbandingan berdampingan, skeptis pada klaim | Perbandingan stat detail, sumber terlihat, pemilihan form | Comparison table, form selector, badge sumber |
| **Bayu, 27 — Powerscaler** | Aktif di komunitas, paham AP/speed/hax | Transparansi formula, reproducibility, koreksi data | Battle analysis breakdown, `input_hash`, `rule_set_version`, report data |
| **Komunitas VS Battle** | Berdebat publik, butuh URL untuk dibagikan | Permalink stabil + deterministik untuk matchup baku | `/versus/goku-vs-naruto`, JSON-LD, copy link |
| **Sari, 31 — Content Creator** | Membuat konten video/sosial | Aset visual hasil, ringkasan mudah di-screenshot | OG image battle card, "Download result card" |
| **Admin/Editor (internal)** | Menjaga kualitas 10k+ record | Job monitoring, conflict review, koreksi cepat | Admin dashboard (§25), conflict queue |
| **Developer (internal)** | Menambah adapter & aturan baru | Interface stabil, testability | Adapter interface, rule seed, staging tables |
| **Pengguna mobile** | 60%+ trafik diproyeksikan | Layout stacked, cepat di 4G, hemat data | Responsive, RSC, image optimization, pagination 20 |

**Anti-persona:** pihak yang ingin membanjiri API untuk mengambil dump database, atau yang berharap "alat penentu kebenaran kanon". Keduanya secara eksplisit tidak dilayani (NG2, NG9).

---

## 7. User Stories

Prioritas: **P0** = wajib MVP, **P1** = MVP bila waktu cukup, **P2** = Phase 2/3.

### 7.1 Discovery & pencarian

| ID | Story | Prio | Acceptance Criteria |
|---|---|---|---|
| US-01 | Sebagai penggemar anime, saya ingin mencari karakter dengan nama/alias sehingga saya cepat menemukannya. | P0 | Ketik "goku" → Goku muncul urutan 1 dalam < 200 ms; "Kakarot" dan "孫悟空" juga menemukan karakter yang sama; toleransi typo "gokou" tetap menemukan |
| US-02 | Sebagai pengguna, saya ingin memfilter database sehingga saya melihat karakter yang relevan. | P0 | Filter tier, verse, media, gender, form, ability, resistance, range, AP berjalan server-side; mengubah filter tidak memuat seluruh tabel ke browser |
| US-03 | Sebagai pengguna, saya ingin mengurutkan hasil sehingga saya bisa menelusuri dari yang terkuat/terpopuler/terbaru. | P0 | Sort: name, tier, popularity, recently_updated, recently_imported; kombinasi filter+sort+pagination konsisten |
| US-04 | Sebagai pengguna, saya ingin membuka halaman verse sehingga saya memahami cakupan semestanya. | P0 | `/verse/[slug]` menampilkan deskripsi, jumlah karakter, karakter terkuat, distribusi tier, terpopuler, terbaru |
| US-05 | Sebagai pengguna, saya ingin deep-link hasil filter agar bisa dibagikan. | P1 | Semua state filter/sort/page tercermin di query string dan bertahan saat di-refresh/dibagikan |

### 7.2 Karakter & form

| ID | Story | Prio | Acceptance Criteria |
|---|---|---|---|
| US-06 | Sebagai manga reader, saya ingin melihat halaman karakter lengkap sehingga saya memahami kekuatannya. | P0 | `/character/[slug]` memuat artwork, nama, alias, origin, klasifikasi, deskripsi, daftar form, tier, AP, speed, durability, lifting, striking, stamina, range, intelligence, battle IQ, abilities, resistances, equipment, weaknesses, feats, sources, last updated |
| US-07 | Sebagai powerscaler, saya ingin memilih form/versi sehingga perbandingan memakai era yang benar. | P0 | Form selector menampilkan semua form dengan tier & era; memilih form mengubah seluruh blok statistik; form default = `is_default = true`; URL menangkap `?form=` |
| US-08 | Sebagai pengguna, saya ingin melihat bukti/sumber setiap klaim sehingga saya dapat memverifikasi. | P0 | Setiap stat & feat menampilkan `source_name`, tautan `source_url`, dan tanggal `fetched_at`; sumber ditampilkan di blok "Sources" |
| US-09 | Sebagai pengguna, saya ingin tahu kaidah penggunaan data sehingga saya tidak menyebarkan klaim palsu. | P0 | Disclaimer tampil pada halaman karakter/versus/hasil battle (teks §18.4), tidak tersembunyi di footer saja |
| US-10 | Sebagai pengguna, saya ingin menandai data yang meragukan sehingga tim dapat memperbaikinya. | P1 | Tombol "Report data" → form alasan + optional proposed source → tersimpan sebagai tiket review; rate-limited 5/jam/IP |

### 7.3 Versus, perbandingan, simulasi

| ID | Story | Prio | Acceptance Criteria |
|---|---|---|---|
| US-11 | Sebagai pengguna, saya ingin memilih dua karakter + form lalu memulai battle. | P0 | `/versus` memungkinkan pemilihan A & B beserta form masing-masing; desktop 2 kolom, mobile stacked; tombol Start Battle aktif hanya bila kedua sisi punya form terpilih |
| US-12 | Sebagai pengguna, saya ingin mengatur kondisi pertarungan sehingga hasil sesuai skenario saya. | P0 | Kondisi dapat diatur: mode (standard/equal speed/in character/bloodlusted/random encounter), starting distance, battlefield, knowledge level, prep time, win condition |
| US-13 | Sebagai pengguna, saya ingin melihat hasil simulasi dengan alasan yang jelas. | P0 | Hasil memuat winner, win probability, difficulty, battle length, primary reason, secondary factors, critical counter, potential scenario, dan disclaimer |
| US-14 | Sebagai pengguna, saya ingin membandingkan statistik tanpa simulasi. | P0 | Tabel perbandingan stat + indikator Advantage A / Advantage B / Equal / Unknown; tersedia juga di dalam hasil battle |
| US-15 | Sebagai pengguna, saya ingin tahu ability/resistance mana yang menentukan hasil. | P0 | Blok "Decisive interactions" menyebut pasangan ability→resistance/counter, multiplier efektivitas, dan status (blocked/reduced/effective) |
| US-16 | Sebagai pengguna, saya ingin membagikan battle lewat URL yang stabil. | P0 | `/versus/[a]-vs-[b]` menampilkan hasil deterministik untuk input setara; OG image di-generate; tombol Copy link & Download result card |
| US-17 | Sebagai pengguna, saya ingin melihat battle populer sehingga saya tidak mulai dari nol. | P1 | Blok Popular Battles di homepage dari data agregat anonim (bukan hardcode) |
| US-18 | Sebagai pengguna, saya ingin hasil yang sama saat saya ulangi dengan input yang sama. | P0 | `input_hash` identik → hasil identik; halaman menampilkan `engine_version` dan `rule_set_version` |

### 7.4 Admin & operasional

| ID | Story | Prio | Acceptance Criteria |
|---|---|---|---|
| US-19 | Sebagai admin, saya ingin melihat kesehatan sistem dari satu dashboard. | P0 | `/admin` menampilkan total karakter/form/verse/ability/source, last ingestion, failed jobs, pending jobs, karakter terbaru diupdate |
| US-20 | Sebagai admin, saya ingin menjalankan sinkronisasi manual. | P0 | Tombol "Sync Now" membuat job dengan status `pending`, menampilkan progres, dan dapat di-cancel; aman dijalankan berulang (idempoten) |
| US-21 | Sebagai admin, saya ingin mengimpor URL tertentu. | P0 | Form Import URL → validasi domain allow-list → job `skipped` + alasan jelas bila domain tidak diizinkan |
| US-22 | Sebagai admin, saya ingin me-re-import/re-parse record tertentu sehingga perbaikan parser tidak butuh migrasi manual. | P0 | `POST /api/admin/characters/:id/reparse` menjalankan ulang parser; statistik lama disimpan sebagai versi sebelumnya (tidak hilang) |
| US-23 | Sebagai admin, saya ingin melihat error ingestion dengan jelas. | P0 | Log menampilkan `error_type` (ParserError, SourceUnavailable, RateLimited, InvalidData, DuplicateCharacter, MissingRequiredField, ImageUnavailable), HTTP status, retry count, pesan, dan tautan ke sumber |
| US-24 | Sebagai admin, saya ingin menyelesaikan konflik data. | P1 | Halaman conflict menampilkan dua nilai bersaing + masing-masing sumber; admin memilih "keep A / keep B / keep both (split by form) / mark unresolved" |
| US-25 | Sebagai admin, saya ingin mengelola tier, ability, dan resistance. | P1 | CRUD tier ladder (termasuk urutan/numerical rank), ability category, resistance type, dan aturan interaksi, semuanya tanpa deploy |
| US-26 | Sebagai admin, saya ingin mengatur bobot & aturan battle. | P1 | Editor `battle_rule_sets` dengan validasi jumlah bobot = 100, versioning, dan tombol "recompute cached battles" |
| US-27 | Sebagai admin, saya ingin menonaktifkan sumber bermasalah. | P1 | Flag `sources.legal_status = disabled` → adapter tidak akan fetch; data lama tetap tampil dengan label sumber nonaktif |

### 7.5 AI narrator (Phase 3, kontrak tetap ditulis sekarang)

| ID | Story | Prio | Acceptance Criteria |
|---|---|---|---|
| US-28 | Sebagai pengguna, saya ingin narasi pertarungan yang menarik. | P2 | Narasi diberi label "AI-generated battle scenario", tidak menambah statistik baru, dan diverifikasi oleh fact-containment check sebelum ditampilkan |
| US-29 | Sebagai pengguna, saya ingin tetap melihat hasil kalkulasi resmi bila narator gagal. | P2 | Kegagalan narrator = degradasi bertingkat: hasil kalkulasi tetap tampil tanpa blok narasi |

---

## 8. User Flows

### 8.1 Flow utama: Homepage → Battle → Share

```
[Homepage /]
  │  Hero: "Who Would Win?" + dua kolom pencarian (A vs B)
  ├─ Search A → typeahead (debounce 250ms, min 3 char, fuzzy+alias)
  │     query: SELECT ... WHERE search_vector @@ websearch_to_tsquery / similarity()
  ├─ Pilih karakter → FormPickerSheet (default = form is_default)
  ├─ Search B → sama
  ├─ [Start Battle] ──(state → /versus?a=slug&af=formSlug&b=slug&bf=formSlug)
  ▼
[/versus] Battle Settings
  ├─ Mode, starting distance, battlefield, knowledge, prep, win condition
  ├─ Form belum dipilih? → CTA "Select form" + fallback ke form default + badge peringatan
  └─ [Run Simulation]
        │
        ├─ Server Action / POST /api/battle/simulate
        │     ├─ Load versions + stats + abilities + resistances (+sources)
        │     ├─ Compute input_hash → cache lookup (Redis/KV, TTL 7 hari)
        │     ├─ Cache miss → run Battle Engine v1 (flow detail: Appendix D)
        │     └─ Persist battle_result + conditions → kembalikan battle_id
        ▼
   Hasil (RSC render, bukan client-fetch)
     ├─ Winner + Win Probability + Difficulty + Battle Length
     ├─ Stat comparison table (indikator Advantage/Equal/Unknown)
     ├─ Decisive interactions (ability → resistance → counter → status)
     ├─ Primary reason, Secondary factors, Critical counter, Potential scenario
     ├─ Disclaimer ("simulated / analytical result")
     ├─ [Copy link] [Download result card] [Share]
     └─ [Tweak conditions & re-run] (battle_id lama disimpan sebagai history)
        ▼
   [/versus/goku-vs-naruto] permalink deterministik (OG image + JSON-LD)
```

### 8.2 Flow ingestion (admin)

```
[/admin] Dashboard
  ├─ [Sync Now]      → POST /api/admin/ingestion/run   {scope: scheduled}
  ├─ [Import URL]    → POST /api/admin/ingestion/import {source_url}
  ├─ [Import Verse]  → scope: verse, verse_slug
  ├─ [Import Char]   → scope: character, slug
  ▼
ingestion_jobs (pending) → dispatcher (cron */15m / manual trigger)
  ▼
worker: fetch → parse → normalize → validate → dedupe → resolve → upsert
  ├─ Sukses  → records_created/updated, status = completed | partial
  ├─ Retry-able (429/5xx/timeout) → retry_count++, backoff, status = pending lagi
  └─ Fatal   → status = failed, ingestion_errors ditulis
  ▼
[/admin/ingestion] daftar job + filter status + detail errors + tombol Retry / Resume / Cancel
[/admin/conflicts]  antrian konflik sumber untuk di-review manusia
```

### 8.3 Flow form/version

```
/character/goku
  ├─ Header: artwork, nama, alias, origin, classification
  ├─ Form tabs: [Kid Goku] [Saiyan Saga] ... [Ultra Instinct]   ← is_default ditandai
  │     → URL ?form=ultra-instinct, konten stat di-render server-side
  ├─ Stat grid (dari character_versions + statistics terpilih)
  ├─ Abilities & Resistances (accordion, dengan evidence per item)
  ├─ Equipment, Weaknesses, Feats (dengan significance + source)
  ├─ Sources & Last Updated
  └─ [Battle This Character] → /versus?a=<slug>&af=<currentForm>
        └─ Sisi B kosong + search field auto-focus
```

### 8.4 Flow perbandingan (tanpa simulasi)

```
/compare?a=goku&af=ultra-instinct&b=naruto&bf=baryon-mode
  ├─ Tabel baris = metrik, kolom = A | B, kolom nilai = indicator
  │     Advantage A (hijau) / Advantage B (ungu) / Equal (netral) / Unknown (abu + tooltip alasan)
  ├─ Bar chart perbandingan (nilai ternormalisasi; nilai mentah selalu tersedia sebagai teks)
  └─ [Run full simulation] → carry state ke /versus
```

### 8.5 Degradasi & kondisi tidak lengkap

| Kondisi | Perilaku |
|---|---|
| Karakter B belum dipilih saat Start Battle | Tombol disabled + hint "Choose Character B" |
| Form belum dipilih | Otomatis pakai `is_default`; bila tidak ada, form dengan `display_order` terkecil; badge "Default form used" |
| Data wajib kurang (tier/AP/durability/speed) | Hasil = `insufficient_data` dengan daftar field yang hilang; **tidak** mengumumkan pemenang |
| Satu sisi tidak punya resistance sama sekali | Ditampilkan eksplisit "no documented resistances" — bukan diperlakukan sebagai resistensi 0 yang setara dengan "tidak diketahui" |
| Simulasi gagal/timeout | Fallback ke comparison view + tombol retry; state form/filter tetap |
| Offline / request gagal (mobile) | Pesan "Connection problem" + retry; tidak ada partial result yang menyesatkan |

---

## 9. Feature Requirements

Legenda prioritas: **P0** MVP wajib · **P1** MVP bila memungkinkan · **P2** Phase 2 · **P3** Phase 3

| ID | Fitur | Prio | Requirement fungsional | Requirement non-fungsional |
|---|---|---|---|---|
| F-01 | Character database | P0 | CRUD karakter (admin), halaman publik per slug, jumlah karakter ≥ 10k | Semua query pakai index; tidak ada full table scan |
| F-02 | Form/version system | P0 | ≥ 1 form per karakter; satu `is_default`; stat per form | Pemilihan form mengubah seluruh blok stat dalam < 100 ms (RSC) |
| F-03 | Tier system configurable | P0 | Tier = data di tabel `tiers` (`tier_code`, `band`, `numeric_rank`, `parent_tier`, `display_order`) | Penambahan tier baru = insert row, tanpa deploy |
| F-04 | Qualifier & nilai ganda | P0 | Mendukung `at least`, `possibly`, `likely`, `up to`, `higher with`, `far higher with`, `varies`, `unknown` pada setiap stat | Qualifier menurunkan `confidence` dan memengaruhi bobot (±) di engine |
| F-05 | Stat system | P0 | Tier, AP, speed, durability, lifting, striking, stamina, range, intelligence, battle IQ, experience, hax count, abilities, resistances | Setiap stat menyimpan `raw_text`, `scale_ref`, `qualifier`, `confidence`, `source_id` |
| F-06 | Ability/hax database | P0 | Ability ternormalisasi + kategori; relasi ke form dengan proficiency/evidence | Ability dipakai ulang antar karakter (bukan duplikasi string) |
| F-07 | Resistance database | P0 | Resistance type ternormalisasi + level + evidence; relasi ke form | Digunakan langsung oleh rule engine |
| F-08 | Feats & evidence | P0 | Feat dengan tipe, significance, source, `verification_status` | ≥ 1 feat per form untuk form P0; sisanya `unknown` dan ditandai |
| F-09 | Search | P0 | Fuzzy, typo-tolerant, alias, nama asli (kanji/kana), romaji, partial | p95 < 200 ms @10k, < 400 ms @100k |
| F-10 | Filtering & sorting server-side | P0 | Filter tier/verse/media/gender/form/ability/resistance/range/AP; sort name/tier/popularity/updated/imported | Pagination 20/50/100/200; tidak pernah mengirim seluruh tabel |
| F-11 | Verse pages | P0 | Deskripsi, jumlah karakter, karakter terkuat, distribusi tier, populer, terbaru | Distribusi tier dihitung via materialized view refresh terjadwal |
| F-12 | VS builder | P0 | Pemilihan A/B + form + kondisi pertarungan | Desktop 2 kolom, mobile stacked; LCP < 2,5 s di 4G |
| F-13 | Comparison mode | P0 | Tabel stat + indikator Advantage/Equal/Unknown | Dapat dibagikan via URL; tanpa simulasi |
| F-14 | Battle engine | P0 | Layered decision system + weighted scoring; hasil memuat seluruh komponen §16 | Deterministik; p95 < 300 ms |
| F-15 | Hax interaction engine | P0 | Rule `ability → target → resistance → counter → success probability` | Semua aturan di tabel, dapat diedit admin |
| F-16 | Battle result + share | P0 | Winner, probability, difficulty, length, reasons, counters, scenario, disclaimer | Permalink deterministik; OG image dinamis |
| F-17 | Ingestion pipeline | P0 | Job-based, resumable, idempoten, retry backoff, rate limited, robots/ToS-aware | Tidak fetch di request user; concurrency ≤ 2 per host |
| F-18 | Source traceability | P0 | Setiap record menyimpan sumber, hash konten, parser version, fetched_at | 100% record imported punya `source_url` |
| F-19 | Conflict handling | P0 | Konflik tidak menimpa otomatis; disimpan sebagai record konflik | Admin dapat me-review; status `conflicting` terlihat di UI |
| F-20 | Duplicate detection | P0 | Normalisasi nama + alias + fingerprint → klasifikasi same-character / different-version / alt-universe / game / movie | Re-run job tidak membuat duplikat (uji di §35) |
| F-21 | Admin dashboard | P0 | Statistik sistem, job tools, edit karakter/form/stat, log | Akses berbasis role; semua aksi tercatat di audit log |
| F-22 | SEO | P0 | Title unik, meta description, canonical, OG, Twitter card, JSON-LD | Sitemap terpecah & terindeks; ISR untuk halaman karakter |
| F-23 | Images | P0 | Optimasi (format modern, lazy, sizing responsif), `image_source`/`image_license`/`image_attribution` wajib | Tidak menayangkan gambar tanpa attribution; fallback placeholder bila gambar tidak layak |
| F-24 | Analytics anonim | P1 | Track battle/matchup populer & event produk tanpa PII | Tanpa cookie pihak ketiga; consent-aware |
| F-25 | Battle history | P2 | Recent battles, saved battles, share URL | Berbasis akun untuk saved battles |
| F-26 | Team battle & tournament | P2 | 2v2, 3v3, bracket | — |
| F-27 | AI Battle Narrator | P2/P3 | Narasi setelah kalkulasi selesai; grounded pada faktual DB | Label eksplisit; fact-containment check; tidak menulis ke tabel fakta |
| F-28 | Turn-based simulation | P3 | Simulasi langkah demi langkah + timeline interaktif | Harus tetap deterministik (seeded RNG) |
| F-29 | User-created characters | P3 | Karakter buatan pengguna, dipisah dari dataset resmi | Wajib badge "community data" + moderation |
| F-30 | Debate mode | P3 | Dua sisi argumen berbasis bukti dari DB | — |

---

## 10. Character Data Model

**Prinsip:** satu karakter = satu *entity* identitas; semua variasi kekuatan = *form/version*; semua klaim = *sourced fact*.

**Entity & tanggung jawab**

| Entity | Menjawab pertanyaan | Tidak bertanggung jawab atas |
|---|---|---|
| `characters` | "Siapa karakter ini?" (identitas, alias, origin, verse) | Statistik, kekuatan |
| `character_versions` | "Bagaimana kekuatannya di era/form tertentu?" | Identitas; statistik detail |
| `verses` | "Dari semesta mana?" | Karakter |
| `statistics` | "Berapa nilai metrik tertentu untuk form ini, menurut sumber mana?" | Interpretasi hasil pertarungan |
| `abilities` (katalog) | "Apa arti sebuah kemampuan?" | Siapa yang memilikinya |
| `character_abilities` | "Karakter A punya ability X pada form ini" | Perilaku kemampuan tersebut |
| `resistances` + `character_resistances` | "Karakter B tahan terhadap Y sejauh apa?" | Interaksi antar keduanya |
| `feats` | "Apa bukti pencapaiannya?" | Angka yang dihitung engine |
| `sources` + `source_snapshots` | "Dari mana data ini dan kapan diambil?" | Interpretasi |
| `hax_interactions` | "Apa yang terjadi saat X mengenai Y?" | Siapa yang menang |
| `battle_results` | "Hasil simulasi terakhir dengan input tertentu" | Fakta kanon |

**Aturan integritas model**

1. `characters.slug` unik, lowercase, stabil seumur hidup (redirect 301 disiapkan bila slug berubah).
2. Setiap `character_versions` wajib punya ≥ 1 baris `statistics` untuk `metric = tier`, atau ditandai `data_completeness = partial`.
3. `statistics` bersifat *append-only per sumber*: mengubah nilai tidak menimpa tetapi menambah baris baru dengan `status = current` dan menandai yang lama `superseded`.
4. Semua field yang berasal dari sumber eksternal tidak boleh `NULL` pada `source_id`.
5. `character_abilities`/`character_resistances` selalu terikat pada `character_version_id`, bukan `character_id` — ini yang mencegah percampuran era.
6. Entity resolution tabel `character_aliases` menyimpan alias multi-bahasa dengan `script` (`latin`, `kanji`, `kana`, `hangul`, `cyrillic`) untuk pencarian lintas bahasa.
7. Catatan `confidence` 0–1 (numeric(3,2)) adalah estimasi kelengkapan/kejelasan klaim di sumber, **bukan** probabilitas kebenaran kanon.

**Field ringkas `characters`:** `id`, `slug`, `name`, `native_name`, `aliases` (via `character_aliases`), `image_url`, `image_source`, `image_license`, `image_attribution`, `description`, `origin`, `verse_id`, `gender`, `age`, `classification`, `media_type`, `popularity_score`, `data_completeness`, `verification_status`, `source_url`, `source_name`, `source_last_updated`, `imported_at`, `updated_at`.

**Field ringkas `character_versions`:** `id`, `character_id`, `name`, `slug`, `description`, `era`, `age_range`, `form_order`, `is_default`, plus kolom stat terdenormalisasi untuk query cepat: `tier_id`, `attack_potency_scale_id`, `speed_scale_id`, `lifting_scale_id`, `striking_scale_id`, `durability_scale_id`, `stamina_scale_id`, `range_scale_id`, `intelligence_scale_id`, `battle_iq_scale_id`, `experience_years`. Detail kanonik (nilai + kualifikasi + sumber) tetap ada di `statistics`.

> **Alasan denormalisasi:** daftar/filter/sort memerlukan join minimal pada table scan besar. Kolom stat pada `character_versions` adalah *cache* dari `statistics` yang dikelola trigger/refresh job; sumber kebenaran tetap `statistics`. Ini menurunkan kebutuhan join dari 12 menjadi 0 pada halaman daftar karakter (§29).

---

## 11. Form/Version Architecture

**Prinsip: form adalah entity kelas satu.** Satu karakter boleh memiliki banyak form; setiap form punya identitas, stat, ability, resistance, dan feat sendiri.

**Hirarki tiga tingkat**

```
Verse            (dragon-ball)
  └── Character  (Goku)                       ← identitas: alias, image, origin, verse
        └── Version/Form                     ← unit kekuatan & unit pertarungan
              ├── Stats (tier, AP, speed, …)
              ├── Abilities (dengan evidence)
              ├── Resistances (dengan level)
              ├── Feats (dengan significance)
              └── Equipment / Weaknesses
```

**Aturan operasional**

| Aturan | Detail | Alasan |
|---|---|---|
| FR-1 | Setiap karakter wajib punya tepat satu form `is_default = true` (enforced partial unique index) | UX konsisten; tidak ada pertarungan tanpa form |
| FR-2 | `display_order` menentukan urutan kronologis; `form_order` menyimpan urutan numerik | Menampilkan progresi era dengan benar |
| FR-3 | Slug form unik per karakter (`goku/ultra-instinct`), dipakai di URL `?form=` | Permalink stabil per form |
| FR-4 | Engine menerima `character_version_id`, bukan `character_id` — **tidak ada kode** yang boleh mengasumsikan satu stat per karakter | Mencegah bug pencampuran era (P2) |
| FR-5 | Menghapus form = soft delete (`deleted_at`) bila pernah dipakai `battle_results` | Auditabilitas hasil lama |
| FR-6 | Duplikasi form diizinkan untuk variasi sumber (`variant_of` self-reference) dengan flag `is_variant` | Menampung alt-universe/game/movie tanpa mengotori kanon |
| FR-7 | Perubahan stat pada form membuat `statistics.status` lama → `superseded` dan menaikkan `versions.updated_at` | Traceability & cache invalidation |

**Contoh data (ilustratif, bukan data final):**

| Character | Form | era | tier_code | speed | is_default |
|---|---|---|---|---|---|
| Goku | Kid Goku | Pilaf–21st Budokai | 9-B | Subsonic | ✗ |
| Goku | Saiyan Saga | Raditz–Vegeta | 6-B | Hypersonic | ✗ |
| Goku | Namek Saga | Frieza arc | 5-A | FTL | ✗ |
| Goku | Android Saga | Cell arc | 3-B | FTL+ | ✗ |
| Goku | Buu Saga | Majin Buu arc | 3-A | FTL+ | ✗ |
| Goku | Super (Resurrection F) | Super era | 2-C | MFTL | ✗ |
| Goku | Ultra Instinct | Tournament of Power | 2-A | MFTL+ | ✓ |
| Naruto | Part I | Pre-timeskip | 8-A | Supersonic | ✗ |
| Naruto | Part II (KCM) | War arc | 6-A | MHS | ✗ |
| Naruto | Six Paths | War arc final | 5-C | MHS+ | ✗ |
| Naruto | Baryon Mode | Boruto era | 5-B | MHS+ | ✓ |

**Dampak ke UI:** halaman karakter menampilkan daftar form sebagai tab; memilih form menukar seluruh blok stat dan ability pada render server (bukan client state besar), mempertahankan SEO per form (`?form=` di-`noindex` kecuali form default untuk mencegah duplikasi konten tipis — kecuali form dengan `feat_count ≥ 3` yang mendapat halaman sendiri `/character/[slug]/form/[formSlug]` dengan canonical sendiri).

---

## 12. Tier System

### 12.1 Desain

Tier adalah **data** (`tiers` table), bukan konstanta kode. Setiap tier punya: `tier_id`, `tier_code`, `band`, `display_order`, `parent_tier`, `numerical_rank`, `description`, `is_rankable`.

| Kolom | Tipe | Contoh | Fungsi |
|---|---|---|---|
| `tier_code` | text unique | `5-B` | Identitas yang tampil ke pengguna |
| `band` | enum | `low` / `mid` / `high` / `peak` | Tingkat dalam satu huruf; dipakai untuk badge warna |
| `numerical_rank` | smallint unique | `1…35` | Perbandingan komputatif (rank makin besar = makin kuat) |
| `parent_tier` | self FK | `5-B → 5` | Pengelompokan & agregasi (distribusi tier verse) |
| `display_order` | smallint | `1` | Urutan render di UI |
| `is_rankable` | bool | `false` untuk `Unknown`/`Varies` | Mencegah tier non-numerik masuk kalkulasi |

### 12.2 Ladder default (seed, dapat diubah admin)

Rank 1 = paling lemah; rank 35 = paling kuat. Skala ini adalah konvensi domain yang dapat diganti seluruhnya oleh admin.

| Band | Codes (rank) |
|---|---|
| 11 | 11-C (1), 11-B (2), 11-A (3) |
| 10 | 10-C (4), 10-B (5), 10-A (6) |
| 9 | 9-C (7), 9-B (8), 9-A (9) |
| 8 | 8-C (10), 8-B (11), 8-A (12) |
| 7 | 7-C (13), 7-B (14), 7-A (15) |
| 6 | 6-C (16), 6-B (17), 6-A (18) |
| 5 | 5-C (19), 5-B (20), 5-A (21) |
| 4 | 4-C (22), 4-B (23), 4-A (24) |
| 3 | 3-C (25), 3-B (26), 3-A (27) |
| 2 | 2-C (28), 2-B (29), 2-A (30) |
| 1 | 1-C (31), 1-B (32), 1-A (33) |
| Peak | High 1-A (34) |
| Peak | Tier 0 (35) |
| Non-rankable | Unknown (`numerical_rank = NULL`, `is_rankable = false`), Varies (idem) |

Setiap `tier_code` punya padanan energi referensi pada tabel `stat_scales` (§13) sehingga tier dapat dibandingkan dengan AP bila salah satunya hilang.

### 12.3 Qualifier

Qualifier adalah modifier pada klaim, bukan bagian dari tier.

| Qualifier | Semantik | Efek pada engine |
|---|---|---|
| `at_least` | nilai minimum yang terkonfirmasi | `effective_rank = rank` ; `confidence_penalty = 0.10` |
| `possibly` | kemungkinan, bukti lemah | `confidence_penalty = 0.25` ; gap dianggap setengah |
| `likely` | kemungkinan kuat | `confidence_penalty = 0.15` ; gap ×0,75 |
| `up_to` | batas atas | `effective_rank = rank` ; gap dihitung ke atas tapi dibatasi `+2 rank` |
| `higher_with` | naik bila kondisi tertentu (mis. equipment/form tambahan) | dihitung sebagai *conditional edge*, hanya aktif bila kondisi terpenuhi (criteria match) |
| `far_higher_with` | seperti di atas dengan magnitudo lebih besar | conditional edge dengan bobot 1,5× |
| `varies` | nilai tidak tetap | **MVP:** metrik dikeluarkan dari skoring, ditulis di `limitations[]` sebagai `varies_metric:<metric>:<side>`, dan `confidence` diturunkan (0,30). Menampilkan dua skenario (typical/best-case) **belum** diimplementasikan karena memerlukan kolom tambahan `best_case_scale_id`/`typical_scale_id` pada `statistics`; tanpa data itu, dua skenario hanya akan menjadi tebakan. Dicatat sebagai penyempurnaan Phase 2 |
| `unknown` | tidak diketahui | metrik dikeluarkan dari skoring (`unknown_metric:<metric>:<side>`); `data_completeness` turun; hasil diberi flag keterbatasan |

### 12.4 Aturan penegakan

- **TR-1:** `is_rankable = false` tidak boleh dipakai sebagai input pembanding → engine melewati metrik dan menuliskannya di `limitations[]`.
- **TR-2:** Selisih > 8 rank dianggap *dominan* dan men-trigger jalur decisive-edge (§16.3), bukan hanya skor besar.
- **TR-3:** Perubahan ladder (urutan/`numerical_rank`) membatalkan cache battle (invalidate by `rule_set_version` bump). Alasan: urutan tier adalah bagian dari aturan, dan hasil lama yang tersimpan tetap ditampilkan dengan versi aturan aslinya.
- **TR-4:** Tier tanpa AP (atau sebaliknya) → engine memakai estimasi dari kolom lain lewat `stat_scales.rank` dengan `assumption_log` eksplisit, dan menurunkan `confidence` hasil 0,1.

---

## 13. Stat System

### 13.1 Metrik wajib

| Metrik | Tipe nilai | Skala | Digunakan engine |
|---|---|---|---|
| `tier` | ordinal (FK `tiers`) | ladder tier | ✔ bobot 12 |
| `attack_potency` | ordinal (FK `stat_scales`) | energi (log10 joule) | ✔ 13 |
| `durability` | ordinal | energi (log10 joule) | ✔ 10 |
| `striking_strength` | ordinal | energi (log10 joule) | ✔ 5 |
| `lifting_strength` | ordinal | massa (log10 kg) | ✔ 3 |
| `speed` | ordinal + kuantitatif bila ada | m/s (log10), ekstensi non-fisik untuk FTL | ✔ 12 |
| `reaction_speed` | ordinal | m/s = kecepatan yang bisa direspons | ✔ 5 |
| `combat_speed` | ordinal | aksi/detik (log10) | ✔ 5 |
| `range` | ordinal | meter (log10) | ✔ 4 |
| `stamina` | ordinal | ladder deskriptif (jam aktivitas puncak) | ✔ 5 |
| `intelligence` | ordinal | ladder deskriptif | ✔ 4 |
| `battle_iq` | ordinal | ladder deskriptif | ✔ 6 |
| `experience` | ordinal/numerik | tahun aktif | ✔ 3 |
| `hax_tier_max` | turunan | rank tertinggi ability kategori "offensive hax" | ✔ 10 (bersama rule engine) |
| `resistance_coverage` | turunan | rasio kategori hax yang ditahan | ✔ 5 |
| `abilities` | relasional | count + kategori | ✔ 6 |

Total bobot default = **100**.

### 13.2 Struktur penyimpanan

Dua lapis, sengaja:

1. **`statistics`** (kebenaran kanonik, multi-sumber). Setiap baris: `character_version_id`, `metric`, `scale_id`, `raw_text` (mis. `"Massively FTL+"`), `qualifier`, `confidence`, `source_id`, `status` (`current`/`superseded`/`conflicting`), `notes`.
2. **`character_versions.<metric>_scale_id`** (cache terdenormalisasi untuk filter/sort). Sinkron via trigger + nightly reconcile job.

**Contoh penyimpanan ganda:**

```jsonc
// statistics row
{
  "character_version_id": "…", "metric": "speed",
  "scale_id": "speed_mftl_plus", "raw_text": "Massively FTL+",
  "qualifier": "possibly",
  "confidence": 0.72,
  "source_id": "…", "status": "current"
}
```

### 13.3 Quantifier & ekspresi gabungan

Format kanonik `stat_value`:
```
{ scale_ref, raw_text, qualifier, min_value?, max_value?, exact_value?, confidence, source_id,
  conditions?: [{ "type": "equipment|form|state|aura", "description": "…", "delta_rank": 2 }] }
```

| Kebutuhan (contoh) | Representasi |
|---|---|
| `"At least City level"` | `scale = city`, `qualifier = at_least` |
| `"Possibly Mountain level"` | `scale = mountain`, `qualifier = possibly`, `confidence = 0.6` |
| `"Up to Solar System level"` | `scale = solar_system`, `qualifier = up_to`, `min = planet` |
| `"Higher with Ki Charge"` | `scale = …`, `conditions[{type: state, delta_rank: 2}]` |
| `"Far higher with Ultra Instinct"` | `conditions[{type: form, delta_rank: 4, multiplier: 1.5}]` |
| `"Varies"` | `qualifier = varies` → engine menjalankan dua skenario (typical/best-case) dan menampilkan keduanya |
| `"Unknown"` | metrik di-skip + dicatat di `limitations[]` |

**Aturan SR-1:** semua representasi menyimpan `raw_text` **apa adanya** agar bukti asli tidak hilang saat normalisasi (audit).
**Aturan SR-2:** kuantifikasi (min/max/exact) bersifat opsional. Bila tidak ada, engine memakai rank ordinal — tidak mengarang angka.

---

## 14. Ability System

### 14.1 Model

```
ability_categories  (katalog taksonomi, ~60 baris, admin-editable)
        ▲
        │ category_id
   abilities        (katalog kemampuan ternormalisasi, unik secara slug)
        ▲
        │ ability_id (+ level, activation, range, limitations, counters)
 character_abilities  ← terikat pada character_version_id
        │
        └── evidence / source
```

**Kategori awal (seed, ≥ 50 kategori).** Contoh: Attack Manipulation, Energy Manipulation, Reality Warping, Time Manipulation, Space Manipulation, Mind Manipulation, Soul Manipulation, Matter Manipulation, Power Nullification, Regeneration, Immortality, Teleportation, Sealing, Absorption, Precognition, Resistance, Conceptual Manipulation, Existence Erasure, Information Manipulation, Probability Manipulation, Causality Manipulation, Fate Manipulation, Void Manipulation, Law Manipulation, Empathic Manipulation, Fear Manipulation, Illusion Creation, Duplication, Adaptation, Reactive Evolution, Regeneration Negation, Immortality Negation, Dimensional Travel, BFR, Healing, Forcefield Creation, Aura, Statistics Amplification, Statistics Reduction, Damage Reduction, Status Effect Inducement, Elemental Manipulation, Biological Manipulation, Technology Manipulation, Curse Manipulation, Sound Manipulation, Light Manipulation, Darkness Manipulation, Gravity Manipulation, Magnetism Manipulation, Weather Manipulation, Summoning, Shapeshifting, Invisibility, Intangibility, Non-Physical Interaction, Durability Negation.

### 14.2 Field per `ability`

| Field | Wajib | Keterangan |
|---|---|---|
| `name` | ✔ | Nama kanonik, mis. "Time Stop" |
| `slug` | ✔ | Untuk URL & relasi |
| `category_id` | ✔ | Harus salah satu kategori terkatalog |
| `description` | ✔ | Penjelasan netral |
| `default_level` | ✗ | Tingkat umum |
| `activation_condition` | ✗ | Syarat aktivasi (mis. "requires eye contact") |
| `activation_speed` | ✗ | Ordinal (instan/cepat/lambat) — dipakai untuk cek apakah bisa aktif sebelum lawan bertindak |
| `range_scale_id` | ✗ | Jangkauan efektif |
| `cooldown` | ✗ | Deskriptif |
| `limitations` | ✗ | Batasan |
| `counters` | ✗ | Daftar ability/kategori penghitung |
| `is_offensive` | ✔ | Menentukan apakah masuk `hax_tier_max` |
| `is_defensive` | ✔ | Menentukan kontribusi ke pertahanan |
| `is_passive` | ✔ | Passive tidak butuh aksi/kesempatan |
| `source_id` | ✔ | Wajib (asal definisi) |

### 14.3 Field per `character_abilities`

`character_version_id`, `ability_id`, `proficiency` (ordinal: novice/intermediate/master/godlike), `level_notes`, `activation_notes`, `effective_range_scale_id`, `evidence_text` (kutipan pendek, ≤ 400 karakter), `source_id`, `verification_status`, `confidence`.

**Aturan AB-1:** Ability yang sama tidak boleh diduplikasi sebagai string berbeda antar karakter — kontribusi baru harus lewat katalog. Ini yang membuat rule engine bisa bekerja lintas karakter.
**Aturan AB-2:** `evidence_text` wajib ≤ 400 karakter dan tidak menyimpan kutipan panjang (perlindungan hak cipta, §30).
**Aturan AB-3:** Kemampuan yang tidak muncul di katalog (belum ternormalisasi) disimpan sebagai `pending_ability` di staging dan **tidak** diikutkan engine sampai admin memetakannya (fail-safe: hindari hax palsu masuk kalkulasi).

---

## 15. Resistance System

### 15.1 Model

```
resistance_types (katalog, meistalnya 1:1 dengan ability_categories)
     ▲
     │ resistance_type_id
character_resistances (character_version_id, resistance_type_id, level, evidence, source)
```

`level` adalah ordinal: `none` (0) · `limited` (1) · `moderate` (2) · `high` (3) · `absolute` (4).

### 15.2 Semantik untuk engine

| Konsep | Definisi operasional | Alasan |
|---|---|---|
| `resistance_level` | Tingkat penahanan pada kategori tertentu untuk form tertentu | Membandingkan kemampuan hax dengan daya tahan lawan |
| `coverage_ratio` | jumlah kategori dengan level ≥ moderate ÷ jumlah kategori hax yang dimiliki lawan | Proksi "seberapa kebal secara umum" |
| `resistance_gap` | `attack_level − resistance_level` per kategori | Menentukan status interaksi (blocked/reduced/effective) |
| `not_documented` ≠ `none` | Tidak ada data ditampilkan sebagai `Unknown`, **bukan** `none` | Kejujuran data; menghindari hukuman otomatis pada karakter berdata minim |

### 15.3 Matriks status interaksi (dipakai rule engine)

| attack_level \ resistance_level | none | limited | moderate | high | absolute |
|---|---|---|---|---|---|
| weak | effective | effective | reduced | blocked | blocked |
| medium | effective | reduced | reduced | blocked | blocked |
| strong | effective | effective | reduced | reduced | blocked |
| absolute/negation | effective | reduced | reduced | blocked | blocked* |

`blocked*` = hanya jika resistance memiliki `level_evidence` yang bersumber; jika tidak, tetap `reduced` dan dicatat sebagai `assumption` dengan penalti confidence 0,2.

**Aturan RS-1:** Resistance tanpa sumber **tidak boleh** menghasilkan status `blocked`. Maksimal `reduced`.
**Aturan RS-2:** Resistance terhadap kategori "Negation" hanya berlaku lintas kategori yang dinyatakan eksplisit pada `hax_interactions` (tidak ada resistensi generik universal).
**Aturan RS-3:** `absolute` hanya dapat diberikan bila ada ≥ 1 feat bertanda `verified` yang mendukungnya.

---

## 16. Battle Engine

### 16.1 Prinsip

1. **Deterministik.** Input + `engine_version` + `rule_set_version` → keluar hasil identik. Tidak ada RNG kecuali mode turn-based (Phase 3, itu pun *seeded*).
2. **Layered, bukan single score.** Skor total hanya satu dari beberapa lapis.
3. **Rule-based hax lebih tinggi otoritasnya daripada skor.** Keunggulan hax yang jelas dapat menang tanpa memandang skor total.
4. **Jujur pada ketidaklengkapan data.** Data kurang → `insufficient_data`, bukan tebakan.
5. **Configurable.** Semua bobot, threshold, dan aturan interaksi berasal dari tabel.

### 16.2 Input

```ts
type BattleInput = {
  side_a: { character_version_id: string };
  side_b: { character_version_id: string };
  conditions: {
    mode: "standard" | "equal_speed" | "in_character" | "bloodlusted" | "random_encounter";
    starting_distance_scale_id?: string;
    battlefield_id?: string;             // arena netral default
    knowledge_level: "none" | "partial" | "full";
    prep_time: "none" | "short" | "extended";
    win_condition: "ko" | "death" | "incapacitation" | "bfr" | "submission" | "any";
    speed_equalized: boolean;
  };
  rule_set_version: string;
};
```

### 16.3 Alur keputusan berlapis

```
LAYER 0  Gate kelayakan
         Data minimum ada? (tier/AP/durability/speed untuk kedua sisi)
         Tidak → hasil insufficient_data + limitations[]  (STOP, tanpa pemenang)

LAYER 1  Dominasi mutlak (Absolute Dominance Gate)
         Δrank ≥ 8 pada tier DAN Δrank ≥ 6 pada durability DAN
         tidak ada resistance relevan di sisi yang tertinggal
         → pemenang ditetapkan, probability ≥ 0,95, difficulty = low
         (mismatch-nya ekstrem, tetapi KESULITAN bagi pemenang justru minimal —
          konsisten dengan pemetaan Layer 5; "extreme" pada kesempatan ini akan
          bertabrakan dengan arti difficulty di Layer 5)
         (dilewati bila hax decisive milik pihak tertinggal ada)

LAYER 2  Decisive Edge (hax & win condition)
         Untuk setiap ability ofensif milik A:
           a) cek A bisa mengaktifkannya sebelum B bertindak
              (activation_speed & range & speed gap & prep/knowledge)
           b) cek resistance/counter B (hax_interactions → matrix §15.3)
           c) cek apakah hasilnya memenuhi win_condition
         ability dianggap DECISIVE bila status = effective DAN memenuhi win condition
         → Bila hanya A punya decisive edge: A menang, difficulty & length dihitung dari sisa gap
         → Bila kedua sisi punya: masuk LAYER 3 sebagai "mutual decisive" (menentukan length & difficulty)
         → Bila tidak ada: lanjut LAYER 3 murni skor

LAYER 3  Weighted scoring (Configurable)
         S = Σ (w_i × a_i)        a_i ∈ [−1, 1], Σw_i = 100
         p_raw = 1 / (1 + e^(−k·S))     k default 2.2 (temperature)
         Batch: p_A = p_raw, p_B = 1 − p_raw

LAYER 4  Blend & kalibrasi
         decisive edge tunggal → p_A = max(p_A, 0.90) dan dilaporkan sebagai "decisive"
         mutual decisive → p diberi cap [0.35, 0.65] (hasil tidak boleh terlihat pasti)
         qualifier penalti → p ditarik 20% menuju 0,50
         data gap → p ditarik menuju 0,50 dengan faktor (1 − gap_ratio), dan flag `low_confidence`

LAYER 5  Difficulty & Battle Length
         difficulty: |p−0.5| ≥ 0,45 → Low · ≥0,28 → Mid · ≥0,12 → High · else Extreme
         length: gabungan durability gap, regen/immortality, speed parity, hax "instant"
                 → Short (≤ 1 menit naratif) / Medium / Long

LAYER 6  Reasoning (deterministik, template-based)
         primary_reason, secondary_factors[], critical_counter, potential_scenario
         semua tervalidasi: setiap klaim harus punya pointer ke data input (fact-containment)

LAYER 7  Persist & cache
         simpan battle_result + kondisi + engine_version + rule_set_version + input_hash
```

### 16.4 Kondisi pertarungan → efek komputasi

| Kondisi | Efek pada perhitungan | Alasan |
|---|---|---|
| `standard` | Netral | Baseline ekosistem |
| `equal_speed` / `speed_equalized` | `a_speed` dipaksa 0; reaction/combat speed tetap dihitung separuh | Memungkinkan debat fokus hax/AP |
| `in_character` | Hax yang bertentangan dengan sifat karakter diberi `activation_penalty 0,35`; kecenderungan tidak menggunakan kekuatan penuh | Menghormati karakterisasi (data `character_traits`) |
| `bloodlusted` | Semua hax dianggap aktif bila mampu; `activation_penalty = 0`; keunggulan hax dinaikkan 1,2× | Skenario maksimal |
| `random_encounter` | `knowledge_level` ≤ partial; prep = none; `a_battle_iq` dinaikkan 1,2× | Menghargai improvisasi |
| `starting_distance` | Di luar range efektif hax → ability diberi `out_of_range` | Menghindari Time Stop jarak jauh tanpa dasar |
| `battlefield` | Efek lingkungan terbatas pada flag netral/tertutup/terbuka (5 arena default) | Menghindari arena spesifik tak terverifikasi |
| `knowledge_level` | `full` menaikkan efektivitas counter 1,25×; `none` menurunkan 0,8× | Pengetahuan memengaruhi pemilihan strategi |
| `prep_time` | `extended` memberi bonus conditional-edge pada ability ber-`prep_requirement` | Menghargai persiapan |
| `win_condition` | Memfilter hax yang relevan. `win_condition_map` pada rule set memetakan kategori ability → **daftar setting win condition** yang dapat dipenuhinya; ability hanya menjadi *decisive* bila setting pertarungan ada di daftar itu. Contoh: `bfr` → `[bfr, any]`, sehingga BFR tidak decisive pada setting `death`; kategori utilitas (`teleportation`, `regeneration`) dipetakan ke `[]` dan tidak pernah menjadi jalur kemenangan. **Dapat diubah admin tanpa deploy** | Win condition adalah konteks penentu |

### 16.5 Kontrak keluaran

```ts
type BattleResult = {
  battle_id: string;                            // diturunkan dari input_hash, bukan random
  input_hash: string;                           // SHA-256 bentuk kanonik input (kunci cache)
  engine_version: string;
  rule_set_version: string;
  winner: "a" | "b" | "draw" | "insufficient_data";
  win_probability: { a: number; b: number };    // jumlah 1,00
  confidence: number;                           // 0..1 sudah termasuk penalti data
  low_confidence: boolean;                      // true bila < threshold banner (§17.3 BC-2)
  difficulty: "low" | "mid" | "high" | "extreme";
  battle_length: "short" | "medium" | "long";
  decisive_edges: DecisiveEdge[];
  ability_outcomes: AbilityOutcome[];           // hasil rule engine hax: blocked/reduced/applied/unresisted
  score_breakdown: ScoreContribution[];         // per metrik: nilai a_i, bobot, kontribusi
  weighted_score: number;                       // S setelah normalisasi bobot
  dominance: DominanceResult;                   // hasil Layer 1 + alasan bila tidak diterapkan
  coverage: { a: number; b: number };           // rasio cakupan resistensi vs ability ofensif lawan
  primary_reason: string;
  secondary_factors: string[];
  critical_counter: string;
  potential_scenario: string;                   // template deterministik
  reasoning: { primary; secondary; critical_counter; scenario };  // versi ber-rujukan (AC-34)
  limitations: string[];
  assumptions: string[];
  disclaimer: string;                           // teks wajib §18.4
};
```

**Konvensi kode `limitations[]` — hanya tiga keluarga ini yang diimplementasikan** (semuanya berakhiran `:<a|b>` sehingga UI dapat menandai sisi mana yang bermasalah):

| Pola | Arti | Sumber kode |
|---|---|---|
| `missing_metric:<metrik>:<a\|b>` | metrik tidak terdokumentasi pada sisi tersebut | `gates.ts` (metrik wajib) & `metrics.ts` (metrik skoring) |
| `unknown_metric:<metrik>:<a\|b>` | metrik bernilai `unknown` → tidak dapat dibandingkan | `gates.ts` & `qualifiers.ts` |
| `varies_metric:<metrik>:<a\|b>` | metrik bernilai `varies` → dikeluarkan dari skoring | `qualifiers.ts` |

**Yang belum dijadikan kode — dan sengaja tidak saya tulis seolah ada:** kualifikasi lemah (`possibly`, `at least`, …) dan konflik antar sumber **tidak** muncul sebagai entri `limitations[]`. Keduanya sudah memengaruhi hasil lewat jalur lain: kualifikasi lewat penalti `qualifier_penalty` (§17.3), konflik lewat penalti `per_unresolved_conflict` pada `confidence`. Menambah kode `qualifier:*`/`conflict:*` ke `limitations[]` adalah pekerjaan Sprint 3–4 (dibutuhkan saat UI admin menampilkan alasan keyakinan rendah per sisi); sampai itu ada, klaim di dokumen ini dibatasi pada tiga keluarga di atas.

**Placeholder saat `winner = "insufficient_data"`.** Kolom DB bersifat `NOT NULL`, jadi hasil tanpa pemenang tetap mengisi field: `difficulty = "extreme"`, `battle_length = "short"`, `decisive_edges = []`, `score_breakdown = []`, `weighted_score = 0`, `coverage = {a:0,b:0}`, `confidence = confidence.floor`, `low_confidence = true`, dan `assumptions` memuat penanda `insufficient_data_placeholder_fields`.

**Aturan UI yang mengikat (bukan saran):** bila `assumptions` memuat `insufficient_data_placeholder_fields`, UI **wajib** menampilkan status "data tidak memadai" beserta daftar field yang hilang, dan **wajib tidak** menampilkan `difficulty`/`battle_length`/`weighted_score` sebagai temuan analisis. Tanpa aturan ini, `difficulty="extreme"` pada hasil tanpa pemenang akan terbaca pengguna sebagai "pertarungan sangat sulit", padahal artinya "tidak ada simulasi yang dijalankan". Kasus `incomplete-01`…`incomplete-03` mengunci perilaku ini.

---

## 17. Battle Calculation Logic

### 17.1 Normalisasi nilai metrik

| Tipe metrik | Formula `a_i` |
|---|---|
| Ordinal ber-rank (tier, AP, durability, speed, dst.) | `a_i = clamp((rank_A − rank_B) / N_i, −1, 1)` dengan `N_i` = span normalisasi metrik (tier: 8; AP: 10; speed: 10; range: 8; stamina: 2; intelligence: 2; battle IQ: 2) |
| Turunan (`hax_tier_max`) | `a_i = clamp((haxRankA − haxRankB) / 6, −1, 1)` lalu dikoreksi oleh hasil rule engine (±0,3) |
| Turunan (`resistance_coverage`) | `a_i = clamp((covA − covB) × 4, −1, 1)` |
| Numerik berkuantifikasi (`experience_years`) | `a_i = clamp(log10(yA+1)/log10(yB+1) − 1, −1, 1)` |
| Missing pada satu sisi | `a_i = 0` + entri `limitations[]` + `data_gap++` |

### 17.2 Bobot default (`battle_rule_sets.weights`)

```jsonc
{
  "tier": 12, "attack_potency": 13, "durability": 10, "speed": 12,
  "reaction_speed": 5, "combat_speed": 5, "range": 4, "stamina": 5,
  "intelligence": 4, "battle_iq": 6, "experience": 3,
  "abilities": 6, "hax": 10, "resistances": 5
}
```

**Alasan bobot ini:** tier & AP tertinggi karena menentukan apakah serangan bahkan relevan (durability wall). Speed tinggi karena superioritas kecepatan bersifat multiplikatif (bisa menyerang tanpa dibalas). Durability tinggi karena menahan serangan adalah prasyarat bertahan hidup. Hax & resistances memperoleh 15 gabungan: cukup untuk membalik keunggulan stat, tidak cukup untuk mengalahkan dominasi tier mutlak (yang dijaga Layer 1). Battle IQ & intelligence lebih rendah karena sulit diverifikasi dan mudah bias.

### 17.3 Kalibrasi probabilitas

```
S        = Σ (w_i × a_i) / 100                    ∈ [−1, 1]   // bobot berjumlah 100
p₀       = 1 / (1 + e^(−k·S)),  k = 2.2           // memberi ~0,71 pada S = 0,4

// (a) lantai/lis atas decisive edge — MENANG atas penarikan kalibrasi berikutnya
both decisive  → p ← clamp(p₀, 0.35, 0.65)        // mutual: hasil tidak boleh tegas
A decisive     → p ← max(p₀, 0.90)
B decisive     → p ← min(p₀, 0.10)

// (b) penarikan ke 0,5 karena bukti lemah — besarnya = penalti kualifikasi TERBESAR
//     di antara kedua sisi, dibatasi 0,20 (bukan rata-rata, bukan penjumlahan)
pull = min(0.20, max(qualifier_penalty[q] untuk seluruh stat ber-status current))
p ← p + (0.5 − p) × pull

// (c) penarikan karena data hilang
p ← p + (0.5 − p) × gap_ratio

// (d) lantai decisive edge dipulihkan: penarikan TIDAK boleh membatalkan (a)
p ← max(p, 0.90) bila lantai ≥ 0.5, else min(p, 0.10)
p ← clamp(p, 0.02, 0.98)

confidence = 1,00 − 0,08·(metrik_skoring_hilang_A + metrik_skoring_hilang_B)
                    − 0,05·sisi_tanpa_data_ability
                    − 0,05·sisi_dengan_≥3_kualifikasi_lemah
                    − 0,10·konflik_belum_terselesaikan     (floor 0.25)
```

**Catatan penting soal `qualifier_penalty`:** tabel penalti bertipe per-kualifikasi (`possibly: 0.25`, `varies: 0.30`, `unknown: 0.40`, `at_least/at_most/up_to/higher_with: 0.10`, `likely: 0.15`, `exact: 0`). Yang dipakai engine adalah **nilai terbesar**, bukan akumulasi — alasannya, sepuluh klaim `possibly` tidak membuat model sepuluh kali lebih ragu dibanding satu klaim `possibly`; keraguan dibatasi oleh kualifikasi terlemah yang ada di meja. Batas 0,20 mencegah satu kualifikasi `varies` melemparkan hasil ke 0,50 dan meniadakan seluruh perhitungan statistik.

**Catatan soal `confidence`:** hanya metrik yang **ikut menskor** yang dihitung hilang. Metrik `varies`/`unknown` yang memang sengaja dikeluarkan tidak dihukum dua kali (sekali dikeluarkan dari skor, sekali menurunkan keyakinan) — penalti untuk kasus itu datang dari jalur `qualifier_penalty`, bukan dari `per_missing_metric`.

**Aturan BC-1:** `p` **bukan** probabilitas statistik dunia nyata; ini skor keyakinan model pada asumsi dan kondisi yang dipilih. Ditampilkan sebagai "Estimated Win Probability" dan selalu disertai `confidence` dan `disclaimer`.
**Aturan BC-2:** bila `confidence < 0.45`, hasil ditampilkan dengan banner "Data terbatas — hasil indikatif" dan pemenang **tidak** dinyatakan sebagai kesimpulan tegas.
**Aturan BC-3:** `draw` hanya dihasilkan bila `|p_A − 0,5| < 0,02` dan tidak ada decisive edge.
**Aturan BC-4:** Semua konstanta (`k`, threshold difficulty, `N_i`, faktor penalti) hidup di `battle_rule_sets`; mengubahnya menaikkan `rule_set_version` dan menginvalidasi cache.

### 17.4 Reasoning generator (deterministik)

Urutan template yang memastikan traceability:

1. **Primary reason** — dipilih dari kontribusi skor terbesar + decisive edge bila ada.
   Contoh: `"Speed advantage (2 band) + superior AP (Δ4 rank) + resistance to Time Manipulation"`.
2. **Secondary factors** — 2–4 kontribusi berikutnya dengan tanda arah.
3. **Critical counter** — dihasilkan hanya bila pihak yang lemah punya ≥ 1 jalur menang yang belum tertahan; jika tidak ada: `"No documented win condition against <ability> + <resistance> combination."`
4. **Potential scenario** — paragraf 3–5 kalimat dari template bercabang berdasarkan `battle_length`, `decisive_edges`, dan `starting_distance`. Tanpa bahasa absolut ("pasti", "selalu") dan selalu menyebut asumsi kondisi.
5. **Limitations** — semua metrik yang missing/varies, konflik sumber, dan asumsi estimasi.

**Aturan RG-1 (anti-halusinasi):** setiap kalimat pada keempat field di atas harus dapat dipetakan ke ≥ 1 elemen `score_breakdown`, `decisive_edges`, atau `limitations`. Validator menolak rendering bila ada klaim tanpa rujukan (fail-closed, bukan fail-open).

---

## 18. Data Ingestion Architecture

### 18.1 Prinsip

1. **Dipisah tegas** menjadi 7 tahap independen: source discovery → fetching → parsing → normalization → validation → database insertion → update/synchronization.
2. **Off-request.** Ingestion tidak pernah berjalan di jalur request pengguna.
3. **Idempoten.** Menjalankan ulang job yang sama tidak menciptakan duplikat.
4. **Resumable.** Job yang terputus dapat dilanjutkan dari checkpoint.
5. **Patuh.** `robots.txt`, ToS, rate limit, throttling, dan penghormatan hak sumber adalah syarat lulus, bukan opsi.
6. **Traceable.** Setiap record menyimpan asal-usul lengkap.

### 18.2 Pipeline

```
┌────────────────┐   ┌──────────────┐   ┌─────────────┐   ┌─────────────────┐
│ Source          │──▶│ Fetch Queue   │──▶│ Rate Limiter│──▶│ Fetcher          │
│ Registry        │   │ (DB-backed)   │   │ (token      │   │ (HTTP, ETag,     │
│ (allow-list,    │   │              │   │  bucket/host)│   │  If-Modified,    │
│  robots cache,  │   └──────────────┘   └─────────────┘   │  timeout 15s,    │
│  legal_status)  │                                        │  UA jelas,       │
└────────────────┘                                        │  compress)       │
                                                          └────────┬────────┘
                                                                   ▼
  ┌──────────────────┐   ┌──────────────┐   ┌────────────────┐   ┌──────────────┐
  │ Search Index &    │◀─│ Database      │◀─│ Entity Resolver│◀─│ Duplicate     │
  │ Cache Invalidation│   │ (staging →    │   │ (character vs  │   │ Detector      │
  │ (tsvector, MV,    │   │  canonical,   │   │  form vs verse │   │ (fingerprint, │
  │  KV cache purge)  │   │  upsert)      │   │  vs alt-universe│  │  alias match) │
  └──────────────────┘   └──────────────┘   └────────────────┘   └──────┬───────┘
                                          ▲                              │
                                 ┌────────┴────────┐   ┌────────────────┴──────┐
                                 │ Validator        │◀─│ Content Parser        │
                                 │ (schema + rule + │   │ (adapter-specific,    │
                                 │  completeness +  │   │  parser_version,      │
                                 │  conflict detect)│   │  selector-based)      │
                                 └─────────────────┘   └───────────────────────┘
```

Detail diagram & state machine: **Appendix E**.

### 18.3 Komponen

| Komponen | Tanggung jawab | Alasan desain |
|---|---|---|
| `sources` registry | Daftar sumber dengan `base_url`, `source_type` (`wiki`/`api`/`dataset`/`manual_url`), `legal_status` (`allowed`/`restricted`/`disabled`), `respect_robots`, `rate_limit_rps`, `attribution_text` | Sumber yang tidak diizinkan tidak dapat diaktifkan tanpa perubahan data eksplisit |
| Robots gate | Ambil & cache `robots.txt` (TTL 24 jam) per host; tolak path yang disallow; tolak bila fetch `robots.txt` gagal (fail-closed) | Kepatuhan bukan opsional |
| Adapter interface | `discover()`, `fetch()`, `parse()`, `normalize()` — satu adapter per sumber | Menambah sumber = menambah modul, tidak menyentuh core |
| Fetch queue | Tabel `ingestion_jobs` (status, priority, `next_attempt_at`) | Tanpa broker tambahan; murah, transaksional, dapat diaudit |
| Rate limiter | Token bucket per host di DB/KV; default 1 req/s, burst 3, concurrency 2 | Anti-flood; mencegah pemblokiran & menjaga hubungan baik |
| Fetcher | Conditional GET (ETag/Last-Modified), timeout 15 s, retry 5× backoff eksponensial 2 s×2^n + jitter, hormati `Retry-After` | Hemat bandwidth & sopan |
| Parser | Selector-based, `parser_version` wajib, output = objek mentah bertipe | Perubahan struktur sumber terdeteksi sebagai error, bukan data salah senyap |
| Normalizer | Format → schema internal; simpan `raw_text` + nilai ternormalisasi | Auditability |
| Validator | Schema, enum, referential, kelengkapan minimum, deteksi konflik | Mencegah data tak jelas masuk |
| Duplicate detector | Fingerprint (`verse + normalized_name + era`), alias overlap (trigram ≥ 0,82), form-order proximity | Entity resolution §21 |
| Entity resolver | Klasifikasi: same character / different version / alternate universe / game / movie | Mencegah database kacau |
| Upsert layer | `INSERT … ON CONFLICT DO UPDATE` dengan `WHERE source_priority` | Idempoten & tidak menimpa sumber lebih tinggi dengan lebih rendah |
| Index/cache sync | Update `search_vector`, refresh MV, purge cache kunci terkait | Search tetap akurat & cepat |

### 18.4 Kewajiban atribusi & disclaimer (di tingkat data)

Setiap record yang berasal dari eksternal wajib menyimpan dan menampilkan:
`source_name`, `source_url`, `fetched_at`, `parser_version`, dan `attribution_text` dari registry sumber.
UI menampilkan blok "Sources" dengan tautan keluar `rel="noopener nofollow"` dan label "Data berasal dari sumber eksternal; Anime VS Battle tidak mengklaim kepemilikan."

**Teks disclaimer standar (wajib, verbatim, dapat diterjemahkan tanpa mengubah makna):**
> *Battle outcomes are calculated from available statistics, abilities, resistances, assumptions, and selected conditions. Hasil bersifat simulasi/analitis, bukan hasil resmi dan bukan klaim kanon.*

### 18.5 Kebijakan sumber (non-negotiable)

| Aturan | Isi |
|---|---|
| IG-1 | Sebelum mengaktifkan sumber: cek `robots.txt`, cek ToS, dan pastikan jenis akses yang diizinkan |
| IG-2 | Dilarang membuat mekanisme melewati anti-bot, CAPTCHA, login, paywall, atau access control — **tidak ada pengecualian** |
| IG-3 | Bila direct scraping tidak diizinkan, gunakan: public API resmi, approved feed, exported dataset berlisensi, import yang dikelola admin, atau manual URL import |
| IG-4 | Rate limit default konservatif (1 req/s/host); tidak ada paralelisasi lintas-izin |
| IG-5 | Menyimpan `content_hash` dan excerpt pendek, **bukan** arsip penuh halaman sumber |
| IG-6 | Menghormati permintaan takedown dalam ≤ 5 hari kerja (§30) |
| IG-7 | Data yang masuk dengan `legal_status = restricted` hanya boleh berasal dari impor manual/dataset berlisensi |

### 18.6 Strategi "no scraping untuk menutupi ketiadaan sumber sah"

Karena banyak wiki powerscaling membatasi akses otomatis, MVP mengandalkan, secara berurutan:

1. **Admin-managed import** (CSV/JSON dengan template; jalur utama MVP) — semua field traceable.
2. **Manual URL import** (satu halaman per aksi, divalidasi allow-list).
3. **Adapter allow-list** untuk sumber dengan API/izin eksplisit.
4. **Dataset berlisensi** (import batch) bila tersedia.
5. **Adapter ter-flag** untuk sumber yang statusnya `restricted`; **nonaktif secara default**, hanya dapat diaktifkan oleh admin yang mengonfirmasi izin (`sources.legal_status = allowed` + `legal_reviewed_by`).

> **Alasan:** arsitektur tetap siap untuk otomasi penuh, namun tidak ada satu baris kode pun yang *wajib* melanggar ToS agar MVP berfungsi. Ini melindungi produk dari risiko hukum sekaligus memenuhi target 10.000 karakter via impor terkelola.

---

## 19. Source Synchronization

### 19.1 Kelas reputasi sumber

| Prioritas | Kelas | Definisi | Menang konflik? |
|---|---|---|---|
| 1 (tertinggi) | `primary_canon` | Materi resmi (manga/anime/game/novel) yang dikutip langsung | Ya |
| 2 | `official_secondary` | Panduan/author statement resmi | Ya bila tidak ada kelas 1 |
| 3 | `curated_db` | Dataset berlisensi / editor internal | Ya atas kelas 4 |
| 4 | `community_wiki` | Wiki publik | Tidak; hanya mengisi field kosong |
| 5 (terendah) | `forum_user` | Forum/konten pengguna | Tidak; hanya sebagai petunjuk, tidak pernah jadi fakta |

### 19.2 Mode sinkronisasi

| Mode | Scope | Trigger | Frekuensi | Catatan |
|---|---|---|---|---|
| `incremental` | Halaman yang `source_last_updated` berubah / `content_hash` berbeda | cron | 6 jam | Default |
| `scheduled_full` | Seluruh sumber ber-`legal_status = allowed` | cron | 7 hari | Batch kecil, throttle ketat |
| `manual_run` | Admin menekan "Sync Now" | manual | sesuka | Rate-limited 1 per 5 menit per admin |
| `single_character` | Satu karakter | admin halaman karakter | sesuka | Re-import |
| `single_verse` | Semua karakter dalam satu verse | admin verse page | sesuka | — |
| `reparse` | Ulangi parse tanpa fetch ulang (pakai snapshot) | admin | sesuka | Dipakai saat parser naik versi |

### 19.3 Algoritma perubahan (change detection)

```
1. discover() → daftar kandidat URL + last_modified (dari sitemap/API/index)
2. bandingkan dengan sources/source_snapshots:
   ├─ URL baru                → fetch
   ├─ ETag/Last-Modified beda → fetch (conditional)
   ├─ content_hash beda       → parse + normalize + validate + upsert
   └─ identik                 → skipped (hemat bandwidth, tercatat)
3. upsert menggunakan source_priority sebagai otoritas konflik
4. field-level merge: nilai tidak ditimpa bila sumber baru berprioritas lebih rendah
5. konflik → baris di character_source_conflicts (status = open)
6. bump versions.updated_at, purge cache, refresh search_vector
```

### 19.4 Kontrol operasional

- **Kill switch** per sumber (`legal_status = disabled`) → semua job sumber tersebut langsung `skipped`.
- **Budget harian** per sumber (`max_fetches_per_day`) — melewati batas → job `partial` + `error_type = RateLimited`.
- **Observability**: metrik per sumber (fetch sukses/gagal, byte, p50/p95 durasi parse, rasio record baru vs update, error rate). Alert bila error rate > 10% selama 3 run berturut-turut.
- **Reversibilitas**: setiap upsert menyimpan `before`/`after` di `audit_logs` sehingga perubahan dapat dibalik per-record.
- **Snapshot policy**: simpan hash + parser version + excerpt; simpan HTML penuh hanya bila lisensi sumber mengizinkan dan ≤ 30 hari (retensi terbatas).

---

## 20. Data Validation

### 20.1 Lapisan validasi

| L | Lapisan | Memeriksa | Kegagalan → |
|---|---|---|---|
| V1 | Transport | HTTP 200, content-type sesuai, ukuran wajar (> 500 B, < 5 MB) | retry / `SourceUnavailable` |
| V2 | Struktur | Element wajib direktorat parser ada; JSON schema (bila API) | `ParserError` + job `failed` |
| V3 | Skema internal | Tipe, enum, panjang, non-null, FK | `InvalidData`; record ditolak, sisanya lanjut → job `partial` |
| V4 | Kelengkapan | Field minimum per tipe record (karakter: name+verse; form: name+≥1 stat; stat: `raw_text`+`source_id`) | `MissingRequiredField` + `data_completeness = partial` |
| V5 | Referensial | Verse/ability/resistance harus ada di katalog; yang tidak ada → `pending_*` staging | Kemampuan tidak masuk engine (AB-3) |
| V6 | Konsistensi lintas-field | form `is_default` tidak boleh > 1; tier form anak tidak boleh > parent tanpa flag; speed form tidak boleh turun jauh tanpa `era` berbeda | `InvalidData` (blocking) atau warning |
| V7 | Konflik sumber | Nilai berbeda untuk field & form yang sama dari sumber berbeda | `character_source_conflicts`, tidak overwrite |
| V8 | Plausibilitas statistik | Distribusi tier per verse tidak melompat absurd (deteksi outlier z-score > 4 pada verse) | Warning + flag review admin |
| V9 | Anti-duplikat | Fingerprint/alias match | `DuplicateCharacter`, dialihkan ke resolusi (§21) |

### 20.2 Aturan wajib

- **VA-1:** Record tanpa `source_id` **tidak pernah** masuk tabel kanonik (boleh berada di staging).
- **VA-2:** Validasi bersifat **fail-closed** untuk field fakta dan **fail-open** untuk field kosmetik (gambar, deskripsi pendek) dengan flag.
- **VA-3:** Setiap penolakan menulis baris `ingestion_errors` dengan payload mentah (≤ 4 KB), sehingga bug parser dapat direproduksi offline.
- **VA-4:** Ambang kelengkapan minimum untuk tampil publik: karakter `verified|imported` + ≥ 1 form + tier diketahui.
- **VA-5:** Semua nilai masuk lewat parameterized query; tidak ada string SQL yang dibangun dari data sumber.

---

## 21. Duplicate Resolution

### 21.1 Kasus & keputusan

| Kasus | Contoh | Keputusan | Implementasi |
|---|---|---|---|
| Same character, penulisan berbeda | "Naruto", "Naruto Uzumaki", "Uzumaki Naruto" | 1 karakter + alias | `character_aliases` + trigram match → merge otomatis bila skor ≥ 0,90 |
| Same character, era berbeda | "Naruto (Part II)", "Naruto (KCM)" | 1 karakter + 2 form | Era/`form_order` → tambah `character_versions` |
| Same character, universe berbeda | "Goku (GT)" vs "Goku (Super)" | Karakter sama, form `is_variant` berbeda verse bila perlu | `character_versions.variant_of` |
| Alternate universe / spin-off | "Naruto (Road to Ninja)" | Verse terpisah + relasi *inspired_by* | `character_versions.variant_of` + `verse_id` baru |
| Game version | "Goku (Xenoverse)" | Form dengan `media_type = game` | Flag `media_type` + `is_variant = true` |
| Movie version | "Broly (DBS Movie)" | Form/karakter dengan `media_type = movie` | Sama seperti game |
| Karakter berbeda dengan nama sama | "Sakura (Naruto)" vs "Sakura (Cardcaptor)" | Dua karakter; slug diberi kualifikasi verse | Slug: `sakura-naruto`, `sakura-cardcaptor-sakura` (auto-disambiguasi) |
| Kemungkinan duplikat (skor 0,70–0,90) | — | **Tidak** digabung otomatis → antrian review manusia | `merge_candidates` + UI admin (side-by-side diff) |

### 21.2 Algoritma fingerprint

```
fp_key      = sha1(lower(unaccent(name_normalized)) + "|" + verse_slug + "|" + coalesce(era_bucket, "-"))
name_normalized = NFKC → lowercase → hapus tanda baca → collapse spasi → transliterate kanji/kana ke romaji (kamus kecil)
alias_score  = max over pairs similarity(trigram(alias_i), trigram(alias_j))      // pg_trgm
score        = 0.55·exact_fp_match + 0.30·alias_score + 0.15·(same verse ? 1 : 0)
score ≥ 0.90 → merge otomatis (form dipindahkan, alias digabung, redirect 301 dibuat)
0.70–0.90    → merge_candidates (review)
< 0.70       → entitas baru
```

**Aturan DR-1:** merge otomatis **tidak pernah** menghapus form/stat; semua dipindahkan ke karakter target dan dicatat di `audit_logs`.
**Aturan DR-2:** merge tidak pernah menggabungkan dua karakter dengan `verse_slug` berbeda tanpa persetujuan admin.
**Aturan DR-3:** setiap merge membuat redirect 301 dari slug lama agar URL lama tetap hidup.
**Aturan DR-4:** re-run job yang sama wajib menghasilkan `records_created = 0` pada run kedua (uji pada §35 AC-09).

---

## 22. Database Schema

**Engine:** PostgreSQL 15+ (Supabase). **Alasan:** FTS bawaan (`tsvector` + `pg_trgm` + `unaccent`) menghilangkan kebutuhan search engine terpisah pada skala 100k; transaksi & constraint kuat menjamin integritas data sumber; RLS menyediakan kontrol akses per-baris untuk admin/anon tanpa lapisan tambahan.

**Ringkasan tabel (DDL lengkap: [schema.sql](schema.sql))**

| # | Tabel | Peran | Kunci/relasi penting |
|---|---|---|---|
| 1 | `users` | Profil aplikasi, dipetakan ke `auth.users` | 1—n `favorites`, `audit_logs` |
| 2 | `user_roles` | Role admin/editor/curator | n—1 `users` |
| 3 | `verses` | Semesta fiksi | 1—n `characters` |
| 4 | `characters` | Identitas karakter | n—1 `verses`; 1—n `character_versions`, `character_aliases` |
| 5 | `character_aliases` | Alias multi-bahasa & script | n—1 `characters`; index trigram |
| 6 | `character_versions` | Form/era + stat cache | n—1 `characters`; 1—n `statistics`, `feats`, `character_abilities`, `character_resistances` |
| 7 | `tiers` | Ladder tier configurable | 1—n `character_versions.tier_id`; self-FK `parent_tier` |
| 8 | `stat_scale_metrics` | Definisi metrik | 1—n `stat_scales` |
| 9 | `stat_scales` | Skala ordinal ber-rank/log_value per metrik | n—1 `stat_scale_metrics` |
| 10 | `statistics` | Nilai stat per form per sumber | n—1 `character_versions`, `stat_scales`, `sources` |
| 11 | `ability_categories` | Taksonomi kemampuan | 1—n `abilities` |
| 12 | `abilities` | Katalog kemampuan ternormalisasi | n—1 `ability_categories`; 1—n `character_abilities` |
| 13 | `character_abilities` | Kepemilikan ability per form | n—1 `character_versions`, `abilities`, `sources` |
| 14 | `resistance_types` | Katalog tipe resistensi | 1—n `character_resistances` |
| 15 | `character_resistances` | Resistensi per form | n—1 `character_versions`, `resistance_types` |
| 16 | `hax_interactions` | Rule engine: ability ↔ resistance/counter ↔ efektivitas | n—1 `ability_categories`, `resistance_types` |
| 17 | `feats` | Bukti pencapaian | n—1 `character_versions`, `sources` |
| 18 | `equipment` | Peralatan per form | n—1 `character_versions` |
| 19 | `sources` | Registry sumber | 1—n `source_snapshots`, segala tabel ber-`source_id` |
| 20 | `source_snapshots` | Riwayat fetch (hash, parser version, excerpt) | n—1 `sources` |
| 21 | `character_source_conflicts` | Konflik nilai antar sumber | n—1 `characters`, `sources` |
| 22 | `ingestion_jobs` | Job queue & audit ingestion | n—1 `sources` |
| 23 | `ingestion_errors` | Error per job | n—1 `ingestion_jobs` |
| 24 | `ingestion_raw_pages` | Staging hasil parse (JSONB) — dapat di-reparse tanpa fetch ulang | n—1 `ingestion_jobs`, `sources` |
| 25 | `merge_candidates` | Kandidat duplikat untuk review | n—1 `characters` (dua kali) |
| 26 | `battle_rule_sets` | Versi bobot & konstanta engine | 1—n `battle_results` |
| 27 | `battle_conditions` | Kondisi pertarungan tersimpan | 1—n `battle_results` |
| 28 | `battle_results` | Hasil simulasi (deterministik, cached) | n—1 `character_versions` ×2, `battle_rule_sets` |
| 29 | `favorites` | Karakter/battle favorit (Phase 2) | n—1 `users` |
| 30 | `analytics_events` | Event anonim (tanpa PII) | n—1 `characters` (opsional) |
| 31 | `battle_popularity` | Agregat matchup populer (MV) | Turunan `battle_results` |
| 32 | `audit_logs` | Jejak perubahan admin | n—1 `users` |
| 33 | `data_reports` | Laporan data dari pengguna | n—1 `characters` |
| + | `battles` | Identitas matchup (dua form + satu set kondisi) | n—1 `character_versions` ×2, `battle_conditions`; unik pada triplet |
| + | `character_sources` | Atribusi sumber per karakter (identitas/stat/ability/feat/image) | n—1 `characters`, `sources` |
| + | `character_traits` | Perilaku karakter per form (dipakai mode `in_character`) | n—1 `character_versions` |
| + | `slug_redirects` | Redirect 301 setelah merge/rename | Berdiri sendiri |

**Catatan atas daftar di atas**

- `battle_popularity`, `verse_tier_distribution`, dan `character_search_mv` adalah **materialized view**, bukan tabel dasar — dihitung ulang terjadwal, bukan ditulis oleh aplikasi.
- Empat tabel tambahan (`battles`, `character_sources`, `character_traits`, `slug_redirects`) muncul saat perancangan rinci: `battles` memisahkan *identitas matchup* dari *hasil perhitungan* sehingga satu pasangan dapat punya banyak hasil untuk kondisi berbeda tanpa duplikasi baris besar.
- **Total: 37 tabel dasar + 3 materialized view.** Kebenaran jumlah ini diverifikasi otomatis oleh `scripts/validate-schema.mjs`.

**Index minimum (alasan)**

| Index | Tabel | Kolom | Alasan |
|---|---|---|---|
| `idx_characters_slug` | characters | `slug` (unique) | Routing |
| `idx_characters_name_trgm` | characters | `name gin_trgm_ops` | Fuzzy/typo |
| `idx_characters_search` | characters | `search_vector` (GIN) | Full-text |
| `idx_aliases_trgm` | character_aliases | `alias gin_trgm_ops` | Alias, kanji, romaji |
| `idx_versions_verse_tier` | character_versions | `(character_id, tier_id)` | Filter & sort tier |
| `idx_versions_stats` | character_versions | `(speed_scale_id)`, `(attack_potency_scale_id)`, `(range_scale_id)` | Filter stat |
| `idx_statistics_lookup` | statistics | `(character_version_id, metric, status)` | Engine & page load |
| `idx_char_abilities` | character_abilities | `(character_version_id)` + `(ability_id)` | Kedua arah query |
| `idx_char_resist` | character_resistances | `(character_version_id, resistance_type_id)` | Rule engine |
| `idx_hax_lookup` | hax_interactions | `(ability_category_id, resistance_type_id)` | Rule engine hot path |
| `idx_jobs_status_next` | ingestion_jobs | `(status, next_attempt_at)` partial `WHERE status IN ('pending','processing')` | Dispatcher queue |
| `idx_battle_hash` | battle_results | `input_hash` (unique) | Cache & determinisme |
| `idx_battle_pop` | battle_results | `(computed_at desc)` + MV `mv_battle_popularity` | Popular battles |
| `idx_jobs_dispatch` | ingestion_jobs | partial `(status, next_attempt_at)` | Klaim job tanpa memindai seluruh tabel |
| `idx_statistics_current` | statistics | partial uniq `(character_version_id, metric, source_id) WHERE status='current'` | Satu nilai aktif per sumber, riwayat tetap tersimpan |

**Kebijakan penyimpanan & retensi:** `ingestion_raw_pages.parsed_json` disimpan 90 hari; `source_snapshots.excerpt` ≤ 400 karakter; `analytics_events` disimpan 400 hari lalu diagregasi; `battle_results` disimpan permanen bila `share_count > 0` atau < 1 tahun, sisanya dipangkas.

---

## 23. ERD

ERD lengkap (Mermaid) beserta penjelasan setiap relationship: **[APPENDICES.md → Appendix B](APPENDICES.md#b-database-erd)**.

Ringkasan kardinalitas inti:

```
verses 1───n characters
characters 1───n character_versions        (wajib ≥ 1; tepat 1 is_default)
characters 1───n character_aliases
characters n───n sources                    (via character_sources)
character_versions 1───n statistics          (per metric per source)
character_versions n───1 tiers
statistics n───1 stat_scales
abilities n───1 ability_categories
character_versions n───n abilities           (via character_abilities, dengan evidence)
character_versions n───n resistance_types    (via character_resistances, dengan level)
hax_interactions n───1 ability_categories ; n───1 resistance_types
character_versions 1───n feats ; 1───n equipment
sources 1───n source_snapshots
ingestion_jobs 1───n ingestion_errors ; 1───n ingestion_raw_pages
battle_results n───1 battle_rule_sets ; n───2 character_versions ; n───1 battle_conditions
users 1───n favorites ; 1───n audit_logs ; 1───n user_roles
```

---

## 24. API Design

Prinsip: **server-side filtering wajib**, semua endpoint publik read-only, mutasi hanya via authenticated admin route, response tervalidasi zod, rate limit per IP + per token.

**Konvensi:** `GET /api/...` cacheable (`s-maxage` + `stale-while-revalidate`), error format seragam `{ error: { code, message, details? } }`, pagination `?page=&per_page=20|50|100|200` (cap 200), semua list mengembalikan `{ data, page, per_page, total, has_more }`.

| Method | Path | Auth | Fungsi | Cache | Rate limit |
|---|---|---|---|---|---|
| GET | `/api/characters` | anon | List + filter + sort + pagination | `s-maxage=300, swr=3600` | 120/min/IP |
| GET | `/api/characters/:slug` | anon | Detail karakter + form ringkas | `s-maxage=600, swr=86400` | 120/min/IP |
| GET | `/api/characters/:slug/versions` | anon | Daftar form + stat ringkas | `s-maxage=600` | 120/min/IP |
| GET | `/api/characters/:slug/versions/:formSlug` | anon | Detail form (stat + abilities + resistances + feats) | `s-maxage=600` | 120/min/IP |
| GET | `/api/verses` | anon | List verse + jumlah karakter | `s-maxage=3600` | 60/min/IP |
| GET | `/api/verses/:slug` | anon | Detail verse + distribusi tier + top karakter | `s-maxage=3600` | 60/min/IP |
| GET | `/api/abilities` | anon | Katalog ability/kategori | `s-maxage=86400` | 60/min/IP |
| GET | `/api/tiers` | anon | Ladder tier | `s-maxage=86400` | 60/min/IP |
| GET | `/api/search` | anon | Fuzzy/typo/alias search lintas bahasa | `s-maxage=60` | 60/min/IP, burst 10/10s |
| GET | `/api/search/suggest` | anon | Typeahead ringan (max 8 hasil) | `s-maxage=60` | 300/min/IP |
| POST | `/api/battle/simulate` | anon* | Jalankan simulasi (body: `BattleInput`) | no-store (POST); hasil di-cache via `input_hash` | 30/min/IP |
| GET | `/api/battle/:id` | anon | Ambil hasil battle tersimpan | `s-maxage=86400` | 120/min/IP |
| GET | `/api/battle/:id/card` | anon | OG image hasil (PNG) | `s-maxage=604800` | 60/min/IP |
| GET | `/api/compare` | anon | Perbandingan two-side tanpa simulasi | `s-maxage=600` | 120/min/IP |
| GET | `/api/sitemap-characters.xml` | anon | Sitemap terpecah (≤ 50k URL/file) | `s-maxage=86400` | 10/min/IP |
| POST | `/api/reports` | anon (rate-limited) | Laporan data pengguna | — | 5/jam/IP |
| **Admin** | | | | | |
| POST | `/api/admin/ingestion/run` | admin | Jalankan sync (`scope`: full/verse/character) | — | 12/jam/admin |
| POST | `/api/admin/ingestion/import` | admin | Import URL (allow-list) / upload dataset | — | 60/jam/admin |
| POST | `/api/admin/ingestion/jobs/:id/retry` | admin | Retry job | — | 120/jam |
| POST | `/api/admin/ingestion/jobs/:id/cancel` | admin | Batalkan job | — | 120/jam |
| GET | `/api/admin/ingestion/jobs` | admin | List job + filter status | no-store | 300/jam |
| GET | `/api/admin/ingestion/jobs/:id/errors` | admin | Detail error | no-store | 300/jam |
| POST | `/api/admin/characters/:id/reparse` | admin | Re-parse dari snapshot | — | 60/jam |
| POST | `/api/admin/characters/:id/merge` | admin | Merge ke karakter target + redirect | — | 30/jam |
| PATCH | `/api/admin/characters/:id` | admin | Edit karakter | — | 300/jam |
| PATCH | `/api/admin/versions/:id` | admin | Edit form & stat | — | 300/jam |
| POST | `/api/admin/tiers` | admin | Buat/ubah tier | — | 60/jam |
| POST | `/api/admin/abilities` | admin | Buat/ubah ability atau kategori | — | 120/jam |
| PUT | `/api/admin/hax-interactions/:id` | admin | Ubah aturan interaksi | — | 120/jam |
| PUT | `/api/admin/rule-sets/:version` | admin | Ubah bobot/konstanta engine (validasi Σw = 100) | — | 30/jam |
| POST | `/api/admin/sources/:id/disable` | admin | Nonaktifkan sumber (kill switch) | — | 30/hari |
| GET | `/api/admin/metrics` | admin | Statistik sistem | no-store | 300/jam |
| GET | `/api/admin/conflicts` | admin | Antrian konflik | no-store | 300/jam |
| POST | `/api/admin/conflicts/:id/resolve` | admin | Selesaikan konflik | — | 120/jam |

\* `POST /api/battle/simulate` terbuka untuk anonim agar pengguna baru bisa langsung mencoba; dilindungi rate limit + cache + tanpa write ke data fakta.

**Contoh `POST /api/battle/simulate`**

```jsonc
// request
{
  "side_a": { "character_version_id": "cv_goku_ui" },
  "side_b": { "character_version_id": "cv_naruto_baryon" },
  "conditions": {
    "mode": "standard", "knowledge_level": "partial", "prep_time": "none",
    "win_condition": "incapacitation", "speed_equalized": false,
    "starting_distance_scale_id": "dist_std_10m"
  },
  "rule_set_version": "1.0.0"
}
```
```jsonc
// response 200
{
  "battle_id": "btl_01H…", "input_hash": "sha256:…",
  "engine_version": "battle-engine@1.0.0", "rule_set_version": "1.0.0",
  "winner": "a", "win_probability": { "a": 0.72, "b": 0.28 }, "confidence": 0.81,
  "difficulty": "mid", "battle_length": "medium",
  "decisive_edges": [
    { "ability": "Speed advantage", "status": "effective", "delta_ranks": 2 },
    { "ability": "Existence Erasure", "status": "reduced",
      "blocked_by": "Resistance to Existence Erasure (moderate)",
      "effectiveness": 0.45 }
  ],
  "score_breakdown": [ { "metric": "speed", "a_i": 0.6, "weight": 12, "contribution": 7.2 } ],
  "primary_reason": "Speed advantage + higher attack potency + partial resistance to opponent's main hax",
  "secondary_factors": ["Higher durability by 2 bands", "Greater combat experience"],
  "critical_counter": "Character B's only realistic win condition is landing Existence Erasure before the speed gap closes.",
  "potential_scenario": "…",
  "limitations": ["combat_speed: unknown for side B"],
  "assumptions": ["Stamina assumed equal; no feat contradicts it."],
  "disclaimer": "Battle outcomes are calculated from available statistics, abilities, resistances, assumptions, and selected conditions.",
  "share_url": "/versus/goku-vs-naruto?conditions=std"
}
```

**Error contract**

| Code | HTTP | Penyebab | Aksi klien |
|---|---|---|---|
| `INVALID_INPUT` | 400 | Body/param gagal validasi | Tampilkan field yang salah |
| `MISSING_DATA` | 422 | Form kurang data wajib | Arahkan ke comparison + tunjukkan field kurang |
| `NOT_FOUND` | 404 | Slug/versi tidak ada | Halaman 404 dengan pencarian |
| `RATE_LIMITED` | 429 | Melebihi limit | Retry-After + pesan lembut |
| `UNAUTHORIZED` / `FORBIDDEN` | 401/403 | Bukan admin | Redirect login |
| `SOURCE_DISABLED` | 409 | Import dari sumber non-allowed | Pesan kebijakan sumber (IG-3) |
| `INTERNAL` | 500 | Bug | Halaman error + request id |

---

## 25. Admin Dashboard

### 25.1 Halaman `/admin`

**Kartu ringkasan (real-time view):** total karakter · total form · total verse · total ability · total sumber · last ingestion (timestamp + status) · failed jobs (24 jam) · pending jobs · karakter diupdate (7 hari) · konflik terbuka · kandidat duplikat · rasio kelengkapan data.

**Tools (semua dengan konfirmasi + audit log):**

| Tool | Aksi | Guard |
|---|---|---|
| Run Sync | Buat job `scheduled_full` / `incremental` | 1/5 menit/admin |
| Import URL | Validasi domain → allow-list → job | Tolak dengan `SOURCE_DISABLED` bila tidak diizinkan |
| Import Verse / Character | Scope terbatas | Preview jumlah halaman sebelum eksekusi |
| Re-import character | Fetch ulang + upsert | Menyimpan versi sebelumnya |
| Re-parse source | Parse ulang dari `ingestion_raw_pages` | Berguna saat parser naik versi |
| Disable source | `legal_status = disabled` | Konfirmasi + alasan wajib |
| Edit character / form / stats | Form editor dengan field sumber & confidence | Perubahan menulis `audit_logs` |
| Manage tier | CRUD ladder + reorder (menggeser `numerical_rank`) | Peringatan invalidasi cache |
| Manage abilities / resistances | CRUD katalog & relasi | — |
| Manage hax interactions | Editor matriks efektivitas | Simulasi dampak pada 20 battle sampel |
| Manage rule set | Bobot engine (Σ = 100) | Preview dampak + bump versi |
| View ingestion logs | Filter status/error_type/sumber/tanggal | Export CSV |
| Conflict queue | Diff side-by-side 2 sumber | 4 opsi resolusi (§7.1 US-24) |
| Merge candidates | Diff 2 karakter + preview form yang dipindahkan | Merge hanya via konfirmasi |

### 25.2 Role & kontrol akses

| Role | Boleh |
|---|---|
| `viewer` | Melihat dashboard & log |
| `curator` | + edit karakter/form/stat, resolve konflik, merge |
| `admin` | + kelola sumber, tier, ability, rule set, jalankan sync |
| `owner` | + kelola role user, konfigurasi global |

Semua write action mencatat `audit_logs`: `actor_id`, `action`, `entity_type`, `entity_id`, `before`, `after`, `ip_hash`, `created_at`.

### 25.3 UX operasional

- **Job detail** menampilkan timeline: queued → started → fetched → parsed → validated → upserted → indexed, dengan durasi per tahap dan `records_*` counters.
- **Error panel** mengelompokkan error by `error_type` + tautan langsung ke `source_url` + tombol "Re-parse" per halaman.
- **Dry-run** untuk setiap import (parse + validate tanpa upsert) → menampilkan diff (n create, n update, n conflict, n rejected) sebelum admin menekan Commit.
- **Kesehatan sumber** tabel: status allow-list, last fetch, error rate 7 hari, rata-rata record/run.

---

## 26. Search Architecture

### 26.1 Strategi MVP — PostgreSQL native

```sql
-- Kolom turunan (di-refresh trigger + nightly job)
search_vector tsvector :=
    setweight(to_tsvector('simple', unaccent(coalesce(name,''))), 'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(native_name,''))), 'A') ||
    setweight(to_tsvector('simple', coalesce(alias_agg,'')), 'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(verse_name,''))), 'B') ||
    setweight(to_tsvector('simple', unaccent(coalesce(classification,''))), 'C') ||
    setweight(to_tsvector('simple', coalesce(ability_agg,'')), 'D');
```

**Query hybrid (FTS + trigram) dengan ranking gabungan:**

```sql
SELECT c.id, c.slug, c.name,
       ts_rank_cd(c.search_vector, q) * 1.0          AS fts_rank,
       similarity(unaccent(c.name), unaccent($1))     AS trgm_rank
FROM characters c, websearch_to_tsquery('simple', unaccent($1)) q
WHERE c.search_vector @@ q
   OR unaccent(c.name) % unaccent($1)          -- pg_trgm similarity ≥ 0,3
   OR c.id IN (SELECT character_id FROM character_aliases
               WHERE unaccent(alias) % unaccent($1))
ORDER BY (0.6 * fts_rank + 0.4 * trgm_rank + popularity_boost) DESC
LIMIT $2;
```

| Aspek | Keputusan | Alasan |
|---|---|---|
| Mesin | Postgres FTS (`simple` config) + `pg_trgm` + `unaccent` | Nol infrastruktur tambahan; cukup untuk 100k baris; `simple` dipilih karena nama diri tidak butuh stemming bahasa |
| Fuzzy/typo | `pg_trgm` GIN + threshold 0,3 | "gokou"→"goku" tanpa library tambahan |
| Lintas bahasa | `unaccent` + indeks alias per script + transliterasi kanji/kana→romaji saat ingest | "孫悟空", "Kakarot", "goku" → satu entri |
| Ranking | 0,6·FTS + 0,4·trigram + boost popularitas + exact-prefix bonus | Hasil relevan di atas hasil populer yang tidak relevan |
| Prefix/typeahead | `prefix tsquery` (`goku:*`) + LIMIT 8, index-only bila mungkin | Latensi < 60 ms p95 |
| Skalabilitas | Tambah materialized view `character_search_mv` dengan kolom gabungan bila > 100k | Menghindari join saat skalabilitas |
| Upgrade path | Interface `SearchProvider` (Postgres → Meilisearch/Typesense) tanpa mengubah API | Tidak mengunci arsitektur |
| Guard | Query pengguna **tidak pernah** disusun sebagai string SQL; hanya lewat parameter + `websearch_to_tsquery` | Anti-injeksi + tidak ada kontrol query mentah |

**Hot query & mitigasi:** autocomplete → KV cache 60 s per prefix; karakter populer → ISR; filter berat → MV + index komposit.

**Target kinerja:** p95 < 200 ms @10k, < 400 ms @100k; typeahead p95 < 60 ms; nol full table scan (diverifikasi `EXPLAIN ANALYZE` di CI untuk 6 query kritis).

---

## 27. SEO

| Elemen | Implementasi | Contoh |
|---|---|---|
| Title unik | Template per tipe halaman | `"Goku (Ultra Instinct) — Stats, Abilities & Tier \| Anime VS Battle"` |
| Meta description | Deskripsi ≤ 155 karakter mengandung tier & verse | `"Goku Ultra Instinct: Tier 2-A, Immeasurable speed, 42 abilities. Compare stats and simulate battles vs any character."` |
| Canonical | Self-canonical per halaman; form non-default `?form=` → canonical ke form default kecuali punya halaman sendiri | `<link rel="canonical" href="https://…/character/goku">` |
| Open Graph | `og:title`, `og:description`, `og:image` (dinamis per karakter; per battle untuk hasil) | OG image 1200×630, di-cache 7 hari |
| Twitter/X card | `summary_large_image` + `twitter:creator` | — |
| JSON-LD | `Person`/`CreativeWork`-like untuk karakter (dengan `additionalProperty` untuk stat), `BreadcrumbList`, `WebSite` + `SearchAction`, `FAQPage` untuk pertanyaan lazim | Lihat contoh di bawah |
| Sitemap | Terpecah otomatis (≤ 50.000 URL/file), `sitemap-index.xml`; sub: karakter, verse, versus, form; `lastmod` dari `updated_at` | — |
| Robots | Index karakter/verse/versus; `noindex` untuk form tipis, `/admin/*`, halaman hasil filter bernilai rendah | — |
| Breadcrumb | Verse → Karakter → Form dengan schema | — |
| Internal linking | Setiap karakter menaut verse, karakter lain di verse yang sama, battle populer yang memuatnya | Meningkatkan crawl depth |
| Rendering | SSR/ISR untuk karakter & verse; konten kritis ada di HTML awal (tanpa JS) | Aman untuk crawler |
| Konten tipis | Karakter dengan < 3 field terisi → `noindex` + ditandai `data_completeness = partial` | Menghindari penalti thin content |
| Permalink deterministik | `/versus/goku-vs-naruto` (dengan slug kanonik), redirect 301 dari variasi | Konsolidasi sinyal |
| Duplikasi alias | Halaman alias → 301 ke karakter kanonik | — |

**Contoh JSON-LD (karakter):**

```jsonc
{
  "@context": "https://schema.org",
  "@type": "Character",   // fallback "Thing" bila crawler tidak mengenali
  "name": "Goku",
  "alternateName": ["Kakarot", "孫悟空"],
  "description": "…",
  "image": "https://cdn…/goku.webp",
  "url": "https://animevsbattle.example/character/goku",
  "isPartOf": { "@type": "CreativeWorkSeries", "name": "Dragon Ball" },
  "additionalProperty": [
    { "@type": "PropertyValue", "name": "Tier", "value": "2-A" },
    { "@type": "PropertyValue", "name": "Attack Potency", "value": "Multi-Galaxy level" },
    { "@type": "PropertyValue", "name": "Speed", "value": "Massively FTL+" }
  ],
  "citation": "https://…/source-url"
}
```

**Peringatan legal SEO:** situs tidak mengklaim kepemilikan karakter/gambar; setiap halaman menampilkan atribusi sumber data dan pernyataan non-afiliasi. Untuk konten yang diminta turun, halaman di-410/redirect sesuai §30.

---

## 28. Security

| Area | Kontrol | Detail |
|---|---|---|
| Autentikasi | Supabase Auth (email magic link + OAuth) | Admin wajib MFA |
| Otorisasi | `user_roles` + RLS per tabel | Anon: SELECT pada data publik; mutasi hanya role admin/curator |
| Rate limiting | Per IP (Upstash/KV) + per token; tier berbeda untuk anonim vs admin | Endpoint simulasi 30/min/IP; search 60/min/IP; import 60/jam/admin |
| Bot mitigation | Turnstile/hCaptcha pada `POST /api/battle/simulate` (anonim) dan `/api/reports` saat skor risiko tinggi | Hanya trigger bila anomali, bukan semua request |
| Input validation | zod di boundary API + server action; whitelist enum; reject unknown keys | Tidak ada parsing longgar |
| SQL injection | Parameterized query/supabase-js; **tidak ada** string SQL dari input; `search_path` dipatok | Anti-injeksi |
| XSS | Escaping default React; `dangerouslySetInnerHTML` dilarang kecuali untuk konten tersanitasi dari parser (disanitasi DOMPurify allow-list terbatas); CSP ketat | `script-src 'self' 'nonce-…'` |
| CSRF | SameSite=Lax + double-submit token untuk mutasi berbasis cookie | Server action & route handler divalidasi origin |
| SSRF | Fetcher ingestion hanya ke domain allow-list sumber; resolve DNS + blokir IP privat/loopback/link-local; tolak redirect ke host di luar allow-list | Sangat penting karena sistem melakukan fetch URL |
| Header | HSTS, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` minimal | — |
| Secrets | Env terenkripsi; service-role key hanya di server/worker; tidak pernah ke klien | Rotasi berkala |
| Abuse & scraping balik | Cap pagination 200, tidak ada endpoint bulk dump, `X-Robots-Tag` pada API, deteksi pola burst | Melindungi data & biaya |
| Upload | Import dataset hanya CSV/JSON ≤ 20 MB, tipe MIME diverifikasi, konten tidak dieksekusi | Anti-RCE |
| Gambar dari luar | Proxy/optimasi, tanpa mengeksekusi SVG mentah (SVG di-sanitize atau dilarang) | Anti-XSS via media |
| Logging & privasi | Tanpa PII dalam event analytics; IP di-hash untuk rate limit | — |
| Audit | Semua aksi admin → `audit_logs`; retensi 24 bulan | Forensik |
| Compliance | Prosedur takedown, halaman terms & DMCA (§30) | — |

**Threat model ringkas (STRIDE):** Spoofing → MFA admin; Tampering → RLS + audit; Repudiation → audit log append-only; Information disclosure → tidak ada data privat selain tiket laporan; DoS → rate limit + cache + ISR; Elevation → RLS + pemisahan service role.

---

## 29. Performance

### 29.1 Target

| Metrik | Target | Pengukuran |
|---|---|---|
| Lighthouse Performance (mobile, 4G) | ≥ 90 | Lighthouse CI per PR |
| LCP karakter page | < 2,5 s | RUM + CI |
| INP | < 200 ms | RUM |
| CLS | < 0,1 | RUM |
| TTFB (ISR hit) | < 200 ms | APM |
| API p95 `GET /api/characters` | < 250 ms | APM |
| API p95 search | < 200 ms @10k | APM + benchmark sintetis |
| Simulasi p95 | < 300 ms (engine), < 1,5 s (+narrator) | APM |
| Ukuran JS klien per halaman data | < 120 KB gzip | Bundle analyzer |
| Query karakter page | ≤ 6 query, ≤ 60 ms total | `EXPLAIN ANALYZE` di CI |

### 29.2 Strategi

| Lapis | Teknik | Alasan |
|---|---|---|
| Rendering | RSC default; client component hanya untuk interaktif (form pemilihan, chart) | Minimal JS (non-goal "SPA berat") |
| Caching halaman | ISR: karakter 10 menit, verse 1 jam, sitemap 24 jam; on-demand revalidate saat data berubah | Konten jarang berubah |
| Caching API | `s-maxage` + `stale-while-revalidate`; battle result cache `input_hash` (TTL 7 hari) | Menghindari hitung ulang |
| Cache stat/detail | KV per `character_version_id` dengan invalidasi saat ingest | Latensi rendah |
| Data fetching | Satu query agregat per blok (stat+abilities+resistances) via RPC/`select` bertingkat; hindari N+1 | N+1 adalah penyebab utama lambatnya halaman wiki |
| Database | Index komposit & partial; MV `tier_distribution`, `battle_popularity`, `character_search_mv`; `ANALYZE` terjadwal | Menjaga planner akurat |
| Denormalisasi | Kolom stat di `character_versions` untuk list/filter | Hilangkan join di hot path |
| Gambar | `next/image` AVIF/WebP, `sizes` tepat, `priority` hanya LCP, blur placeholder, CDN | Bandwidth turun 40–70% |
| Font | `next/font` self-host, subset, `display: swap` | Hilangkan render-blocking |
| Pemuatan daftar | Pagination server-side 20/50/100/200 + `loading.tsx` skeleton; lazy load blok bawah | Tidak mengirim ribuan baris |
| Bundle | Server-only import, dynamic import untuk chart/editor admin, no barrel-file bloat | JS minimal |
| Long task | Simulasi berat dipindah ke server action; tidak pernah di klien | HP rendah tetap lancar |
| Monitoring | Vercel Analytics + Sentry + Postgres slow query log; alert p95 > target 15 menit | Deteksi regresi |

### 29.3 Beban data per halaman (anggaran)

| Halaman | Payload data | HTML | JS |
|---|---|---|---|
| Homepage | ≤ 40 entri ringkas | < 60 KB | < 90 KB |
| Karakter | ≤ 1 karakter + ≤ 30 form ringkas + 1 form detail | < 120 KB | < 110 KB |
| Daftar | 20–200 entri ringkas (≤ 200 B/entri) | < 150 KB | < 100 KB |
| Hasil battle | 1 battle result penuh | < 80 KB | < 80 KB |

---

## 30. Copyright / Attribution

### 30.1 Pemisahan tegas tiga jenis aset

| Jenis | Contoh | Kepemilikan | Perlakuan |
|---|---|---|---|
| A. Karakter & karya | Nama, deskripsi dasar, semesta | Pemegang hak masing-masing | Ditampilkan sebagai referensi/fakta, tanpa klaim kepemilikan |
| B. Artwork/gambar | Ilustrasi karakter | Pemegang hak / artis / pengunggah asli | **Selalu** punya `image_source`, `image_license`, `image_attribution`; ditampilkan dengan kredit + tautan |
| C. Data terstruktur hasil normalisasi | Tier, stat, form, katalog ability | Dikompilasi dari sumber eksternal | Wajib atribusi sumber per record |

**Aturan LP-1:** Database tidak pernah menyimpan `image_url` tanpa ketiga field lisensi. Validator menolak; UI menampilkan placeholder "Image not available".
**Aturan LP-2:** Data (A/C) dan artwork (B) disimpan di tabel/kolom terpisah dengan siklus hidup terpisah — menghapus gambar tidak boleh menghapus data karakter.
**Aturan LP-3:** Tidak ada klaim kepemilikan atas karakter, judul, atau semesta. Setiap halaman memuat pernyataan non-afiliasi.
**Aturan LP-4:** Kutipan teks dari sumber dibatasi ≤ 400 karakter (excerpt untuk bukti), bukan reproduksi substansial.
**Aturan LP-5:** Tidak ada konten yang menyamarkan asal (mirror penuh halaman sumber dilarang).

### 30.2 Atribusi wajib di UI

Blok "Sources" pada setiap halaman karakter/form menampilkan per record:
`source_name` · tautan `source_url` (`rel="nofollow noopener"`) · `fetched_at` · `parser_version` · `verification_status`.

Footer global: *"Anime VS Battle adalah proyek independen. Nama karakter, judul, dan gambar adalah milik pemegang hak masing-masing dan digunakan untuk keperluan referensi/informasi. Data diambil dari sumber publik yang tercantum di setiap halaman. Kami tidak berafiliasi dengan pemegang hak mana pun."*

### 30.3 Proses takedown

| Langkah | SLA | Aksi |
|---|---|---|
1 | ≤ 24 jam | Terima laporan via `/legal/takedown`, buat tiket dengan bukti kepemilikan |
2 | ≤ 3 hari kerja | Verifikasi; bila valid → tandai `image_license = disputed`, sembunyikan aset (fallback placeholder) |
3 | ≤ 5 hari kerja | Bila mencakup data: `legal_status = disabled` pada sumber + job `skipped` + hapus excerpt terkait |
4 | ≤ 7 hari kerja | Konfirmasi tertulis ke pelapor + catat di changelog legal |
5 | Berkelanjutan | Tambahkan host/domain ke deny-list agar tidak diimpor kembali |

### 30.4 Ketentuan penggunaan (ringkas, `/terms`)

Dilarang: scraping masif terhadap situs ini, penggunaan komersial atas dump database, klaim hasil simulasi sebagai fakta resmi, mengunggah konten melanggar hak, atau menggunakan data untuk melatih model tanpa izin tertulis.

### 30.5 Perizinan data

| Kelas | Lisensi khas | Perlakuan |
|---|---|---|
| Dataset berlisensi terbuka (mis. CC BY-SA) | Sesuai lisensi | Simpan `license`, atribusi sesuai syarat, catat share-alike bila ada |
| API resmi | Sesuai ToS API | Simpan `license` dan batasan penggunaan |
| Wiki/data komunitas | Sesuai lisensi halaman (mis. CC BY-SA) | Atribusi + tautan ke revisi halaman asal (`fetched_at`) |
| Impor manual oleh admin | Tanggung jawab pengimpor | Disimpan dengan `source_type = manual_url` + catatan review |

**Aturan LP-6:** Field `license` dan `license_url` wajib pada tabel `sources`; job ingestion menolak sumber tanpa metadata lisensi.
**Aturan LP-7:** Model AI (Phase 3) tidak dilatih dengan data sumber; narrator hanya membaca hasil kalkulasi (§34).

---

## 31. Analytics

### 31.1 Prinsip privasi

Tanpa PII, tanpa cookie pihak ketiga untuk tracking, tanpa fingerprinting. Analytics internal (self-hosted event store di Postgres) + Vercel Analytics untuk Web Vitals. IP di-hash (SHA-256 + salt rotasi harian) hanya untuk rate limiting, bukan untuk profiling.

### 31.2 Event taxonomy

| Event | Properti | Tujuan |
|---|---|---|
| `page_view` | `path`, `referrer_host`, `device_class` | Trafik & funnel |
| `search_performed` | `query_hash`, `result_count`, `latency_ms`, `had_typo_match` | Kualitas search & query populer (hash, bukan teks penuh) |
| `character_viewed` | `character_id`, `verse_id`, `form_id` | Popularitas karakter/form |
| `form_selected` | `character_id`, `form_id`, `is_default` | KPI K6 (form non-default) |
| `comparison_viewed` | `a_id`, `b_id`, `mode` | Permintaan perbandingan |
| `battle_simulated` | `a_id`, `af_id`, `b_id`, `bf_id`, `conditions_hash`, `winner`, `probability`, `confidence`, `latency_ms`, `cached` | Popular battles, kalibrasi, performa |
| `battle_shared` | `battle_id`, `method` (`link`/`image`/`native`) | Dampak viral |
| `ingestion_run` | `job_id`, `source_id`, `counts`, `duration_ms`, `status` | Operasional |
| `data_reported` | `character_id`, `reason_category` | Kualitas data |
| `narrator_generated` | `battle_id`, `latency_ms`, `citation_coverage`, `fact_check_passed` | Kualitas AI (Phase 3) |

### 31.3 Metrik produk (dashboard internal)

| Kategori | Metrik |
|---|---|
| Akuisisi | sesi, pengguna baru, sumber trafik (organik vs sosial vs langsung) |
| Aktivasi | % sesi dengan ≥ 1 simulasi (target ≥ 60%) |
| Keterlibatan | simulasi/sesi, kedalaman halaman, form non-default (≥ 35%) |
| Retensi | pengguna 7/30 hari, repeat battle rate |
| Konten | karakter dilihat unik, matchup unik, share rate (≥ 5% simulasi) |
| Kualitas data | % record bersumber, konflik terbuka, rata-rata `confidence` per verse |
| Kalibrasi | distribusi `confidence` vs tingkat penyelesaian data; korelasi probabilitas dengan matchup berulang |
| Performa | Web Vitals, error rate, p95 API |
| Operasional | job sukses/gagal, data freshness (umur `updated_at` median) |
| SEO | halaman terindeks, klik organik, CTR per tipe halaman |

### 31.4 Popular battles

`battle_popularity` (MV) = agregat `battle_results` 30 hari terakhir dengan pembersihan (≥ 5 simulasi unik per matchup agar tidak bisa di-brigade oleh satu orang). Homepage dan halaman karakter memakai data ini — bukan daftar hardcode. Alasan: daftar hardcode cepat basi dan tidak mencerminkan minat nyata.

---

## 32. MVP

### 32.1 Scope MVP (13 item wajib)

| # | Item | Termasuk | Tidak termasuk |
|---|---|---|---|
| M1 | Character database | CRUD admin, halaman publik, ≥ 10k karakter | Editor pengguna |
| M2 | Search | FTS + trigram + alias + lintas bahasa | Semantic/vector search |
| M3 | Character page | Semua blok §10/§27 | Komentar, rating |
| M4 | Character forms | Multi-form, tab, URL per form | Form buatan pengguna |
| M5 | Tier system | Tabel configurable + qualifier | Kalibrasi komunitas |
| M6 | Basic statistics | 16 metrik §13 | Simulasi fenomena fisika terperinci |
| M7 | Abilities | Katalog + relasi + evidence | Marketplace ability |
| M8 | Resistances | Katalog + level + evidence | — |
| M9 | Ingestion architecture | Job queue, adapter, staging, retry, resumable, admin import | Scraping agresif multi-sumber |
| M10 | VS comparison | Tabel + indicator | Chart lanjutan |
| M11 | Basic battle simulator | Layered engine + rule engine + hasil §16.5 | Turn-based, timeline |
| M12 | Admin dashboard | Semua tool §25 | Manajemen komunitas |
| M13 | SEO + responsif | Semua §27 + mobile-first | i18n penuh |

### 32.2 Batas MVP yang disengaja

- **Bahasa UI:** Bahasa Indonesia + Inggris (toggle), bukan 10 bahasa.
- **Data:** 10.000 karakter berasal dari impor terkelola + adapter allow-list; bukan hasil crawl agresif seluruh internet.
- **Battle:** satu lawan satu, deterministik, tanpa RNG.
- **Narasi:** template deterministik (bukan AI). AI narrator ada di Phase 3 dan opsional.
- **Akun pengguna:** hanya untuk admin; pengguna publik tanpa login di MVP (kecuali favorit di Phase 2).

### 32.3 Definition of Done (MVP)

1. Semua AC di §35 lulus, diverifikasi dengan bukti (test, query, screenshot, atau Lighthouse report).
2. CI hijau: lint, typecheck, unit test engine (≥ 80% branch pada `services/battle/*`), integrasi DB, Lighthouse CI.
3. Tidak ada data masuk tanpa `source_id` (uji: `SELECT count(*) FROM characters c LEFT JOIN character_sources … WHERE NULL > 0` = 0).
4. Re-run ingestion 3× menghasilkan 0 duplikat.
5. Semua halaman publik punya title/description/canonical/OG valid (uji otomatis di CI).
6. Dokumentasi operasional: runbook ingestion, prosedur conflict review, prosedur takedown.
7. Disclaimer tampil di karakter, versus, dan hasil battle.

---

## 33. Phase 2

| Fitur | Deskripsi | Prasyarat | Alasan prioritas |
|---|---|---|---|
| Akun pengguna | Auth publik, profil, preferensi form | Auth sudah ada untuk admin | Dasar untuk semua fitur sosial |
| Favorites | Simpan karakter & matchup | Akun | Menciptakan alasan kembali |
| Battle history | Recent & saved battles | Akun | Menghubungkan user dengan hasil sebelumnya |
| Comments | Diskusi per karakter/battle | Moderasi + rate limit | Meningkatkan retensi & konten |
| Voting | Vote hasil matchup (bukan mengubah engine) | Akun | Sinyal komunitas, dapat dibandingkan dengan engine → data kalibrasi |
| Community ranking | Peringkat kontribusi editor | Akun + audit | Menarik kontributor data |
| Team battle | 2v2, 3v3 dengan agregasi form | Engine diperluas | Permintaan komunitas tinggi |
| Tournament | Bracket otomatis dari daftar karakter | Team battle | Konten viral |
| Public API (terautentikasi, terbatas) | Read-only dengan kuota | Rate limit + API key | Ekosistem (bot, situs pihak ketiga) |
| Multi-bahasa UI | i18n (ID/EN/JP) | Struktur konten siap | Jangkauan pasar |
| Query populer (cache) | Simpan & tampilkan query trending | Analytics | SEO + UX |
| Prediksi kalibrasi | Bandingkan vote komunitas & engine, tampilkan selisih | Voting | Transparansi & perbaikan bobot |

**Aturan Phase 2 keamanan:** voting & komentar tidak boleh memengaruhi `battle_results` (imutabilitas hasil engine). Perbedaan pendapat disimpan sebagai tabel terpisah dan ditampilkan sebagai "community view" dengan label jelas.

---

## 34. Phase 3

| Fitur | Deskripsi | Kendala utama | Mitigasi |
|---|---|---|---|
| AI Battle Narrator | Narasi setelah kalkulasi selesai | Halusinasi statistik | **Hard grounding**: prompt hanya berisi `BattleResult` + fakta terkait; validator `fact_containment` menyaring kalimat yang memuat angka/ability di luar payload; label "AI-generated battle scenario"; cache per `input_hash` |
| Detailed fight simulation | Fase pertarungan (opening, mid, akhir) dengan kondisi berubah | Kompleksitas aturan | Simulasi berbasis state machine dari `battle_rule_sets`; tetap deterministik |
| Turn-based simulation | Simulasi langkah demi langkah | RNG & eksploitasi | Seeded PRNG (`input_hash` sebagai seed) → hasil tetap reproducible; label "simulated timeline" |
| Interactive battle timeline | Scrub timeline kejadian | Data & performa | Prerender timeline ke JSON; UI ringan |
| Custom character | Pengguna membuat karakter/form sendiri | Spam & kualitas | Dipisah namespace `origin = community`; tidak masuk search default; moderation queue |
| User-created abilities | Ability buatan pengguna | Duplikasi & kebingungan | Wajib dipetakan ke kategori katalog atau ditandai `unmapped` |
| Community feats | Kontribusi feat + bukti | Verifikasi | Workflow review: submitted → under_review → verified/rejected |
| Debate mode | Dua posisi argumen dengan bukti dari DB | Moderasi | Setiap klaim wajib menyertakan `source_id`; tanpa sumber → ditolak |

**Batas etis AI (dipertegas):** AI tidak boleh menghasilkan statistik, ability, resistance, atau feat baru; hanya menyusun narasi dari hasil kalkulasi dan data yang sudah ada di database. Semua keluaran AI disimpan di tabel terpisah (`battle_narratives`) dan ditandai sebagai non-faktual.

---

## 35. Acceptance Criteria

Semua AC diverifikasi dengan bukti konkret (test otomatis, query SQL, laporan Lighthouse, atau screenshot). AC yang tidak lulus dilaporkan sebagai *belum lulus*, bukan dianggap lulus.

### 35.1 Fungsional

| AC | Kriteria | Cara verifikasi |
|---|---|---|
| AC-01 | User dapat menemukan karakter melalui search | Ketik "goku" → hasil teratas Goku; ketik "gokou" (typo) → Goku tetap ditemukan; ketik "Kakarot" & "孫悟空" → karakter yang sama |
| AC-02 | User dapat memilih form karakter | Form selector menampilkan semua form dengan tier; memilih form mengubah seluruh blok stat; URL menangkap `?form=` dan dapat dibuka ulang |
| AC-03 | User dapat membandingkan dua karakter | `/compare` menampilkan tabel semua metrik §13.1 dengan indikator Advantage A / Advantage B / Equal / Unknown |
| AC-04 | User dapat melihat perbedaan statistik | Setiap baris menampilkan nilai A, nilai B, sumber, dan arah keunggulan; tidak ada baris kosong tanpa penjelasan |
| AC-05 | User dapat menjalankan simulasi pertarungan | `POST /api/battle/simulate` mengembalikan skema §16.5 lengkap dalam < 300 ms p95 |
| AC-06 | Engine mempertimbangkan abilities & resistances | Untuk kasus uji Time Stop vs Resistance-to-Time: hasil memuat decisive edge dengan status `reduced`/`blocked`; menghapus resistance tersebut mengubah hasil (uji differential) |
| AC-07 | Database menangani ≥ 10.000 record | Benchmark: seed 10k karakter/30k form; p95 `GET /api/characters` < 250 ms; search p95 < 200 ms |
| AC-08 | Ingestion dapat dijalankan ulang tanpa duplikat | Jalankan job yang sama 3×: run ke-2 dan ke-3 → `records_created = 0`, jumlah karakter/form tidak berubah |
| AC-09 | Setiap record imported punya source URL | `SELECT count(*) FROM characters c WHERE c.source_url IS NULL` = 0; idem untuk form, stat, ability, resistance, feat |
| AC-10 | Admin dapat melihat failed ingestion jobs | `/admin` menampilkan jumlah failed; halaman detail memuat `error_type`, HTTP status, retry count, pesan, tautan sumber |
| AC-11 | Character page dapat diindeks search engine | HTML awal memuat nama, tier, dan deskripsi tanpa JS; title/description/canonical/OG/JSON-LD valid; tampil di `sitemap-characters.xml` |
| AC-12 | Halaman karakter lengkap | Semua blok §10 ada atau menampilkan status "not documented" (tidak ada blok hilang secara senyap) |
| AC-13 | Battle result menyertakan disclaimer & label simulasi | Disclaimer verbatim §18.4 tampil di semua halaman hasil |
| AC-14 | Permalink battle deterministik | Membuka `/versus/goku-vs-naruto` menghasilkan `input_hash` & winner yang sama dengan simulasi asal |
| AC-15 | Konflik sumber tidak menimpa data | Dua sumber dengan nilai berbeda pada metrik sama → 1 baris `character_source_conflicts` (status `open`), nilai lama utuh |
| AC-16 | Duplicate detection membedakan karakter & form | "Naruto"/"Naruto Uzumaki" → 1 karakter 2 alias; "Naruto (Part I)"/"Naruto (Six Paths)" → 1 karakter 2 form; "Sakura (Naruto)"/"Sakura (CCS)" → 2 karakter |
| AC-17 | Admin dapat re-parse tanpa kehilangan data | Setelah reparse, versi stat sebelumnya tetap tersimpan (`status = superseded`) dan dapat ditampilkan |
| AC-18 | Query SQL tidak dapat dikendalikan user | Semua input lewat parameter; uji injeksi (`' OR 1=1--`) pada semua endpoint publik tidak mengubah hasil & tidak error 500 |
| AC-19 | Sumber non-allowed tidak dapat diimpor | Import URL dari domain di luar allow-list → 409 `SOURCE_DISABLED` + pesan kebijakan |
| AC-20 | Artwork tanpa lisensi tidak ditayangkan | Insert record dengan `image_url` tanpa `image_license` → validator menolak / UI menampilkan placeholder |

### 35.2 Non-fungsional

| AC | Kriteria | Cara verifikasi |
|---|---|---|
| AC-21 | Lighthouse Performance ≥ 90 (mobile) | Lighthouse CI pada 4 template halaman; hasil diarsipkan per PR |
| AC-22 | Lighthouse SEO & Accessibility ≥ 95 | Lighthouse CI |
| AC-23 | JS klien < 120 KB gzip per halaman data | Bundle analyzer di CI |
| AC-24 | Tidak ada full table scan pada query kritis | `EXPLAIN ANALYZE` untuk 6 query inti menunjukkan index scan |
| AC-25 | Ingestion tidak pernah berjalan di jalur request user | Kode path request tidak mengimpor modul `services/ingestion/*` (uji lint arsitektur) |
| AC-26 | Rate limit berfungsi | 31 request simulasi berturut-turut dari IP sama → request ke-31 mendapat 429 |
| AC-27 | SSRF tertutup | Import URL `http://169.254.169.254/…` dan `http://localhost/…` → ditolak |
| AC-28 | Determinisme engine | Jalankan 500 pasangan acak 2×: 100% `input_hash` & hasil identik |
| AC-29 | Hasil dengan data kurang jujur | Form tanpa durability → `insufficient_data` atau flag `low_confidence` + `limitations[]` terisi; tidak ada tebakan diam-diam |
| AC-30 | Dokumentasi operasional tersedia | Runbook ingestion, conflict review, takedown, dan rollback tersimpan di repo |

### 35.3 Kriteria kualitas simulasi

| AC | Kriteria | Cara verifikasi & status |
|---|---|---|
| AC-31 | Case library sebagai data | ≥ 30 kasus uji bertanda tangan (input → ekspektasi rentang hasil) di `src/services/battle/cases/*.json`, mencakup: dominasi tier ekstrem, speed blitz, mutual hax, **resistensi memblokir hax**, **data tidak lengkap**, `varies`, qualifier `possibly`. **LULUS — 39 kasus / 6 berkas** (`dominance`=6, `speed`=6, `hax`=9, `incomplete`=5, `qualifiers`=6, `conditions`=7) |
| AC-32 | Tidak ada hasil mustahil | 0 kasus di mana pihak dengan selisih ≥ 8 rank tier (dan ≥ 6 durability) menang tanpa decisive edge. Invarian diperiksa pada **seluruh** 39 kasus, bukan sampel. **LULUS — 0 pelanggaran** |
| AC-33 | Sensitivitas kondisi | Mengubah `mode` ke `bloodlusted` atau `speed_equalized` mengubah hasil. **LULUS, lebih ketat dari target** — runner menuntut **100%** pasangan kondisi-different menghasilkan hasil berbeda (bukan ≥ 70%): 8 pasangan diperiksa, 1 dikecualikan karena kedua hasil `insufficient_data` (perbedaan kondisi tidak mungkin terlihat saat engine berhenti di gerbang kelayakan) |
| AC-34 | Traceability reasoning | 100% `primary_reason`/`secondary_factors`/`critical_counter`/`potential_scenario` dapat dipetakan ke elemen `score_breakdown`, `decisive_edges`, atau `condition:*`. **LULUS — RG-1 39/39**. Teks bebas tanpa rujukan akan menggagalkan runner, sehingga AI narrator (§34) tidak dapat menyuntik klaim tak bersumber ke jalur deterministik |
| AC-35 | Determinisme case library | Runner yang sama dijalankan dua kali menghasilkan 425/425 identik; `input_hash` dan `battle_id` stabil (diturunkan dari bentuk kanonik input, bukan waktu/acak). **LULUS** |
| AC-36 | Case library tidak dapat "dilonggarkan" | Setiap kasus menyatakan ekspektasinya (`winner`, `probability_a/b`, `difficulty`, `edge_status`, `coverage`, …); runner **menolak** kasus tanpa `expect`, id duplikat, `side_a === side_b`, rujukan sisi yang tidak ada di `roster.json`, dan kategori wajib yang hilang. Guard ini sendiri diuji dengan mutasi ([scripts/mutate-battle-guards.mjs](../scripts/mutate-battle-guards.mjs)): **6/6 mutasi tertangkap, dan tiap penolakan harus menyebut alasan yang tepat** — bukan sekadar "ada yang gagal". **LULUS** |

---

## 36. Technical Risks

Skala: Dampak (1–5) × Kemungkinan (1–5) = severity.

| # | Risiko | D | K | Sev | Mitigasi | Pemilik | Trigger mitigasi |
|---|---|---|---|---|---|---|---|
| R1 | **Sumber utama (vsbattles) membatasi akses otomatis / ToS melarang scraping** | 5 | 5 | 25 | Arsitektur adapter; MVP bergantung pada impor terkelola + dataset berlisensi; adapter bersumber dibatasi nonaktif secara default; sumber alternatif berlisensi untuk metadata | Product + Legal | Saat daftar adapter |
| R2 | **Kualitas data rendah/inkonsisten di sumber** | 5 | 5 | 25 | Validasi V1–V9; `confidence`; status verifikasi; conflict record; review manusia; fail-closed untuk fakta | Data lead | Setiap ingestion run |
| R3 | **Halusinasi AI narrator** | 4 | 4 | 16 | Hard grounding + validator fact-containment + label + hanya Phase 3 + degradasi bertingkat | Eng | Sebelum rilis narrator |
| R4 | **Battle engine dianggap "otoritatif" oleh pengguna** | 4 | 5 | 20 | Disclaimer wajib; tampilkan confidence & limitations; bahasa probabilistik; halaman metodologi publik | Product | Rilis MVP |
| R5 | **Risiko hukum hak cipta gambar/teks** | 5 | 4 | 20 | Pisahkan data & artwork; field lisensi wajib; excerpt ≤ 400 karakter; proses takedown ≤ 7 hari; opsi tampilkan placeholder | Legal | Rilis MVP + audit triwulan |
| R6 | **Biaya database/search membengkak saat skala** | 3 | 3 | 9 | Denormalisasi + index; MV; cache agresif; batas pagination; upgrade path search provider; alert biaya | Eng | > 100k karakter |
| R7 | **Query lambat karena N+1 / join berlebih** | 4 | 4 | 16 | Satu query agregat per blok; uji `EXPLAIN` di CI; anggaran 6 query/halaman; MV untuk list berat | Eng | PR yang menyentuh repository layer |
| R8 | **Struktur halaman sumber berubah → parser rusak senyap** | 4 | 4 | 16 | `parser_version` wajib; error V2 sebagai failure eksplisit; alert error rate > 10%; re-parse dari staging (tanpa fetch ulang) | Eng | Setelah setiap perubahan sumber |
| R9 | **Rate limit sumber terlampaui → IP diblokir** | 3 | 4 | 12 | Token bucket per host, 1 req/s, concurrency ≤ 2, retry backoff + `Retry-After`, budget harian | Eng | Ingestion run |
| R10 | **Bobot engine bias → hasil kontra-intuitif** | 4 | 4 | 16 | Case library AC-31; review berkala; rule set versioned; editor bobot dengan preview dampak; korelasi dengan voting komunitas (Phase 2) | Product Eng | Setiap rilis engine |
| R11 | **Duplikasi data massal dari impor berulang** | 4 | 3 | 12 | Fingerprint + trigram + merge otomatis ≥ 0,90; idempotensi diuji AC-08; merge review untuk 0,70–0,90 | Data lead | Sebelum impor besar |
| R12 | **Data poisoning (impor manual berisi klaim palsu)** | 4 | 3 | 12 | Impor manual diberi `verification_status = imported` (bukan verified); sumber kelas 4–5 tidak pernah menimpa; audit log; rollback per-record | Data lead | Kontribusi eksternal |
| R13 | **Lock-in platform (Vercel/Supabase)** | 3 | 3 | 9 | Query standar PostgreSQL; tidak memakai fitur eksklusif yang tak dapat diekspor; storage & auth memiliki jalur migrasi terdokumentasi | Eng | Sebelum Phase 2 |
| R14 | **Ketergantungan pada satu kontributor/admin (bus factor)** | 3 | 4 | 12 | Runbook wajib (AC-30); dokumentasi arsitektur; dashboard self-service | Product | Sebelum rilis publik |
| R15 | **Abuse: penggunaan API untuk mengunduh seluruh database** | 3 | 4 | 12 | Batas pagination 200; tanpa endpoint bulk; rate limit ketat; `X-Robots-Tag`; deteksi pola burst | Eng | Rilis MVP |
| R16 | **Kualitas mesin SPA-heavy turun karena JS membengkak** | 3 | 3 | 9 | Anggaran bundle di CI; RSC default; audit dependensi bulanan | Eng | Setiap PR |
| R17 | **Ketidaklengkapan data membuat banyak hasil `insufficient_data`** | 4 | 4 | 16 | Prioritas pengisian 4 metrik inti per form; tampilkan kontribusi data yang hilang; `data_completeness` di dashboard admin; impor bertarget verse populer dulu | Data lead | Setiap milestone data |
| R18 | **Ambiguitas model tier/form di komunitas** | 3 | 4 | 12 | Dokumentasi publik taksonomi; halaman metodologi; form sebagai tab jelas; `assumption_log` transparan | Product | Rilis MVP |

**Risiko terbesar (R1, R2) → konsekuensi desain:** karena dua risiko ini paling besar, urutan prioritas implementasi menempatkan **impor terkelola + validasi + UI admin** sebelum otomasi crawl. Otomasi bernilai tinggi hanya setelah ada tempat bermutu untuk menyimpannya.

---

## 37. Scalability Strategy

### 37.1 Trajektori

| Tahap | Karakter | Form | Verse | Battle results (tahunan) | Infrastruktur |
|---|---|---|---|---|---|
| MVP | 10.000 | 30.000 | 1.500 | 200.000 | Supabase Free/Pro + Vercel + KV |
| Growth | 50.000 | 150.000 | 6.000 | 2 juta | Supabase Pro (instance lebih besar) + read replica + cache agresif |
| Scale | 100.000+ | 350.000+ | 12.000+ | 10 juta+ | Read replica + MV + search engine opsional + job worker terpisah |

### 37.2 Teknik per lapis

| Lapis | 10k (MVP) | 100k | Ambang pemicu aksi |
|---|---|---|---|
| Query | Index + denormalisasi | Partition `battle_results` & `analytics_events` per bulan; MV `character_search_mv` | p95 query > 250 ms atau tabel > 20 GB |
| Search | FTS + trigram in-DB | Provider eksternal (Meilisearch/Typesense) di belakang `SearchProvider` | search p95 > 400 ms atau index > 8 GB |
| Ingestion | Queue DB-backed, worker di cron/platform | Worker khusus + antrian Redis/Upstash; paralel per host yang diizinkan | job backlog > 500 atau durasi run > 30 menit |
| Cache | ISR + KV | CDN edge cache + cache per-region untuk endpoint panas | hit ratio < 70% |
| Storage gambar | Supabase Storage + `next/image` | CDN khusus + transformasi di edge | egress > 500 GB/bulan |
| Engine | Hitung on-demand + cache `input_hash` | Precompute untuk 10.000 matchup terpopuler; worker batch | simulasi p95 > 300 ms |
| Biaya | < USD 45/bulan | < USD 120/bulan | bulanan > 2× target → audit |

### 37.3 Prinsip yang menjaga skalabilitas

1. **Tidak ada data besar ke klien.** Pagination server-side, cap 200; halaman tidak pernah mengirim seluruh database (ini juga kebutuhan performa dan keamanan).
2. **Semua list punya jalur indeks.** Diverifikasi `EXPLAIN` di CI (AC-24) — regresi lebih awal daripada produksi.
3. **Denormalisasi terbatas & terdokumentasi.** Kolom stat di `character_versions` adalah cache bersumber tunggal (`statistics`) yang dikelola trigger + job reconcile; tidak ada duplikasi sumber kebenaran kedua.
4. **Hot path bebas hax engine penuh.** Simulasi yang sudah pernah dihitung dilayani cache `input_hash`.
5. **Isolasi beban ingestion dari beban baca.** Worker terpisah dari web; tidak ada ingestion di jalur request (AC-25).
6. **Upgrade path tertulis, bukan improvisasi.** Setiap komponen skala punya ambang pemicu dan penggantinya (§37.2).
7. **Benchmark sintetis tersimpan.** Seed 10k/100k dapat direproduksi lokal untuk mengukur regresi sebelum rilis.

---

## 38. Recommended Tech Stack

| Lapis | Pilihan | Alternatif | Alasan memilih |
|---|---|---|---|
| Framework | Next.js (App Router) + React + TypeScript `strict` | Remix, SvelteKit | RSC/SSR memenuhi kebutuhan SEO & JS minimal; ekosistem; satu bahasa untuk FE+BE; edge/serverless-ready |
| Styling | Tailwind CSS + design token (CSS variables) | CSS Modules | Konsistensi cepat untuk tim kecil; token memudahkan tema dark & menghindari "meniru" UI lain |
| UI primitives | Radix/Headless + komponen internal | Library siap pakai penuh | Kontrol aksesibilitas tanpa mengunci gaya visual ke pihak lain |
| Data fetching | Server Component + native fetch + React `cache`; TanStack Query hanya untuk interaksi kompleks admin | SWR | Mengurangi JS klien; server-side filtering alami |
| Validasi | zod (boundary API) + generated types dari DB | Valibot | Satu sumber kebenaran validasi; bagus dengan TypeScript |
| Database | PostgreSQL 15+ (Supabase managed) | Neon, RDS | FTS + `pg_trgm` + `unaccent` + JSONB + RLS dalam satu mesin → menghapus kebutuhan search engine di MVP |
| ORM / query | Supabase client + SQL/RPC untuk query agregat; migrasi SQL versioned | Prisma, Drizzle | Kontrol penuh atas query (penting untuk tuning & indexing); menghindari ORM yang menyembunyikan N+1 |
| Auth | Supabase Auth (magic link + OAuth, MFA admin) | Clerk, Auth.js | Sudah sepaket dengan DB & RLS → kontrol akses per-baris tanpa lapisan tambahan |
| Storage & CDN | Supabase Storage + `next/image` | S3 + CloudFront | Sederhana; transformasi gambar terbantu |
| Queue / jobs | Tabel `ingestion_jobs` + cron platform (Vercel Cron) | Upstash QStash, Redis+BullMQ | Transaksional, dapat diaudit, tanpa broker tambahan pada MVP; upgrade path jelas |
| Cache | ISR + Next `unstable_cache` + Upstash Redis (KV) | Redis mandiri | Murah, serverless, cukup untuk invalidation key-level |
| Input/worker HTTP fetch | `undici`/native fetch + `robots-parser` + p-queue | Axios | Kontrol timeout/retry/conditional GET yang tepat |
| Testing | Vitest (unit engine), Testcontainers/`supabase start` (integrasi DB), Playwright (E2E), Lighthouse CI | Jest | Cepat, cocok dengan TypeScript, dan mencakup tiga lapisan penting |
| Observability | Sentry + Vercel Analytics + Postgres slow-query log + uptime monitor | Datadog | Cukup & murah untuk tim kecil |
| CI/CD | GitHub Actions: lint → typecheck → unit → integrasi DB → Lighthouse → deploy preview | — | Gerbang kualitas otomatis sebelum rilis |
| Deployment | Vercel (web) + Supabase (data) + cron worker | Fly.io, Render | Zero-ops untuk tim kecil; biaya awal sangat rendah |
| Package manager | pnpm | npm | Instalasi cepat & hemat disk di CI |

**Catatan pilihan yang sengaja dihindari:** tidak memakai SPA penuh (melanggar target SEO/JS), tidak memakai vector DB (tidak dibutuhkan untuk pencarian nama), tidak memakai microservices (overhead operasional tak sebanding pada tahap ini), tidak memakai ORM dengan lazy-loading tersembunyi (menyembunyikan N+1 yang justru risiko utama kami).

---

## 39. Folder Structure

```
anime-vs-battle/
├─ app/
│  ├─ (public)/
│  │  ├─ page.tsx                       # Homepage: hero VS bar, popular battles/chars/tiers/verses
│  │  ├─ characters/
│  │  │  ├─ page.tsx                    # Database page: filter/sort/pagination server-side
│  │  │  └─ loading.tsx
│  │  ├─ character/[slug]/
│  │  │  ├─ page.tsx                    # Halaman karakter (SSR/ISR)
│  │  │  ├─ form/[formSlug]/page.tsx    # Halaman form bernilai konten tinggi (canonical sendiri)
│  │  │  └─ opengraph-image.tsx
│  │  ├─ verse/[slug]/page.tsx
│  │  ├─ versus/
│  │  │  ├─ page.tsx                    # VS builder
│  │  │  └─ [matchup]/page.tsx          # Permalink deterministik + OG image
│  │  ├─ compare/page.tsx
│  │  ├─ search/page.tsx
│  │  ├─ legal/{terms,privacy,takedown,methodology}/page.tsx
│  │  └─ sitemap.ts · robots.ts
│  ├─ admin/
│  │  ├─ layout.tsx                     # Guard role + shell admin
│  │  ├─ page.tsx                       # Dashboard
│  │  ├─ ingestion/{page.tsx,[id]/page.tsx}
│  │  ├─ conflicts/page.tsx
│  │  ├─ merges/page.tsx
│  │  ├─ characters/[id]/page.tsx
│  │  ├─ tiers/page.tsx
│  │  ├─ abilities/page.tsx
│  │  ├─ hax-interactions/page.tsx
│  │  ├─ rule-sets/page.tsx
│  │  └─ sources/page.tsx
│  └─ api/
│     ├─ characters/…  verses/…  abilities/…  tiers/…
│     ├─ search/route.ts · search/suggest/route.ts
│     ├─ battle/{simulate/route.ts,[id]/route.ts,[id]/card/route.ts}
│     ├─ compare/route.ts
│     ├─ reports/route.ts
│     ├─ admin/…
│     ├─ cron/{sync,ingest-worker,reconcile}/route.ts   # cron-triggered workers
│     └─ sitemaps/…
├─ src/
│  ├─ components/
│  │  ├─ ui/                            # primitives internal (button, badge, table, tabs)
│  │  ├─ character/                     # stat grid, form tabs, ability list, source block
│  │  ├─ versus/                        # builder, condition form, result panel, comparison table
│  │  ├─ admin/                         # job table, error panel, conflict diff, rule editor
│  │  └─ charts/
│  ├─ features/
│  │  ├─ characters/{queries.ts,actions.ts,types.ts,validators.ts}
│  │  ├─ verses/…
│  │  ├─ search/{provider.ts,postgres-provider.ts,queries.ts}
│  │  ├─ comparison/…
│  │  └─ battle/{input.ts,result.ts,presenter.ts}
│  ├─ services/
│  │  ├─ battle/                        # INTI: engine murni, tanpa I/O
│  │  │  ├─ engine.ts                   # orkestrasi Layer 0–7
│  │  │  ├─ gates.ts                    # eligibility + dominance
│  │  │  ├─ metrics.ts                  # normalisasi a_i
│  │  │  ├─ scoring.ts                  # weighted score + logistic
│  │  │  ├─ hax-engine.ts               # ability ↔ resistance ↔ counter
│  │  │  ├─ qualifiers.ts
│  │  │  ├─ difficulty.ts
│  │  │  ├─ reasoning.ts                # template deterministik + validator RG-1
│  │  │  ├─ rule-set.ts                 # load & validasi battle_rule_sets
│  │  │  ├─ stable-json.ts              # bentuk kanonik input_hash (kunci cache)
│  │  │  ├─ types.ts                    # kontrak tipe; tanpa nilai runtime
│  │  │  ├─ index.ts                    # barrel publik engine
│  │  │  ├─ fixtures/rule-set.default.json   # cermin docs/seed.sql (uji drift otomatis)
│  │  │  └─ cases/*.json                # AC-31 case library: 39 kasus / 6 berkas
│  │  ├─ ingestion/                     # TIDAK boleh diimpor jalur request (AC-25)
│  │  │  ├─ pipeline.ts                 # orchestrator 7 tahap
│  │  │  ├─ queue.ts                    # enqueue/claim/resume, backoff
│  │  │  ├─ rate-limiter.ts
│  │  │  ├─ fetcher.ts                  # conditional GET, SSRF guard
│  │  │  ├─ robots.ts
│  │  │  ├─ adapters/
│  │  │  │  ├─ adapter.ts               # interface: discover/fetch/parse/normalize
│  │  │  │  ├─ manual-dataset.ts        # impor CSV/JSON admin (jalur utama MVP)
│  │  │  │  ├─ manual-url.ts
│  │  │  │  └─ <source-adapter>.ts      # per sumber, mengikuti legal_status
│  │  │  ├─ normalize.ts · validate.ts · dedupe.ts · resolve.ts · upsert.ts
│  │  │  └─ __tests__/
│  │  ├─ search-index.ts                # search_vector, MV refresh
│  │  └─ cache.ts                       # key builders + invalidation
│  ├─ lib/
│  │  ├─ db/{client.ts,types.ts}        # generated types
│  │  ├─ supabase/{server.ts,client.ts,admin.ts}
│  │  ├─ auth/{session.ts,guards.ts,rbac.ts}
│  │  ├─ seo/{metadata.ts,jsonld.ts,og.ts}
│  │  ├─ ratelimit.ts · logger.ts · errors.ts · result.ts
│  │  └─ utils/{slug.ts,transliterate.ts,hash.ts}
│  └─ styles/{globals.css,tokens.css}
├─ supabase/
│  ├─ migrations/                       # SQL versioned (DDL, index, trigger, RLS, MV)
│  ├─ seed.sql                          # tiers, stat scales, ability categories, rule set
│  └─ functions/                        # RPC: search_hybrid, character_detail, battle_cache_get
├─ tools/                                # [ada] konfigurasi yang menegakkan arsitektur
│  ├─ architecture/
│  │  ├─ zones.mjs                      # definisi zona — sumber kebenaran lint batas
│  │  ├─ large-tables.mjs               # klasifikasi besar/kecil + alasan, lengkap atas schema
│  │  ├─ eslint-rules.mjs               # perakit aturan per zona (dipakai config & pemeriksa)
│  │  └─ glob.mjs                       # satu matcher untuk config dan invarian cakupan
│  └─ eslint-plugin-architecture/
│     ├─ rules/{engine-purity,boundary-import,no-select-star}.mjs
│     └─ __tests__/rules.test.mjs       # uji unit + regresi bug yang ditemukan
├─ tests/
│  ├─ architecture/fixtures/            # [ada] fixture melanggar/bersih + expected.mjs & probe zona
│  ├─ battle/                           # unit + integrasi engine
│  ├─ ingestion/                        # idempotency, resume, rate limit, robots
│  └─ e2e/                              # Playwright: search → battle → share
├─ scripts/
│  ├─ validate-schema.mjs               # [ada] eksekusi schema+seed di PostgreSQL, 56 uji
│  ├─ run-battle-cases.mjs              # [ada] runner AC-31..34, 425 pemeriksaan
│  ├─ mutate-battle-guards.mjs          # [ada] uji mutasi guard AC-36 (6 mutasi)
│  ├─ check-architecture.mjs            # [ada] fixture + false-positive + 4 invarian, 38 pemeriksaan
│  ├─ refresh-mv.sql                    # [ada] REFRESH MV CONCURRENTLY untuk cron
│  ├─ seed-bench-10k.ts · seed-bench-100k.ts
│  ├─ bench-queries.sql · explain-check.ts
│  └─ import-dataset.ts
├─ docs/
│  ├─ PRD.md · APPENDICES.md · schema.sql · seed.sql
│  └─ runbooks/{ingestion.md,conflict-review.md,takedown.md,rollback.md}
└─ .github/workflows/{ci.yml,lighthouse.yml,scheduled-ingest.yml}
```

**Aturan arsitektur yang ditegakkan tooling**

| Aturan | Alasan | Penegakan | Status |
|---|---|---|---|
| `services/battle/*` bebas I/O (fungsi murni) | Kemudahan uji & determinisme | Plugin internal `architecture/engine-purity` | **Terpasang** |
| `services/ingestion/*` tidak boleh diimpor dari jalur request | AC-25 | Zona + plugin internal `architecture/boundary-import` | **Terpasang** |
| Tidak ada `select *` pada tabel besar | Performa | Plugin internal `architecture/no-select-star` + klasifikasi tabel di `tools/architecture/large-tables.mjs` | **Terpasang** |
| Tidak ada query SQL langsung di komponen | Menjaga satu jalur data & indexing | Belum otomatis; dijaga review. Baru bermakna saat `src/components/**` berisi komponen nyata | **Belum** |
| Semua halaman publik mengekspor metadata | SEO | Test otomatis (AC-11) | **Belum** (Sprint 1) |

### 39.1 Model zona

Lint batas dibangun di atas enam zona yang didefinisikan sekali di `tools/architecture/zones.mjs`. Zona adalah **satu-satunya** sumber kebenaran: `eslint.config.mjs` merakit konfigurasinya, dan `scripts/check-architecture.mjs` memverifikasi cakupannya.

| Zona | Jalur | Aturan yang berlaku |
|---|---|---|
| `engine` | `src/services/battle/**` | Murni: hanya impor relatif **di dalam zonanya** + `node:crypto.createHash`. Global `Date`/`process`/`console`/`fetch` dan anggota non-deterministik (`Math.random`, `randomUUID`) dilarang |
| `node-runtime` | `src/lib/**`, `src/services/queue/**` | Wajib impor relatif ber-ekstensi `.ts` (dimuat Node dengan type stripping); dilarang mencapai ingestion |
| `ingestion-worker` | `worker/**`, `src/services/ingestion/**` | Wajib relatif; **diizinkan** memuat ingestion |
| `web-request` | `app/**` (kecuali cron), `src/features/**`, `src/components/**` | Dilarang mencapai ingestion (AC-25) |
| `scheduled-worker` | `app/api/cron/**` | Diizinkan mengerjakan antrian (dipicu penjadwal, bukan pengguna) |

**Kenapa plugin sendiri, bukan `eslint-plugin-boundaries`.** Tiga aturan yang dibutuhkan tidak semuanya berbentuk "zona A tidak boleh impor zona B":

1. `engine-purity` harus mengawasi *cara* memakai modul yang sebagian murni. `node:crypto` misalnya: `createHash` murni dan justru dibutuhkan engine, sementara `randomUUID` tidak. Melarang seluruh modul akan menghukum kode yang benar — dan aturan yang menghukum kode yang benar cepat dimatikan orang lewat `eslint-disable`.
2. `no-select-star` bekerja pada isi string SQL dan rantai pemanggilan; itu bukan aturan impor sama sekali.
3. `boundary-import` memang aturan impor, tetapi harus berbagi sumber kebenaran zona dengan dua aturan lain — dan plugin pihak ketiga tidak menyediakan itu.

**"Tabel besar" didefinisikan sebagai data, bukan sebagai tebakan.** `tools/architecture/large-tables.mjs` mengklasifikasikan **setiap** tabel di `docs/schema.sql` sebagai besar atau kecil, masing-masing dengan alasannya. Klasifikasi yang tidak lengkap menggagalkan pemeriksaan, sehingga tabel baru tidak dapat lolos tanpa keputusan sadar. Kriterianya: `select *` dapat menarik ratusan ribu baris (per fakta/form/trafik), atau memuat kolom berat/jsonb.

**Bukti bahwa aturannya menggigit.** `npm run check:architecture` menjalankan tiga hal yang tidak dapat dijawab lint biasa: (a) fixture yang sengaja melanggar harus tertangkap **dengan rule id dan jumlah yang tepat** — kurang maupun lebih sama-sama gagal; (b) kode produksi nyata harus **nol pelanggaran** (uji false-positive); (c) empat invarian: cakupan zona, jalur impor ingestion (diperiksa langsung dari teks kode, bukan lewat lint yang sedang diuji), kelengkapan klasifikasi tabel, dan kesamaan daftar enum di route dengan tipe engine.

---

## 40. Implementation Roadmap

Asumsi kapasitas: 1–2 full-stack engineer + 1 data curator part-time. Durasi dalam minggu kerja.

### Sprint 0 — Fondasi (2 minggu)

| Deliverable | Detail |
|---|---|
| Repo & CI | Next.js (App Router) + TS strict + Tailwind; lint/typecheck/unit/Lighthouse pipeline. Lint batas arsitektur (§39.1) termasuk di sini karena dibangun sebelum kode yang harus dijaganya |
| Skema & migrasi | `schema.sql` dijalankan via migrasi versioned; seed tier/stat scale/kategori ability |
| Auth & role | Supabase Auth; `user_roles`; guard `/admin` |
| Design token | Palet dark, tipografi, spacing, komponen badge tier & stat card |
| **Exit criteria** | CI hijau; admin dapat login; migrasi & seed reprodusibel dari nol |

### Sprint 1 — Data core + halaman karakter (3 minggu)

| Deliverable | Detail |
|---|---|
| Domain & repositori | characters, verses, versions, statistics, sources |
| Halaman `/character/[slug]` | Stat grid, form tabs, ability/resistance list, sources, disclaimer |
| Halaman `/characters` | Filter/sort/pagination server-side |
| Halaman `/verse/[slug]` | Distribusi tier + top karakter (MV) |
| SEO dasar | Metadata, canonical, JSON-LD, sitemap, robots |
| **Exit criteria** | AC-02, AC-04, AC-09, AC-11, AC-12, AC-21–23 lulus dengan bukti |

### Sprint 2 — Search & ingestion (3 minggu)

| Deliverable | Detail |
|---|---|
| Search hybrid | FTS + trigram + alias + unaccent + transliterasi; endpoint suggest |
| Ingestion pipeline | Queue, rate limiter, fetcher, robots, parser interface, normalizer, validator, dedupe, resolver, upsert |
| Impor terkelola | CSV/JSON admin + manual URL + dry-run diff |
| Admin dashboard v1 | Ringkasan, job list, error panel, sync now, import |
| Bench 10k | Script seed sintetis + benchmark query & search |
| **Exit criteria** | AC-01, AC-07, AC-08, AC-10, AC-15, AC-16, AC-19, AC-24, AC-25, AC-27 lulus |

### Sprint 3 — Battle engine (3 minggu)

| Deliverable | Detail |
|---|---|
| `services/battle/*` | Layer 0–7, normalisasi metrik, weighted scoring, logistic, difficulty, reasoning generator + validator |
| Hax engine | `hax_interactions` + matriks §15.3 + efek kondisi §16.4 |
| VS builder & hasil | `/versus`, blok hasil lengkap, disclaimer |
| Comparison mode | `/compare` + indicator |
| Battle cache & permalink | `input_hash`, `/versus/[matchup]`, OG image |
| Case library | ≥ 30 kasus uji (AC-31) |
| **Exit criteria** | AC-03, AC-05, AC-06, AC-13, AC-14, AC-28, AC-29, AC-31–34 lulus |

### Sprint 4 — Kualitas data & hardening (3 minggu)

| Deliverable | Detail |
|---|---|
| Konflik & merge | Conflict queue + UI diff; merge candidates + redirect 301 |
| Rule & tier editor | Editor bobot dengan preview dampak; manage tier/ability/resistance |
| Keamanan | Rate limiting, CSRF, CSP, SSRF guard, audit log, uji injeksi |
| Performa | Tuning index, MV, image optimization, bundle budget |
| Ingestion terjadwal | Cron incremental + full mingguan; alert error rate |
| **Exit criteria** | AC-17, AC-18, AC-20, AC-26, AC-30 lulus; semua AC §35 tervalidasi |

### Sprint 5 — Data bootstrapping & peluncuran (3 minggu)

| Deliverable | Detail |
|---|---|
| Impor target | ≥ 10.000 karakter / ≥ 1.500 verse / ≥ 28.000 form; prioritas verse populer |
| Audit kualitas | 4 metrik inti terisi untuk ≥ 90% form prioritas; review konflik terbuka |
| SEO launch | Sitemap penuh, internal linking, halaman metodologi & legal |
| Soft launch | Beta tertutup 100 pengguna → perbaikan UX & tuning bobot |
| **Exit criteria** | K1–K7 terukur; semua AC lulus; runbook lengkap |

### Sprint 6+ — Phase 2 (mulai setelah launch)

Akun pengguna → favorites → battle history → comments/voting → team battle → tournament → public API terbatas.

**Ringkasan timeline:** fondasi 2 + data 3 + search/ingestion 3 + engine 3 + hardening 3 + launch 3 = **17 minggu kerja** untuk MVP end-to-end, dengan setiap sprint memiliki exit criteria yang dapat diverifikasi.

**Ketergantungan kritis (critical path):**

```
Sprint 0 (skema) ──▶ Sprint 1 (halaman butuh skema) ──▶ Sprint 2 (search butuh data terindeks)
                                   │                                │
                                   └──────────▶ Sprint 3 (engine butuh data stat + rule)
                                                        │
                                          Sprint 4 (hardening butuh engine stabil)
                                                        │
                                          Sprint 5 (launch butuh semuanya)
```

Jika R1 (akses sumber) memaksa pembatasan impor, **Sprint 2 tetap dapat selesai** karena jalur impor terkelola tidak bergantung pada crawling; Sprint 5 hanya menurunkan target volume bila dataset berlisensi kurang tersedia.

---

## Lampiran: Decision Log (alasan keputusan teknis)

| # | Keputusan | Alternatif yang ditolak | Alasan |
|---|---|---|---|
| D1 | Form sebagai entity kelas satu, engine menerima `character_version_id` | Satu stat per karakter | Sumber utama kesalahan debat; tanpa ini, perbaikan UX apa pun sia-sia |
| D2 | Tier & aturan sebagai data di DB | Enum/hardcode di kode | Admin non-programmer harus dapat memperbaiki meta tanpa deploy |
| D3 | Layered decision (gate → hax → score → kalibrasi) | Satu skor tertimbang | Skor tunggal menghasilkan hasil absurd saat hax mendominasi; hax harus punya otoritas lebih tinggi dari aritmetika statistik |
| D4 | PostgreSQL FTS + trigram untuk MVP | Elasticsearch/Meilisearch sejak awal | Menghapus satu sistem; `pg_trgm` cukup untuk fuzzy nama; upgrade path tetap terbuka via `SearchProvider` |
| D5 | Queue berbasis tabel DB | Redis/BullMQ sejak awal | Transaksional, dapat diaudit, tanpa broker tambahan; volume job rendah (ratusan/hari) |
| D6 | Konflik sumber disimpan, bukan ditimpa | Last-write-wins | Mencegah korupsi data senyap; memberi manusia keputusan akhir |
| D7 | Stat didenormalisasi ke `character_versions` | Join penuh saat query list | Menghilangkan 12 join pada hot path; sumber kebenaran tetap `statistics` (dikelola trigger) |
| D8 | Probabilitas = keyakinan model, bukan probabilitas nyata | Menampilkan hasil biner "A menang" | Jujur secara epistemik; mematikan klaim otoritatif yang tidak dapat dipertanggungjawabkan |
| D9 | Disclaimer wajib di UI, bukan footer | Footer saja | Pengguna harus tahu sifat hasil sebelum menggunakannya |
| D10 | Ingestion tidak pernah di jalur request | Simulasi fetch saat pengguna membuka halaman | Kinerja, ToS, dan stabilitas; ditegakkan lint boundary |
| D11 | Adapter per sumber dengan `legal_status` | Satu crawler generik | Kepatuhan per sumber dapat dikendalikan dan diaudit; menambah sumber tidak menyentuh core |
| D12 | Impor terkelola sebagai jalur utama MVP | Crawl otomatis sebagai jalur utama | R1 (akses sumber) adalah risiko terbesar; MVP harus dapat berfungsi tanpanya |
| D13 | Fail-closed untuk field fakta, fail-open untuk kosmetik | Seragam | Kelengkapan fakta adalah inti produk; gambar kosong tidak menghalangi nilai |
| D14 | Ability harus masuk katalog (tidak ada string bebas) | Menyimpan nama ability apa adanya | Rule engine hanya dapat bekerja bila kemampuan ternormalisasi (AB-1) |
| D15 | Reasoning deterministik berbasis template untuk MVP | LLM sebagai generator alasan utama | Determinisme, biaya, dan anti-halusinasi; LLM hanya sebagai narator opsional (Phase 3) |
| D16 | Pemisahan tegas data vs artwork | Satu tabel dengan kolom gambar | Menghapus risiko hak cipta tanpa kehilangan data; memungkinkan takedown parsial |
| D17 | RLS + Supabase Auth | Auth kustom + middleware sendiri | Mengurangi permukaan serangan & kode; kontrol per-baris tanpa lapisan tambahan |
| D18 | Cap pagination 200 & tanpa endpoint bulk | Endpoint ekspor lengkap | Melindungi data dan biaya; mencegah kloning produk |
| D19 | Case library sebagai artefak wajib | Mengandalkan uji manual | Satu-satunya cara menjaga kualitas engine agar tidak regresi saat bobot diubah |
| D20 | i18n & multi-bahasa ditunda ke Phase 2 | i18n sejak Sprint 0 | Fokus MVP pada data & engine; i18n menambah kompleksitas konten (alias, transliterasi) |

---

## Lampiran: Glosarium

| Istilah | Arti dalam dokumen ini |
|---|---|
| **Verse** | Semesta/asal karya fiksi (mis. Dragon Ball) |
| **Form/Version** | Wujud karakter pada era/kondisi tertentu; unit terkecil yang dipertarungkan |
| **Tier** | Peringkat kekuatan keseluruhan yang tersimpan di DB dengan `numerical_rank` |
| **Stat scale** | Skala ordinal ber-rank (dan `log_value` bila dapat dikuantifikasi) untuk sebuah metrik |
| **Qualifier** | Modifier kepercayaan pada klaim (possibly, likely, at_least, varies, dll.) |
| **Confidence** | Estimasi kelengkapan/kejelasan data (0–1), bukan probabilitas kebenaran kanon |
| **Decisive edge** | Keunggulan ability/hax yang sendirian memenuhi win condition |
| **Data gap** | Rasio metrik wajib yang tidak tersedia; menurunkan confidence dan menarik probabilitas ke 0,5 |
| **Staging** | Area penyimpanan hasil parse (`ingestion_raw_pages`) sebelum masuk tabel kanonik |
| **Snapshot** | Rekaman fetch (hash, excerpt, parser version) untuk audit dan re-parse |
| **Idempoten** | Dijalankan berulang menghasilkan keadaan akhir yang sama |
| **Rule set** | Kumpulan bobot & konstanta engine yang berversi |
