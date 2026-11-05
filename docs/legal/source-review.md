# Source Review — Gerbang Legal Sumber Eksternal

**Status: GATE TERBUKA — belum ada sumber baru yang diaktifkan.**
Dokumen ini adalah Langkah 0. Tidak ada adapter, registry, atau impor yang diubah
sampai dokumen ini disetujui dan ditandatangani.

- **Tanggal pemeriksaan:** 2026-11-04
- **Lingkup:** kandidat sumber untuk katalog karakter (≥ 200 karakter, ≥ 10 verse)
- **Keputusan yang diminta:** status `legal_status` per sumber + persetujuan
  implikasi share-alike (lihat §5 dan §9)
- **Bukan nasihat hukum.** Ini catatan bukti dan rekomendasi teknis. Keputusan
  akhir harus ditandatangani penanggung jawab legal (lihat §11).

---

## 1. Metode dan batas

Yang diperiksa untuk setiap kandidat:

1. Halaman lisensi/kopyright sumber.
2. Syarat layanan (ToS) atau syarat API resmi.
3. `robots.txt` pada host yang benar-benar akan di-fetch (bukan hanya host
   halaman marketing).
4. Ketersediaan API resmi, dump resmi, atau jalur impor berlisensi.
5. Kesesuaian dengan kebijakan repo: PRD §18.5 (IG-1..IG-7), `src/services/ingestion/sources.ts`
   (`assertSourceUsable`), dan gerbang `robots.txt` fail-closed di
   `src/services/ingestion/robots.ts`.

Batasan yang harus dibaca sebelum mengambil keputusan:

- Beberapa halaman mengembalikan **403** ke fetcher non-browser (Fandom, AniDB,
  TMDB). Saya **tidak** mencoba melewatinya — itu melanggar aturan anti-bot.
  Untuk sumber tersebut, bukti yang ada hanya cuplikan mesin pencari dan
  dokumentasi pihak ketiga; statusnya tidak boleh dinaikkan menjadi `allowed`
  tanpa verifikasi manusia lewat browser.
- `robots.txt` adalah sinyal akses otomatis, **bukan** lisensi. Lisensi datang
  dari halaman copyright/ToS. Bila keduanya berbeda, yang lebih ketat berlaku.
- Kutipan di bawah adalah kutipan pendek untuk bukti; teks lengkap tetap di
  URL masing-masing.

---

## 2. Ringkasan keputusan

Rekomendasi memakai tiga nilai yang ada di enum `legal_status_t`
(`docs/schema.sql`): `allowed`, `restricted`, `disabled`. Istilah "prohibited"
di teks berarti `disabled`.

| # | Kandidat | Data yang relevan | Lisensi | robots pada host fetch | API/dump resmi | Rekomendasi |
|---|---|---|---|---|---|---|
| 1 | VS Battles Wiki (Fandom) | tier, AP, durability, speed, ability | CC BY-SA 3.0 | **403 — tak terverifikasi** | MediaWiki API; tidak ada izin eksplisit | `restricted` |
| 2 | Character Stats and Profiles Wiki (Fandom) | statistik tempur | CC BY-SA (per-wiki, belum diverifikasi) | 403 — tak terverifikasi | MediaWiki API | `restricted` |
| 3 | All Fiction Battles Wiki (Fandom) | statistik tempur | CC BY-SA (per-wiki, belum diverifikasi) | 403 — tak terverifikasi | MediaWiki API | `restricted` |
| 4 | Wiki Fandom lain (One-Punch Man, dsb.) | deskripsi, alias | CC BY-SA 3.0 (kecuali dicatat lain) | 403 — tak terverifikasi | MediaWiki API | `restricted` |
| 5 | AniList | identitas, alias, verse | Tidak ada lisensi data terbuka; API ToS | `graphql.anilist.co` **allow** | GraphQL API resmi | `restricted` (kondisional) |
| 6 | MyAnimeList API resmi | anime/manga/person (bukan karakter) | ToS: personal, nonkomersial | `api.myanimelist.net` 404 | API v2 resmi | `disabled` |
| 7 | Jikan | mirror MAL (termasuk karakter) | Tanpa lisensi; scrape MAL | tak terverifikasi | REST tidak resmi | `disabled` |
| 8 | Kitsu | identitas, karakter | Tidak jelas; docs Apache 2.0 bukan lisensi data | `kitsu.io` **disallow `/api/`** | JSON:API resmi | `disabled` |
| 9 | Anime News Network (ANN) | judul, orang, sebagian karakter | © ANN; API ToS: atribusi + link | **disallow `/encyclopedia/reports*` & `api.xml`** | Encyclopedia API resmi | `restricted` |
| 10 | AniDB | identitas, karakter | © AniDB; policy: no bulk | allow (kecuali bot AI) | API ber-registrasi; **tanpa dump** | `disabled` |
| 11 | Shikimori | mirror MAL | Tanpa lisensi; mirror | **disallow `/api/*` dan semua query** | API resmi (tapi robots menolak) | `disabled` |
| 12 | Wikidata | identitas, alias, relasi verse | **CC0** | dumps: **tanpa robots**; API: disallow `/w/`, `/sparql` | Dump bulanan resmi | `allowed` (dump) |
| 13 | Wikipedia | deskripsi, alias | **CC BY-SA 4.0** + GFDL | artikel allow; `/w/`, `/api/` disallow | Dump resmi | `allowed` (dump/artikel) |
| 14 | Wikimedia Commons | gambar | Per-berkas (beragam) | allow | API/dump | `restricted` (per file) |
| 15 | TMDB | metadata film/TV, gambar | ToS tidak terbaca (403) | tak terverifikasi | API resmi | `disabled` |
| 16 | Situs penerbit/portal resmi | teks/ilusitrasi kanon | © penerbit | beragam | tidak ada | `disabled` |

**Kesimpulan ringkas:** satu-satunya jalur yang lolos lisensi **dan** robots
tanpa syarat tambahan adalah **dump Wikimedia** (Wikidata CC0, Wikipedia
CC BY-SA 4.0). Tidak ada satu pun sumber otomatis yang menyediakan empat metrik
wajib engine (tier, attack potency, durability, speed). Karena itu gelombang
pertama 200 karakter tidak bisa dilewati dengan "adapter crawling"; ia butuh
**kurasi dataset** di bawah `admin-dataset-import` (jalur yang sudah dipakai
One-Punch Man) **dan** persetujuan share-alike. Ini keputusan manusia, bukan
keputusan teknis.

---

## 3. Detail per kandidat

### 3.1 VS Battles Wiki

- **URL:** https://vsbattles.fandom.com/
- **Data:** tier, attack potency, durability, striking strength, speed, ability,
  resistance; satu-satunya kandidat yang sudah dipakai dataset produksi.
- **Lisensi:** teks wiki CC BY-SA 3.0 Unported. Halaman copyright wiki:
  https://vsbattles.fandom.com/wiki/VS_Battles_Wiki:Copyrights — cuplikan:
  *"Except where otherwise specified, the text on Wikia sites is licensed under
  the Creative Commons Attribution-Share Alike License 3.0 (Unported) (CC-BY-SA)."*
  Dataset `docs/datasets/one-punch-man.json` sudah mencatat lisensi ini.
- **Implikasi share-alike:** lihat §5. Ringkasnya: data turunan (statistik yang
  diekstrak/dinormalisasi) wajib tetap CC BY-SA 3.0, dengan atribusi dan
  indikasi perubahan.
- **ToS:** Fandom Terms of Use — https://www.fandom.com/terms-of-use.
  **Tidak dapat diverifikasi dari lingkungan ini: HTTP 403.** Yang terbaca hanya
  cuplikan mesin pencari (tanggal 2025-12-19) yang menyebut halaman itu sebagai
  aturan penggunaan layanan. Tidak ada kutipan yang dapat dipertanggungjawabkan.
- **robots.txt:** https://vsbattles.fandom.com/robots.txt → **HTTP 403**.
  Tidak dapat diverifikasi. Konsekuensi teknis: gerbang robots repo memperlakukan
  status non-404/non-OK sebagai **fail-closed** (`robots.ts` melempar
  `SourcePolicyError`), jadi adapter otomatis untuk host ini akan gagal bahkan
  bila `legal_status` dinaikkan.
- **API/dump resmi:** MediaWiki API tersedia secara teknis (`/api.php`), tetapi
  tidak ada pernyataan izin bulk, dan tidak ada dump resmi Fandom. `Special:Export`
  bukan dump dan tetap tunduk pada ToS/robots.
- **Rekomendasi `legal_status`:** **`restricted`**. Data hanya masuk lewat
  dataset terkurasi (`admin-dataset-import`) seperti sekarang — bukan fetch
  otomatis.
- **Syarat sebelum diubah menjadi `allowed`:**
  1. Manusia memverifikasi robots.txt dan ToS lewat browser (bukan bypass).
  2. Ada izin tertulis atau dasar yang jelas untuk akses otomatis.
  3. Atribusi per baris + lisensi CC BY-SA 3.0 + tautan copyright tampil di UI.
  4. Tidak ada gambar yang diimpor (gambar Fandom tidak otomatis CC BY-SA).
- **Bukti:** dataset OPM; halaman copyright (cuplikan); robots 403; ToS 403.

### 3.2 Character Stats and Profiles Wiki

- **URL:** https://character-stats-and-profiles.fandom.com/
- **Data:** statistik tempur komunitas, format mirip VS Battles.
- **Lisensi:** Fandom secara umum CC BY-SA 3.0, tetapi **lisensi per-wiki harus
  dicek** di halaman copyright masing-masing; Fandom mengizinkan wiki memakai
  lisensi lain bila diizinkan secara eksplisit
  (https://www.fandom.com/licensing — 403 untuk fetcher; cuplikan pencarian:
  *"Individual wikis may not use a license other than CC BY-SA unless it has
  been explicitly permitted by..."*).
- **Share-alike:** sama seperti §3.1 bila benar CC BY-SA.
- **ToS:** Fandom ToS; 403, tidak terverifikasi.
- **robots.txt:** host Fandom; permintaan robots ke VS Battles mengembalikan 403.
  Untuk wiki ini belum diambil; anggap tak terverifikasi.
- **API/dump:** MediaWiki API; tanpa izin bulk; tanpa dump.
- **Rekomendasi:** **`restricted`**.
- **Syarat:** verifikasi halaman copyright wiki + robots + ToS oleh manusia;
  atribusi; tanpa gambar; curator-mediated import.

### 3.3 All Fiction Battles Wiki

- **URL:** https://all-fiction-battles.fandom.com/
- **Data:** statistik tempur lintas fiksi (termasuk anime/manga).
- **Lisensi:** CC BY-SA per-wiki (belum diverifikasi; halaman copyright wiki wajib dicek).
- **Share-alike:** ya, bila benar CC BY-SA — sama seperti §5.
- **ToS:** Fandom ToS (https://www.fandom.com/terms-of-use); 403, tidak terverifikasi.
- **robots.txt:** host Fandom; tidak dapat diverifikasi (403 pada permintaan robots).
- **API/dump:** MediaWiki API; tanpa izin bulk; tanpa dump.
- **Rekomendasi:** **`restricted`** dengan syarat yang sama seperti §3.2.
- **Syarat:** verifikasi manusia atas lisensi/robots/ToS; atribusi; tanpa gambar; curator-mediated import.

### 3.4 Wiki Fandom lain (One-Punch Man Wiki, dsb.)

- **Data:** deskripsi, nama asli, alias, daftar form/era — pelengkap metadata,
  bukan statistik tempur.
- **Lisensi:** CC BY-SA 3.0 secara default Fandom, kecuali dicatat lain.
- **Share-alike:** ya — teks yang diadaptasi wajib CC BY-SA; atribusi dan indikasi perubahan.
- **ToS:** Fandom ToS (https://www.fandom.com/terms-of-use); 403, tidak terverifikasi.
- **robots.txt:** host Fandom; tidak dapat diverifikasi (403).
- **API/dump:** MediaWiki API; `Special:Export` terbatas; tanpa dump publik.
- **Rekomendasi:** **`restricted`**; impor manual/terkurasi dengan atribusi.
- **Syarat:** verifikasi manusia; atribusi per baris; tanpa gambar; bukan untuk statistik tanpa review.
- **Catatan:** jangan mencampur teks wiki ke deskripsi karakter tanpa atribusi
  dan tanpa lisensi yang sama; ini termasuk perubahan (adaptasi).

### 3.5 AniList

- **URL/API:** https://anilist.co/ ; endpoint GraphQL `https://graphql.anilist.co`.
- **Data:** identitas karakter, nama alternatif/alias, relasi anime/manga, staff.
  **Tidak ada** tier/AP/durability/speed.
- **Lisensi:** tidak ada lisensi data terbuka. ToS API tidak memberikan hak
  redistribusi; yang diberikan adalah izin penggunaan API.
- **Share-alike:** tidak ada kewajiban BY-SA, tetapi ToS membatasi penggunaan
  ulang dan melarang bulk/hoarding.
- **ToS API:** https://docs.anilist.co/guide/terms-of-use — kutipan:
  *"The AniList API may be used within commercial applications or services
  operating at less than $150 of revenue per month free of charge, no express
  permission is required."*; *"Using the AniList API as a backup or data storage
  service is strictly prohibited."*; *"Hoarding or mass collection of data from
  the AniList API is strictly prohibited."*; *"Use of the AniList API within
  competing, non-complementary services of the same nature is prohibited."*
- **Rate limit:** 90 req/menit (dokumentasi), saat ini dibatasi 30 req/menit
  karena API dalam keadaan degradasi; ada burst limiter
  (https://docs.anilist.co/guide/rate-limiting).
- **robots.txt:** `https://anilist.co/robots.txt` **disallow `/api/` dan
  `/graphql`** untuk crawler; tetapi host API `https://graphql.anilist.co/robots.txt`
  **Allow: /** (hanya bot pelatihan AI yang dilarang). Jadi yang menentukan
  adalah ToS API, bukan robots halaman marketing — tetapi tetap tidak boleh
  dianggap lisensi terbuka.
- **API/dump:** API resmi; **tidak ada dump resmi**; bulk/hoarding dilarang.
- **Rekomendasi:** **`restricted`** — hanya metadata/alias, non-bulk, dan hanya
  bila status komersial terkonfirmasi (< $150/bulan) serta layanan bersifat
  komplementer, bukan pesaing tracker.
- **Syarat:** konfirmasi pendapatan/status komersial; batas laju; atribusi
  "Data from AniList"; tidak menyimpan salinan penuh sebagai pengganti API;
  tidak memakai untuk statistik tempur.

### 3.6 MyAnimeList API resmi

- **URL/API:** https://myanimelist.net/apiconfig/references/api/v2
- **Data:** anime, manga, forum, user. **Tidak ada endpoint karakter** di API v2
  (daftar endpoint di dokumentasi: anime, manga, forum, user).
- **Lisensi/ToS:** https://myanimelist.net/about/terms_of_use — kutipan:
  *"Company grants you a limited, non-exclusive, non-assignable,
  non-sub-licensable, revocable, license to use the Service solely for your
  personal, noncommercial use"*; juga *"you will not copy, distribute, or
  disclose any part of the Service in any medium"*.
- **Share-alike:** tidak berlaku (bukan lisensi CC; ToS nonkomersial).
- **robots.txt:** https://myanimelist.net/robots.txt — `Disallow: /about`,
  blok besar bot AI, tetapi tidak memblokir `/api`. Host API
  `api.myanimelist.net/robots.txt` → 404 (tanpa batasan).
- **API/dump:** API resmi OAuth2; tanpa dump.
- **Rekomendasi:** **`disabled`** untuk produk ini: lisensi personal/nonkomersial,
  dan data karakter tidak tersedia.
- **Syarat bila ingin dipakai:** izin tertulis MAL untuk penggunaan komersial;
  tidak ada jalur teknis yang menghindari ini.

### 3.7 Jikan

- **URL:** https://jikan.moe/ ; docs https://docs.api.jikan.moe/
- **Data:** mirror tidak resmi MyAnimeList, termasuk karakter.
- **Lisensi/ToS:** Jikan menyebut dirinya *"Unofficial MyAnimeList API"* dan
  mengambil data dengan **scraping** MAL (https://github.com/jikan-me/jikan-rest).
  Jikan tidak memiliki lisensi untuk mensublisensikan data MAL; ToS MAL melarang
  penyalinan/distribusi dan penggunaan nonkomersial.
- **Share-alike:** tidak berlaku (data MAL, bukan lisensi terbuka).
- **robots.txt:** `api.jikan.moe/robots.txt` tidak dapat diverifikasi
  (permintaan gagal). Karena sumber hulu melarang, ini tidak mengubah keputusan.
- **Rate limit:** 3 req/detik, 60 req/menit (dokumentasi).
- **API/dump:** REST tidak resmi; tanpa dump.
- **Rekomendasi:** **`disabled`**. Memakai Jikan berarti memakai data MAL yang
  diperoleh dengan cara yang tidak diizinkan MAL.

### 3.8 Kitsu

- **URL/API:** https://kitsu.io/api/edge ; docs
  https://hummingbird-me.github.io/api-docs/
- **Data:** anime, manga, karakter, staff.
- **Lisensi:** dokumentasi API menyebut lisensi **Apache 2.0** — itu lisensi
  spesifikasi/dokumentasi, **bukan** lisensi data. Tidak ada pernyataan lisensi
  data yang dapat ditemukan.
- **Share-alike:** tidak dapat ditentukan (lisensi data tidak dinyatakan).
- **ToS:** https://kitsu.io/terms tidak menghasilkan teks yang dapat dibaca
  (halaman kosong/JS). Tidak terverifikasi.
- **robots.txt:** https://kitsu.io/robots.txt — **`Disallow: /api/`**. Host
  `kitsu.app` juga `Disallow: /api/`. Gerbang robots repo akan menolak endpoint
  API sebelum fetch.
- **API/dump:** JSON:API resmi; tanpa dump yang dikonfirmasi.
- **Rekomendasi:** **`disabled`** sampai (a) robots/izin akses API diselesaikan
  dan (b) lisensi data dinyatakan tertulis.

### 3.9 Anime News Network (ANN) Encyclopedia

- **URL/API:** https://www.animenewsnetwork.com/encyclopedia/api.php
- **Data:** judul anime/manga, staff/person, sebagian karakter. Tidak ada
  statistik tempur.
- **Lisensi:** https://www.animenewsnetwork.com/copyright-policy — *"Unless
  otherwise stated, all material published on AnimeNewsNetwork.com is owned by
  and copyright Anime News Network LLC"*. Reproduksi di luar berita/fair use
  memerlukan izin.
- **Share-alike:** tidak ada lisensi terbuka; © ANN dengan izin API terbatas
  (atribusi + tautan), bukan lisensi data turunan.
- **ToS API:** halaman API menyatakan: *"We provide this API free of charge but
  you must list Anime News Network as the source of the data [and] include a link
  to the relevant Encyclopedia entry"*; batas **1 request/detik/IP**.
- **robots.txt:** https://www.animenewsnetwork.com/robots.txt —
  `Disallow: /encyclopedia/api.xml` dan `Disallow: /encyclopedia/reports`
  (prefiks ini juga mencakup `reports.xml`), `Crawl-delay: 2`. Host
  `cdn.animenewsnetwork.com` mengarah ke robots yang sama.
- **Konflik:** dokumentasi API mengundang pemakaian, tetapi robots melarang
  path-nya. Gerbang kita memilih yang lebih ketat → **tidak boleh fetch** sampai
  ada keputusan tertulis.
- **API/dump:** API resmi; tanpa dump.
- **Rekomendasi:** **`restricted`** — bukan untuk statistik; hanya metadata bila
  konflik robots/API diselesaikan dan legal menyetujui penggunaan API.

### 3.10 AniDB

- **URL/API:** https://anidb.net/ ; API ber-registrasi (HTTP/UDP).
- **Lisensi/policy:** https://anidb.net/policy (403 untuk fetcher; cuplikan
  pencarian): *"AniDB data cannot be extracted in bulk, and database dumps are
  not offered. Use AniDB via ..."*. Ini larangan eksplisit untuk kebutuhan kita.
- **Share-alike:** tidak berlaku (policy melarang bulk; bukan lisensi terbuka).
- **ToS:** halaman policy yang sama; tidak terbaca penuh.
- **robots.txt:** https://anidb.net/robots.txt → 200, `Allow: /` kecuali bot
  pelatihan AI. robots tidak menyelamatkan larangan bulk di policy.
- **API/dump:** API ber-registrasi; **tanpa dump**.
- **Rekomendasi:** **`disabled`**. Bulk extraction dilarang; tidak ada jalur
  dump resmi.

### 3.11 Shikimori

- **URL/API:** https://shikimori.one/ (redirect ke shikimori.io)
- **Data:** mirror MAL (anime/manga/karakter).
- **Lisensi:** tidak ada lisensi data independen; data berasal dari MAL.
- **Share-alike:** tidak berlaku (mirror MAL).
- **robots.txt:** https://shikimori.one/robots.txt — `Disallow: /api/*`,
  `Disallow: /*?` (semua query string), `Disallow: /animes/search/*`.
- **API/dump:** API resmi, tetapi robots menolak path API dan query; tanpa dump.
- **Rekomendasi:** **`disabled`**.

### 3.12 Wikidata

- **URL:** https://www.wikidata.org/
- **Data:** identitas entitas, alias multibahasa, relasi (fictional character,
  part of franchise, dsb.). **Tidak ada** statistik tempur.
- **Lisensi:** **CC0** untuk structured data (main/Property/Lexeme/EntitySchema
  namespaces); teks namespace lain CC BY-SA 4.0 —
  https://www.wikidata.org/wiki/Wikidata:Licensing.
- **Share-alike:** **tidak ada** untuk data terstruktur (CC0). Ini satu-satunya
  kandidat yang tidak menular ke dataset turunan.
- **ToS:** Wikimedia Terms of Use + API:Etiquette (bukan robots).
- **robots.txt:** https://www.wikidata.org/robots.txt — `Disallow: /w/`,
  `Disallow: /api/`, `Disallow: /wiki/Special:`. Query Service
  https://query.wikidata.org/robots.txt — `Disallow: /sparql`, `/bigdata`.
  Karena itu **API live tidak lolos gerbang robots**; dump tidak terkena robots.
- **API/dump:** dump resmi bulanan di https://dumps.wikimedia.org/wikidatawiki/
  dan `.../entities/`. Ukuran yang teramati (2026-11-04):
  `latest-all.json.bz2` ≈ 103,6 GB, `latest-truthy.nt.bz2` ≈ 43,6 GB (terkompresi).
  Ini pekerjaan offline/streaming, bukan fetch per request.
- **Rekomendasi:** **`allowed` untuk dump**, **`restricted` untuk API live**.
- **Syarat:** pipeline dump offline (worker terpisah), filter berdasarkan Q-id
  yang dibutuhkan; bukan pengganti statistik.

### 3.13 Wikipedia

- **URL:** https://en.wikipedia.org/
- **Data:** deskripsi, nama asli, alias, konteks verse. Tidak ada statistik.
- **Lisensi:** teks **CC BY-SA 4.0** (dan GFDL) —
  https://en.wikipedia.org/wiki/Wikipedia:Copyrights. Gambar memiliki lisensi
  masing-masing dan sebagian non-free.
- **Share-alike:** ya, untuk teks yang diadaptasi; atribusi + lisensi turunan
  CC BY-SA 4.0.
- **robots.txt:** https://en.wikipedia.org/robots.txt — artikel `/wiki/...`
  diizinkan (kecuali `Special:`), tetapi `/w/` dan `/api/` disallowed.
  Crawl-delay tidak eksplisit untuk `*`.
- **API/dump:** dump resmi di https://dumps.wikimedia.org/; API MediaWiki ada
  tetapi path-nya di-disallow robots.
- **Rekomendasi:** **`allowed` untuk dump dan halaman artikel** dengan atribusi
  CC BY-SA 4.0; **`restricted` untuk API**. Jangan impor gambar.

### 3.14 Wikimedia Commons

- **URL:** https://commons.wikimedia.org/
- **Data:** gambar/media.
- **Lisensi:** **per berkas** (CC0, CC BY, CC BY-SA, public domain, dan sebagian
  non-free). Tidak ada lisensi seragam.
- **ToS/robots:** standar Wikimedia; API `/w/` disallowed untuk crawler.
- **Rekomendasi:** **`restricted`** — hanya berkas dengan lisensi eksplisit yang
  kompatibel, atribusi per gambar, dan catatan lisensi di `characters.image_*`.
  Jangan impor gambar non-free.

### 3.15 TMDB

- **URL/API:** https://www.themoviedb.org/documentation/api
- **Data:** metadata film/TV dan gambar. Tidak ada statistik tempur; untuk anime
  relevansinya marjinal.
- **Lisensi/ToS:** halaman terms mengembalikan **403**; tidak terverifikasi.
- **Share-alike:** tidak berlaku.
- **robots:** tidak terverifikasi.
- **Rekomendasi:** **`disabled`** — di luar lingkup; ToS tidak dapat dipastikan,
  dan gambar tetap milik pemegang hak.

### 3.16 Situs penerbit/portal resmi

- **Contoh:** situs Shueisha, Viz, Kadokawa, portal anime resmi.
- **Data:** teks kanon, sinopsis, kadang profil karakter.
- **Lisensi:** © penerbit; tidak ada lisensi terbuka untuk reproduksi bulk.
- **Share-alike:** tidak berlaku.
- **ToS/robots:** beragam; banyak yang melarang scraping.
- **Rekomendasi:** **`disabled`** untuk impor otomatis. Kutipan pendek untuk
  verifikasi editorial boleh, tetapi bukan basis dataset.

### 3.17 Kandidat yang sengaja tidak dipakai

- **Forum powerscaling** (termasuk forum VS Battles): milik pengguna, tanpa
  lisensi, dan menurut PRD §19.1 kelas `forum_user` tidak pernah menjadi fakta.
- **Situs bajakan/aggregator scan**: melanggar hak cipta; dilarang.
- **Dataset Kaggle/Hugging Face tanpa lisensi jelas**: tidak boleh dipakai
  sebelum ada review per-dataset; lisensi dataset sering tidak mencakup data
  hulu. Ini bukan kandidat sampai ada bukti lisensi.

---

## 4. Ringkasan lisensi vs robots (mengapa banyak yang gagal)

| Sumber | Lisensi mengizinkan? | robots/akses otomatis mengizinkan? | Hasil |
|---|---|---|---|
| VS Battles / Fandom | Ya (CC BY-SA, dengan syarat) | Tidak terverifikasi (403), gerbang fail-closed | `restricted` |
| AniList | Terbatas (API ToS, bukan lisensi data) | Ya di host API; ToS melarang bulk | `restricted` |
| MAL | Tidak (nonkomersial) | Ya (404) | `disabled` |
| Jikan | Tidak (data MAL) | Tidak terverifikasi | `disabled` |
| Kitsu | Tidak jelas | Tidak (`/api/` disallow) | `disabled` |
| ANN | Terbatas (atribusi) | Tidak (`/encyclopedia/*` disallow) | `restricted` |
| AniDB | Tidak (no bulk) | Ya | `disabled` |
| Shikimori | Tidak jelas | Tidak (`/api/*`, query) | `disabled` |
| Wikidata | Ya (CC0) | Dump ya; API tidak | `allowed` (dump) |
| Wikipedia | Ya (CC BY-SA 4.0) | Artikel/dump ya; API tidak | `allowed` (dump/artikel) |

Pelajaran untuk implementasi: **jangan menyamakan "lisensi bebas" dengan "boleh
di-crawl"**. Dua gerbang berbeda; keduanya harus lolos. Ini juga alasan
`assertSourceUsable` memeriksa `legal_status`, `is_active`, dan `license`
sebelum fetch.

---

## 5. Implikasi share-alike (CC BY-SA 3.0/4.0)

Bagian ini yang paling menentukan bentuk produk. Bila tidak diterima, jangan
memakai data Fandom/Wikipedia untuk statistik.

### 5.1 Kewajiban CC BY-SA

Untuk materi CC BY-SA 3.0 (Fandom/VS Battles) dan 4.0 (Wikipedia):

1. **Atribusi (BY).** Sebutkan judul, penulis/pemilik (komunitas wiki), sumber
   (URL halaman), dan lisensi (URL). Cantumkan pula perubahan yang dilakukan.
2. **ShareAlike.** Bila materi **diadaptasi** (diekstrak, dinormalisasi,
   dipetakan ke skema lain), adaptasi wajib dilisensikan di bawah lisensi yang
   sama. Untuk materi 3.0, adaptasi boleh memakai 3.0 atau 4.0; materi 4.0 tidak
   boleh "diturunkan" ke 3.0.
3. **Tanpa batasan tambahan.** Tidak boleh menambahkan syarat hukum/teknis
   (paywall, DRM, larangan menyalin) di atas materi yang sudah diberi lisensi.
4. **Lisensi tidak mencakup merek dagang, paten, atau hak pribadi.** Nama
   karakter dan logo tetap milik pemegang hak; gunakan secara nominatif, tanpa
   logo.
5. **Gambar tidak otomatis ikut.** Lisensi teks wiki tidak mencakup gambar;
   banyak gambar Fandom adalah fair use. Jangan impor gambar dari Fandom.

### 5.2 Apakah situs ini ikut "tertular"?

Secara praktis, yang terkena share-alike adalah **dataset turunan**, bukan seluruh
produk:

- Kode, desain, merek, dan fitur situs tidak menjadi CC BY-SA hanya karena
  menampilkan data CC BY-SA.
- Tetapi **data karakter/statistik yang diekstrak dan diubah** adalah adaptasi.
  Ia harus tersedia di bawah CC BY-SA, dapat diekstrak pengguna, dan tidak boleh
  dibatasi secara tambahan.
- Menyimpan data itu di samping karya lain di situs yang sama adalah
  "koleksi/aggregasi"; batas antara koleksi dan adaptasi bergantung pada seberapa
  besar perubahan dan seberapa terpisah datanya. Karena kita memetakan tier,
  scale_code, ability, dan confidence, posisi aman adalah **memperlakukan dataset
  sebagai adaptasi CC BY-SA**.
- **Hak database (sui generis)** tidak otomatis dilisensikan oleh CC. Di EU,
  Fandom dapat memiliki hak database atas ekstraksi substansial; di Indonesia
  tidak ada hak sui generis setara, tetapi kontrak/ToS tetap berlaku. Ini harus
  dikonfirmasi penasihat hukum.

### 5.3 Konsekuensi konkret untuk produk

Bila memakai data CC BY-SA (Fandom/Wikipedia):

- Situs **boleh komersial** (CC BY-SA tidak melarang penjualan/iklan).
- Tetapi **tidak boleh** mengklaim kepemilikan eksklusif atas data turunan, dan
  **tidak boleh** menaruh data itu di balik paywall/DRM.
- Harus ada **atribusi per baris/karakter** (bukan hanya footer), plus lisensi
  dan tautan sumber. Kolom yang sudah ada — `character_sources.license`,
  `license_url`, `attribution_text`, dan `source_url` per baris — adalah tempat
  yang benar.
- Harus ada pernyataan **"perubahan dilakukan"** (normalisasi, pemetaan tier,
  confidence) di halaman sumber/atribusi.
- Bila pengguna meminta salinan dataset, kita harus bisa menyediakannya di bawah
  CC BY-SA. Ini keputusan produk: ekspor JSON publik, atau setidaknya tersedia
  atas permintaan.
- **Tidak boleh** memakai lisensi CC untuk menyiratkan endorsement sumber.

### 5.4 Pilihan yang tersedia (harus dipilih manusia)

| Pilihan | Konsekuensi | Status |
|---|---|---|
| A. Terima CC BY-SA 3.0/4.0 untuk dataset turunan | Bisa memakai Fandom/Wikipedia dengan atribusi; data turunan terbuka; tidak ada paywall data | butuh persetujuan |
| B. Tolak share-alike | Tidak boleh memakai teks/statistik Fandom/Wikipedia; butuh lisensi komersial atau dataset milik sendiri | butuh anggaran |
| C. Hanya metadata CC0 (Wikidata) + statistik editorial sendiri | Tidak ada share-alike; tetapi statistik editorial harus punya sumber/verifikasi, dan "no fabricated stats" tetap berlaku | butuh proses editorial |

Rekomendasi teknis: **A** untuk gelombang pertama, karena jalur dataset terkurasi
sudah ada dan atribusi sudah terpasang. Tetapi ini keputusan legal/bisnis.

---

## 6. Robots vs API: temuan yang mengikat implementasi

1. **Gerbang repo berlaku untuk setiap fetch**, termasuk API. `runFromUrl`
   memanggil `RobotsGate.allows()` sebelum fetch; status selain 200/404/410
   dianggap gagal tertutup. Karena itu:
   - Fandom (403) → **tidak bisa** di-fetch otomatis.
   - Kitsu (`/api/` disallow) → **tidak bisa**.
   - ANN (`/encyclopedia/reports*`, `api.xml` disallow) → **tidak bisa**.
   - Wikidata/ Wikipedia API (`/w/`, `/api/`, `/sparql`) → **tidak bisa**.
2. **Jangan menambahkan pengecualian robots** untuk "API resmi" tanpa keputusan
   tertulis. Bila nanti diputuskan bahwa API resmi tunduk pada ToS API dan bukan
   robots, pengecualian itu harus sempit (host + path + hanya metode API),
   didokumentasikan, dan diuji. Jangan memalsukan User-Agent.
3. **Dump bukan crawl.** `dumps.wikimedia.org` tidak menyajikan robots.txt (404),
   sehingga gerbang mengizinkannya; lisensi dump jelas. Ini jalur otomatis yang
   paling bersih.
4. **403 bukan 404.** Fandom mengembalikan 403 untuk robots; artinya kita tidak
   tahu aturannya. Fail-closed adalah perilaku yang benar.

---

## 7. Ketersediaan dump/API resmi (ringkas)

| Sumber | Dump resmi | API resmi | Catatan |
|---|---|---|---|
| Wikidata | Ya (bulanan, CC0) | Ya (tapi robots menolak `/w/`, `/sparql`) | 103,6 GB JSON / 43,6 GB truthy (terkompresi) — offline |
| Wikipedia | Ya (CC BY-SA 4.0) | Ya (robots menolak `/w/`, `/api/`) | gunakan dump/artikel, bukan API |
| Fandom | **Tidak** | MediaWiki API (tanpa izin bulk) | `Special:Export` bukan dump |
| AniList | **Tidak** | GraphQL (ToS melarang bulk) | bukan pengganti database |
| MAL | Tidak | Ya (nonkomersial, tanpa karakter) | tidak memenuhi kebutuhan |
| Jikan | Tidak | REST tidak resmi | data MAL |
| Kitsu | Tidak dikonfirmasi | JSON:API | robots menolak `/api/` |
| ANN | Tidak | API (robots menolak path) | atribusi + 1 rps |
| AniDB | **Tidak** (policy) | Ya (registrasi) | bulk dilarang |
| Shikimori | Tidak | Ya (robots menolak) | mirror MAL |

---

## 8. Rekomendasi arsitektur impor gelombang 1 (belum diimplementasikan)

Ini bukan Langkah 1; ini konsekuensi dari temuan di atas, untuk disetujui.

1. **Metadata/identitas/alias:** adapter pertama yang layak adalah **Wikidata
   dump** (CC0) — bukan API live. Filter offline berdasarkan Q-id karakter/verse
   yang sudah dikurasi; hasilnya dipakai untuk alias dan relasi, bukan statistik.
2. **Deskripsi/teks:** Wikipedia dump/artikel dengan atribusi CC BY-SA 4.0;
   opsional, bukan blocker.
3. **Statistik tempur:** **tidak ada sumber otomatis yang lolos.** Jalur yang
   tersisa adalah dataset terkurasi (`admin-dataset-import`) dari wiki CC BY-SA,
   seperti `docs/datasets/one-punch-man.json`, dengan:
   - `license` + `license_url` + `attribution` per dataset;
   - `source_url` per karakter/baris;
   - catatan perubahan;
   - review manusia per verse.
4. **Worker:** impor besar (dump/filter/200 karakter) dijalankan di
   `worker/ingest.ts` sebagai proses terpisah, dengan batching/resume/backoff.
   `/api/cron/sync` hanya memicu/mengklaim job — tidak menjalankan impor besar
   di serverless.
5. **Refresh MV** setelah impor besar, lewat jalur yang sudah ada
   (`scripts/refresh-mv.mjs` / job `refresh-views`), bukan di request pengguna.

Konsekuensi jujur: target **≥ 200 karakter dari ≥ 10 verse** tidak bisa dicapai
hanya dengan mengaktifkan adapter. Ia butuh kerja kurasi manusia per verse
(atau lisensi komersial). Dokumen ini tidak mengarang estimasi waktu.

---

## 9. Perubahan registry yang diusulkan (belum diterapkan)

Tidak ada SQL yang dijalankan pada Langkah 0. Usulan baris `sources` setelah
persetujuan:

| slug | source_type | legal_status | is_active | license | Syarat |
|---|---|---|---|---|---|
| `vs-battles-wiki` | `wiki` | `restricted` | `false` | `CC BY-SA 3.0` | hanya dataset terkurasi |
| `character-stats-profiles` | `wiki` | `restricted` | `false` | `CC BY-SA 3.0` (verifikasi) | hanya dataset terkurasi |
| `all-fiction-battles` | `wiki` | `restricted` | `false` | `CC BY-SA 3.0` (verifikasi) | hanya dataset terkurasi |
| `anilist` | `api` | `restricted` | `false` | `API-ToS` | metadata, non-bulk, < $150/bln |
| `anime-news-network` | `api` | `restricted` | `false` | `ANN-API-ToS` | metadata, atribusi, konflik robots diselesaikan |
| `wikidata-dump` | `dataset` | `allowed` | `false` | `CC0` | aktif setelah sign-off; dump offline; atribusi sopan |
| `wikipedia-dump` | `dataset` | `allowed` | `false` | `CC BY-SA 4.0` | aktif setelah sign-off; dump/artikel; atribusi |
| `myanimelist` | `api` | `disabled` | `false` | `null` | nonkomersial; tanpa karakter |
| `jikan` | `api` | `disabled` | `false` | `null` | data MAL |
| `kitsu` | `api` | `disabled` | `false` | `null` | robots `/api/` |
| `anidb` | `api` | `disabled` | `false` | `null` | bulk dilarang |
| `shikimori` | `api` | `disabled` | `false` | `null` | robots `/api/*` |

Catatan: `sources_active_requires_review` menuntut `legal_reviewed_at` bila
`is_active`; baris `allowed` di atas baru boleh aktif setelah kolom itu diisi
dan ditandatangani. Baris `restricted` tetap `is_active = false` sampai ada
izin/verifikasi.

---

## 10. Keputusan manusia yang dibutuhkan (blocking)

Langkah 1 tidak boleh dimulai sebelum lima hal ini dijawab:

1. **Status komersial.** Apakah situs akan mencari pendapatan (iklan,
   donasi, langganan)? AniList hanya gratis bila pendapatan < $150/bulan;
   MAL hanya untuk penggunaan personal/nonkomersial.
2. **Share-alike.** Apakah dataset turunan bersedia dirilis di bawah
   CC BY-SA 3.0/4.0, dengan atribusi dan tanpa paywall/DRM? (Pilihan A/B/C di
   §5.4.)
3. **Penanggung jawab legal.** Siapa yang mengisi `legal_reviewed_by` dan
   `legal_reviewed_at` untuk setiap sumber `allowed`? Tanpa nama, status tidak
   boleh dinaikkan.
4. **Anggaran lisensi.** Apakah ada anggaran untuk lisensi komersial (AniList,
   dataset berbayar) bila pilihan B diambil?
5. **Akses Fandom/VS Battles.** Apakah akan ditempuh verifikasi manusia atas
   robots/ToS, atau surat izin? Tanpa itu, Fandom tetap `restricted` dan hanya
   boleh masuk lewat dataset terkurasi.

Pertanyaan tambahan (tidak memblokir gerbang, tetapi memblokir target 200):
apakah tim editorial mampu mengkurasi 10 verse dalam sprint ini, atau target
harus diturunkan sampai ada lisensi komersial?

---

## 11. Log verifikasi

Diambil 2026-11-04. Status HTTP adalah hasil permintaan langsung dari mesin ini;
403 berarti diakses dan **ditolak**, bukan di-bypass.

| URL | Status | Hasil |
|---|---|---|
| https://vsbattles.fandom.com/robots.txt | 403 | tidak terverifikasi |
| https://www.fandom.com/terms-of-use | 403 | tidak terverifikasi |
| https://www.fandom.com/licensing | 403 | hanya cuplikan pencarian |
| https://vsbattles.fandom.com/wiki/VS_Battles_Wiki:Copyrights | — | cuplikan: CC BY-SA 3.0 |
| https://myanimelist.net/robots.txt | 200 | disallow `/about`, bot AI; sitemap |
| https://myanimelist.net/about/terms_of_use | 200 | personal, nonkomersial |
| https://myanimelist.net/apiconfig/references/api/v2 | 200 | tanpa endpoint karakter |
| https://api.myanimelist.net/robots.txt | 404 | tanpa batasan |
| https://docs.anilist.co/guide/terms-of-use | 200 | kutipan komersial/bulk |
| https://docs.anilist.co/guide/rate-limiting | 200 | 90/menit; degradasi 30/menit |
| https://anilist.co/robots.txt | 200 | disallow `/api/`, `/graphql` |
| https://graphql.anilist.co/robots.txt | 200 | allow `/`, bot AI disallow |
| https://hummingbird-me.github.io/api-docs/ | 200 | docs Apache 2.0; tanpa lisensi data |
| https://kitsu.io/robots.txt | 200 | disallow `/api/` |
| https://kitsu.app/terms | — | tidak ada teks terbaca |
| https://docs.api.jikan.moe/ | 200 | "Unofficial MyAnimeList API" |
| https://api.jikan.moe/robots.txt | — | permintaan gagal |
| https://www.animenewsnetwork.com/encyclopedia/api.php | 200 | atribusi + 1 rps |
| https://www.animenewsnetwork.com/robots.txt | 200 | disallow `/encyclopedia/api.xml`, `/encyclopedia/reports`; crawl-delay 2 |
| https://cdn.animenewsnetwork.com/robots.txt | 200 | mengarah ke robots www |
| https://www.animenewsnetwork.com/copyright-policy | 200 | © ANN; izin terbatas |
| https://anidb.net/policy | 403 | cuplikan: no bulk, no dumps |
| https://anidb.net/robots.txt | 200 | allow `/` |
| https://shikimori.one/robots.txt | 200 | disallow `/api/*`, `/*?` |
| https://www.wikidata.org/wiki/Wikidata:Licensing | 200 | CC0 untuk structured data |
| https://www.wikidata.org/robots.txt | 200 | disallow `/w/`, `/api/`, `Special:` |
| https://query.wikidata.org/robots.txt | 200 | disallow `/sparql`, `/bigdata` |
| https://dumps.wikimedia.org/wikidatawiki/entities/ | 200 | dump bulanan; ukuran teramati |
| https://en.wikipedia.org/wiki/Wikipedia:Copyrights | 200 | CC BY-SA 4.0; gambar beda |
| https://en.wikipedia.org/robots.txt | 200 | `/w/`, `/api/` disallow; artikel allow |
| https://creativecommons.org/licenses/by-sa/3.0/deed.en | 200 | deed CC BY-SA 3.0 |
| https://www.themoviedb.org/documentation/api/terms-of-use | 403 | tidak terverifikasi |

---

## 12. Sign-off

Gerbang ini belum ditandatangani. Isi dan ubah status hanya setelah keputusan
di §10 diambil.

| Peran | Nama | Tanggal | Keputusan |
|---|---|---|---|
| Product owner | | | |
| Legal reviewer | | | |
| Engineering lead | | | |

Setelah ditandatangani:

1. Terapkan baris `sources` yang disetujui (migration/seed, bukan edit manual
   produksi).
2. Baru mulai Langkah 1: adapter pertama (Wikidata dump) + perbaikan jalur impor
   (alias, multi-form, `scale_code`, validator 4 metrik, worker, refresh MV).
3. Gelombang 200 karakter hanya setelah dataset per verse disetujui.
