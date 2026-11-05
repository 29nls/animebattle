# Runbook: Backup & Restore

> Status: ditulis 2026-11-04. **Uji restore logis sudah terpasang sebagai job CI**
> `backup-restore` (Postgres 16: migrasi + seed → `pg_dump --format=custom` →
> `pg_restore` ke database terpisah → `npm run verify:restore`). Eksekusi di
> runner GitHub belum teramati pada sesi ini. **PITR tidak dapat diuji dari repo
> ini** karena memerlukan project Supabase dan dashboard/plan yang sesuai; lihat
> §4.

## 1. Tujuan

| Ukuran | Target | Catatan |
|---|---|---|
| RPO (kehilangan data maksimum) | ≤ 24 jam untuk dump harian; ≤ 5 menit bila PITR aktif | Tentukan saat onboarding; angka ini bukan janji sampai backup benar-benar berjalan |
| RTO (waktu pemulihan) | ≤ 60 menit untuk database ≤ 5 GB | Ukur saat restore drill, bukan diasumsikan |
| Retensi dump | 7 harian + 4 mingguan | Simpan di storage terpisah dari database |
| Uji restore | setiap perubahan skema besar, minimal bulanan | Backup yang belum pernah direstore bukan backup |

## 2. Backup logis (wajib, dapat diuji)

Prasyarat: `pg_dump`/`pg_restore` versi **sama atau lebih baru** dari server
(Postgres 16). Jangan memakai `pg_dump` dari mesin dengan versi lebih lama.

```bash
# 1) Dump seluruh database aplikasi (schema animebattle + public milik aplikasi
#    lain ikut terbawa bila memakai satu database; untuk isolasi penuh gunakan
#    project terpisah).
pg_dump "$DATABASE_URL" \
  --format=custom --no-owner --no-acl \
  --file="animebattle-$(date -u +%Y%m%dT%H%M%SZ).dump"

# 2) Periksa arsip dapat dibaca
pg_restore --list animebattle-*.dump | head -40

# 3) Simpan checksum dan ukuran
sha256sum animebattle-*.dump
```

Untuk dump **hanya objek Anime VS Battle** dari database bersama, gunakan daftar
tabel dari `docs/schema.sql` dan ulangi `--table=animebattle.<nama>`; jangan
memakai `--schema=public` karena akan menyalin tabel aplikasi lain. Uji daftar
itu di staging sebelum mengandalkannya.

Simpan dump di bucket dengan enkripsi at-rest, akses terbatas, dan lifecycle
retensi. Jangan menaruh dump di repo atau artefak publik CI.

## 3. Restore drill (wajib)

Restore selalu ke **database baru/scratch**, bukan menimpa produksi.

```bash
# 1) Buat database kosong (contoh lokal/CI)
createdb animebattle_restore

# 2) Restore
pg_restore --no-owner --no-acl \
  --dbname="postgres://…/animebattle_restore" \
  animebattle-YYYYMMDDTHHMMSSZ.dump

# 3) Bandingkan dengan sumber: migrasi, relasi, jumlah baris, fungsi, policy
SOURCE_DATABASE_URL="$DATABASE_URL" \
RESTORE_DATABASE_URL="postgres://…/animebattle_restore" \
npm run verify:restore
```

`verify:restore` membandingkan:

- `animebattle.schema_migrations` (versi + checksum);
- daftar tabel dan materialized view;
- **jumlah baris setiap relasi**;
- jumlah fungsi dan policy RLS.

Keluaran yang diharapkan: setiap baris `PASS`, lalu
`Restore identik dengan sumber.` dan exit 0. Bila ada `FAIL`, jangan menghapus
dump; simpan sebagai bukti dan ulangi dump/restore.

Lanjutkan drill dengan smoke test aplikasi terhadap database restore:

```bash
DATABASE_URL="postgres://…/animebattle_restore" npm run db:status
DATABASE_URL="postgres://…/animebattle_restore" npm run check:schema-drift
```

`check:schema-drift` membandingkan snapshot `docs/schema.sql` dengan database
hasil restore; ia juga memastikan `schema_migrations` tidak dianggap drift.

## 4. PITR (Supabase)

PITR memulihkan database ke titik waktu tertentu (bukan sekadar dump terakhir).
Langkahnya bergantung pada dashboard/plan project dan **tidak dapat dijalankan
dari repo ini**:

1. Pastikan PITR aktif untuk project (Supabase Dashboard → Database → Backups;
   ketersediaan bergantung plan/add-on).
2. Catat timestamp insiden dalam UTC dan rentang retensi yang tersedia.
3. Pulihkan ke **project baru** bila dashboard mengizinkan; jangan langsung ke
   produksi. Bila hanya restore in-place yang tersedia, hentikan penulisan dan
   ikuti instruksi dashboard dengan persetujuan manusia.
4. Setelah restore, jalankan `npm run check:schema-drift` dan `verify:restore`
   terhadap project pemulihan, lalu smoke test.
5. Dokumentasikan timestamp, hasil, dan selisih data yang tidak dapat dipulihkan.

**Batas jujur:** PITR tidak diuji dalam tugas ini; tidak ada kredensial/plan
Supabase yang tersedia. Jangan menulis "PITR terverifikasi" sampai drill benar-
benar dilakukan pada project nyata.

## 5. CI: uji restore otomatis

`.github/workflows/ci.yml` job `backup-restore`:

1. service container `postgres:16`;
2. `npm run migrate` + `npm run seed:db`;
3. `createdb`/`create database animebattle_restore`;
4. `pg_dump --format=custom --no-owner --no-acl`;
5. `pg_restore --no-owner --no-acl` ke database tujuan;
6. `npm run verify:restore` (exit 1 pada perbedaan sekecil apa pun).

Job ini membuktikan dump/restore logis, **bukan** PITR dan bukan backup
penyimpanan objek (Storage). Untuk Storage, gunakan backup bucket terpisah.

## 6. Jadwal dan pemantauan

- Dump harian: scheduler di luar repo (cron host/CI terjadwal) atau backup
  bawaan penyedia; catat keberhasilan ke monitoring.
- Verifikasi restore: minimal bulanan, dan **wajib** sebelum migrasi produksi.
- Alarm bila: dump tidak ada > 26 jam, ukuran turun > 30% tanpa penjelasan,
  `pg_restore --list` gagal, atau `verify:restore` gagal.
- Simpan tanggal drill terakhir di tabel status di bawah.

| Drill | Tanggal | Hasil | Oleh |
|---|---|---|---|
| Restore logis CI (Postgres 16) | belum dijalankan di runner | job terpasang | — |
| PITR Supabase | belum | belum diuji | — |

## 7. Yang tidak boleh dilakukan

- Menimpa database produksi dengan `pg_restore --clean` tanpa persetujuan dan
  backup baru.
- Menganggap dump berhasil hanya karena perintah exit 0; selalu `pg_restore
  --list` dan `verify:restore`.
- Menyimpan dump/connection string di repo, log, atau chat.
- Menghapus dump lama sebelum drill restore terbaru lulus.
