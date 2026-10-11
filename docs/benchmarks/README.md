# Benchmark pencarian (Phase 6)

Berkas di direktori ini adalah **bukti pengukuran**, bukan klaim tentang produksi.

| Berkas | Isi |
| --- | --- |
| `search-10k.md` | Keluaran `npm run bench:search` (20 ulangan per query) + `explain (analyze, buffers)` untuk query terberat. |

## Cara menjalankan

```bash
npm run bench:search -- --runs 20 --out docs/benchmarks/search-10k.md
# hanya rencana eksekusi:
npm run bench:search -- --plans-only
# satu kelompok kasus saja:
npm run bench:search -- --only "filter verse"
```

Skrip membuat database **PGlite** baru di memori, memuat `docs/schema.sql` sungguhan,
lalu mengisi 10.000 karakter sintetis berlabel (`bench-*`, sumber `bench-synthetic`)
beserta 11.982 form, 3.338 alias, 6.000 statistik, 1.500 ability, dan 500 resistensi.
Query yang diukur adalah fungsi halaman yang sebenarnya dari `src/features/**` —
bukan SQL yang ditulis ulang di skrip. Tidak ada baris sintetis ini yang pernah
masuk katalog produksi.

## Batas kejujuran

PGlite berjalan di proses Node yang sama: tanpa jaringan, tanpa SSL, dan tanpa
statistik planner yang sama dengan Supabase (PostgreSQL 17.11). Karena itu angka di
`search-10k.md` adalah **batas bawah relatif** untuk membandingkan bentuk query dan
memeriksa pemakaian index — **bukan** prediksi latency produksi dan bukan bukti
bahwa target PRD (< 200 ms) sudah tercapai pada data nyata.

## Hasil pokok (10.000 baris sintetis, PGlite)

| Kelompok query | p50 | Catatan |
| --- | ---: | --- |
| Pencarian selektif (nama/alias/typo/prefiks/CJK) | 561–654 ms | 3 baris cocok dari 10.000 |
| Pencarian luas (`benchmark` → 10.000 baris) | 924 ms | seluruh tabel lolos pencocokan |
| Pencarian + filter verse | 53 ms | filter verse memakai index dan memangkas kandidat |
| Daftar/detail/form/statistik/ability/verse | 1,3–29 ms | |
| `battle_dataset` (2 form) | 18 ms | satu round-trip untuk simulasi |

Temuan yang dapat ditindaklanjuti: pada query **luas**, waktu didominasi perhitungan
skor trigram per baris kandidat, dan rencana eksekusi RPC tidak memakai
`idx_characters_name_trgm`/`idx_aliases_trgm_norm` — index itu hanya terpakai bila
predikatnya berdiri sendiri (`probe index trigram pada characters` di berkas hasil).
Artinya biaya pencarian naik sebanding jumlah baris yang cocok, bukan jumlah baris
yang ditampilkan.

## Percobaan yang ditolak (dicatat supaya tidak diulang)

Karena rencana di atas, `search_characters` dan `search_characters_page` sempat
ditulis ulang menjadi prefilter kandidat ber-`union` (tiga cabang index-usable:
`search_vector`, trigram/prefiks nama, trigram/prefiks alias). Hasil pengukuran pada
dataset yang sama:

| Bentuk | Pencarian selektif | Pencarian luas (`benchmark`, 10.000 baris) |
| --- | ---: | ---: |
| `or` tunggal (dipakai sekarang) | 654 ms | 924 ms |
| prefilter `union` | 435 ms (−33%) | **35.251 ms (×38 lebih lambat)** |

Prefilter itu mempercepat kasus selektif tetapi membuat kasus luas 35 detik, jadi
perubahan **dibatalkan** (fungsi di `docs/schema.sql` identik dengan yang berjalan di
produksi; `npm run check:schema-drift` nol drift untuk objek milik berkas).

Langkah berikutnya sebelum mengubah RPC lagi: jalankan varian kueri terhadap Postgres
sungguhan dengan statistik nyata (`explain (analyze, buffers)` pada database berisi
data, bukan PGlite), lalu putuskan berdasarkan angka di sana — bukan di harness ini.

Reproduksi: `sed -n '/^## Benchmark/,/^## /' docs/benchmarks/search-10k.md`.
