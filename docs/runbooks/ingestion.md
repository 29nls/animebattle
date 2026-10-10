# Runbook — Ingestion

**Status:** aktif (ditulis bersama implementasi pipeline, Sprint 2/3). Diuji pada
environment lokal (PGlite, `docs/schema.sql` + `docs/seed.sql`) lewat
`npm run test:ingestion`, dan **sudah dijalankan sekali pada instance Supabase
produksi (2026-10-10)**: impor dataset terkelola lewat jalur panel (`POST
/api/admin/ingestion/import`) → worker (`GET /api/cron/sync`) → 73 baris kanonik
(1 verse, 3 karakter, 3 form, 27 statistik, 13 ability, 13 resistance) tanpa
kegagalan per record; menjalankan ulang dataset yang sama menghasilkan
`records_created = 0`; atribusi per karakter terisi di `character_sources`; dan
halaman `/characters`, `/verses`, `/character/*`, `/verse/*` dirender dari data
itu. Empat bug yang hanya muncul di driver sungguhan ditemukan pada jalur ini
(jsonb staging tersimpan sebagai string, empat kolom query detail tidak ada di
DDL, `battle_dataset` mengembalikan satu jsonb — bukan setof baris — dan
`timestamptz` kembali sebagai `Date`). Bukti ringkas ada di
[README §Verifikasi](../../README.md#verifikasi).

Dipicu oleh, salah satu saja:

- job berstatus `failed` atau `partial` di `/admin/ingestion`;
- error rate satu sumber > 10% selama 3 run berturut-turut;
- backlog `pending` > 500 job.

## 1. Membaca keadaan dalam 30 detik

```bash
npm run test:ingestion        # kontrak pipeline di atas skema nyata (28 uji)
node worker/ingest.ts         # kerjakan satu job (friendlier untuk manual)
```

Di panel admin (`/admin` → *Ingestion Jobs*):

| Yang dilihat | Artinya |
|---|---|
| `pending` | Menunggu worker. Jika lama, worker/cron belum berjalan — bukan masalah datanya. |
| `processing` | Sedang dikerjakan worker. Job ini tidak dapat di-retry/cancel dari UI. |
| `completed` | Selesai; `records_failed = 0`. |
| `partial` | Sebagian record gagal; detail per record ada di panel error job itu. |
| `failed` | Terminal atau jatah retry habis. Lihat `error_type`. |
| `skipped` | Dibatalkan operator. |

Kolom `retry_count/max_retries` menjelaskan sudah berapa kali dicoba. Kolom
`next_attempt_at` menjelaskan **kapan** job akan dicoba lagi (backoff eksponensial
2^n detik, dihormati bila sumber mengirim `Retry-After`).

## 2. Triase menurut `error_type`

| `error_type` | Sifat | Tindakan |
|---|---|---|
| `RateLimited` (429) | Sementara | Biarkan backoff berjalan. Jika berulang: turunkan `sources.rate_limit_rps` sumber itu satu tingkat. |
| `SourceUnavailable` (5xx/timeout/DNS) | Sementara | Cek status sumber dari luar dulu. Retry setelah sumber pulih. |
| `ParserError` pada data **staged** | Terminal | Isi dataset memang tidak sah. Perbaiki dataset, impor ulang. Jangan retry. |
| `ParserError` pada **respons fetch** | Sementara | Sumber mengirim isi rusak (mis. halaman error HTML). Retry; bila 3× berulang, nonaktifkan adapter sumber. |
| `PolicyBlocked` | Terminal | `robots.txt` melarang, allow-list tidak cocok, alamat privat/SSRF, sumber non-`allowed`, atau lisensi kosong. **Jangan** retry; perbaiki kebijakan/registry sumber atau jangan impor dari sana. |
| `InvalidData` / `MissingRequiredField` | Per record | Satu record ditolak (skala, kategori ability, tipe resistensi, atau level 4 tanpa bukti). Lihat `ingestion_errors.payload`. |
| `DuplicateCharacter` | Per record | Kunci unik bentrok (`slug`/verifikasi unik). Periksa apakah dua sumber memetakan karakter yang sama — itu urusan *merge*, bukan retry. |

## 3. Tindakan yang aman

**Retry** (tombol di baris job, atau API):

```bash
curl -X POST "$SITE/api/admin/ingestion/jobs/<job-id>/retry" \
     -H "authorization: Bearer $ADMIN_INGESTION_SECRET"
```

- Aman untuk kegagalan sementara. Pipeline **idempoten**: mengulang tidak
  menambah karakter/form/statistik (AC-08).
- `retry_count` tidak direset — riwayat percobaan tetap terlihat.
- Tidak tersedia untuk job `processing` (tidak ada cara menghentikan worker yang
  sedang memegangnya dengan aman).

**Reparse dari staging** (tanpa fetch ulang): enqueue job `reparse` dengan
`target_ref` = id baris `ingestion_raw_pages`.

```bash
curl -X POST "$SITE/api/admin/ingestion/import" \
     -H "authorization: Bearer $ADMIN_INGESTION_SECRET" \
     -H 'content-type: application/json' \
     -d '{"scope":"reparse","target_ref":"<raw-page-id>"}'
```

Ini jalur yang benar saat parser naik versi: data mentah sudah tersimpan,
tidak ada permintaan baru ke sumber.

**Cancel** (tombol): hanya untuk `pending`/`failed`/`partial`. Job menjadi
`skipped` dan tidak akan diklaim worker.

**Dry-run**: impor dataset dengan centang *Dry-run*. Worker menjalankan seluruh
pemeriksaan dan pembacaan, melaporkan `records_*`, tetapi **tidak menulis** — termasuk
tidak menulis `ingestion_errors`.

## 4. Yang TIDAK boleh dilakukan

1. **Jangan memperbesar `rate_limit_rps` saat sumber mengembalikan 429.** Yang
   benar adalah mengecilkannya; menaikkannya menghasilkan blokir IP.
2. **Jangan retry `PolicyBlocked`.** Ia tidak akan berubah: sifatnya keputusan,
   bukan gangguan.
3. **Jangan mengedit baris `statistics` secara manual** untuk "memperbaiki" hasil
   impor. Impor ulang menulis baris `current` baru dan menandai yang lama
   `superseded`; mengeditnya menghapus jejak (D6).
4. **Jangan menghapus baris `ingestion_errors`** sebelum masalahnya selesai —
   `payload` di sana satu-satunya cara mereproduksi bug parser offline (VA-3).
5. **Jangan menjalankan ingestion dari jalur request.** Semua penjadwalan lewat
   `worker/ingest.ts`, `GET /api/cron/sync`, atau tombol admin (yang hanya
   mengantrikan). Lint arsitektur menolak impor `services/ingestion/*` dari
   `app/**` non-cron dan `src/features/**` (AC-25).

## 5. Batas yang diketahui (jujur)

1. **Adapter crawling belum ada.** Scope `scheduled_full`/`incremental`/`manual_run`
   menerapkan **staging terbaru per sumber** (idempoten, tanpa fetch baru). Bila
   belum ada staging, hasilnya 0 record dan `notes` menyatakannya — bukan angka
   nol yang menyamar sebagai pekerjaan.
2. **Cache `robots.txt` per proses.** Worker yang dijalankan sebagai proses satu
   job tidak punya cache 24 jam antar-job; TTL 24 jam baru berlaku bila worker
   dijalankan sebagai proses panjang. Solusi produksi: worker persisten atau KV;
   belum dipasang.
3. **Rate limiter per proses**, bukan lintas worker. Konkurensi worker harus
   dijaga ≤ 2 per host lewat orkestrasi (cron tunggal / supervisor). Bila nanti
   ada banyak worker paralel, limiter harus dipindahkan ke DB/KV.
4. **Tanpa transaksi per job.** `SqlClient` hanya punya `query`; kegagalan di
   tengah meninggalkan sebagian baris. Karena itu pemulihannya adalah **impor
   ulang** — dan itu aman karena idempoten.
5. **`ingestion_raw_pages` disimpan 90 hari** (`expires_at`); `purge_expired_staging()`
   menghapus yang kedaluwarsa. Re-parse setelah itu perlu fetch ulang.

## 6. Verifikasi setelah tindakan

```bash
curl "$SITE/api/admin/ingestion/jobs?status=failed" -H "authorization: Bearer $ADMIN_INGESTION_SECRET"
curl "$SITE/api/admin/ingestion/jobs/<job-id>/errors" -H "authorization: Bearer $ADMIN_INGESTION_SECRET"
curl "$SITE/api/admin/metrics" -H "authorization: Bearer $ADMIN_INGESTION_SECRET"
```

Berhasil bila: job berpindah status sesuai tindakan (`pending` setelah retry,
`completed`/`partial` setelah dikerjakan), `records_created` masuk akal terhadap
jumlah record di dataset, dan `/admin/metrics` menunjukkan karakter/form
bertambah — atau **tidak** bertambah ketika mengulang dataset yang sama.
