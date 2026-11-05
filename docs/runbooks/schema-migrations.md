# Runbook: Migrasi Schema `animebattle`

> Status: ditulis 2026-11-04. Jalur CI (migrasi dari nol + drift + verifikasi
> Postgres) sudah terpasang di `.github/workflows/ci.yml`; **belum pernah
> dijalankan di runner GitHub** karena repo ini belum menerima push pada sesi
> tersebut. Perubahan pada instance produksi **belum** dilakukan dan menunggu
> persetujuan manusia (lihat §5).

## 1. Keputusan isolasi

Instance Supabase yang dipakai sekarang memiliki schema `public` bersama
aplikasi lain (`guild_config`, `ticket`, `moderation_case`, dan seterusnya).
Objek Anime VS Battle dipindahkan ke schema khusus **`animebattle`**:

- tabel, tipe enum, fungsi, view, materialized view, trigger, index, dan policy
  RLS semuanya di `animebattle`;
- ekstensi (`pg_trgm`, `unaccent`, `pgcrypto`) tetap di `public` — Postgres
  mengelola ekstensi di schema tempat ia dipasang, dan memindahkannya akan
  memutus fungsi yang sudah ada;
- aplikasi memakai `search_path = animebattle, public` pada **setiap koneksi**
  (`src/lib/db/client.ts`, opsi startup `connection.search_path`), bukan
  `set search_path` sekali pada satu koneksi pool;
- grant eksplisit untuk `anon`/`authenticated` ada di
  `migrations/0002_grants_animebattle.sql`; `EXECUTE` fungsi pemeliharaan
  dicabut dari `PUBLIC`.

**Batas yang jujur.** Schema terpisah mencegah tabrakan nama dan membuat grant
per-aplikasi mungkin. Ia **bukan** batas keamanan penuh terhadap kredensial
aplikasi: role `postgres` (yang dipakai `DATABASE_URL` sekarang) tetap dapat
membaca `public` dan melewati RLS. Isolasi penuh memerlukan **project Supabase
terpisah** (atau role khusus dengan grant hanya ke `animebattle`). Rekomendasi
produksi: project terpisah; schema `animebattle` adalah langkah yang sudah
diterapkan di repo ini dan aman untuk deployment baru.

## 2. Struktur migrasi

```
migrations/
  0001_schema_animebattle.sql   # DDL: schema, tabel, fungsi, RLS, trigger
  0002_grants_animebattle.sql   # grant/revoke untuk anon + authenticated
docs/schema.sql                 # snapshot lengkap untuk baseline & drift
docs/seed.sql                   # data konfigurasi (idempoten, terpisah)
```

Aturan:

1. Migrasi **hanya maju** dan tidak boleh mengubah migrasi yang sudah pernah
   diterapkan. Runner menyimpan `version` + `checksum` (sha256, normalisasi
   CRLF→LF) di `animebattle.schema_migrations`; checksum yang berubah pada
   migrasi lama membuat runner berhenti.
2. Setiap migrasi dijalankan dalam transaksi oleh `scripts/migrate.mjs`, dengan
   advisory lock agar dua deploy tidak berlomba. Jangan menulis `begin;`/
   `commit;` di dalam berkas migrasi.
3. `docs/schema.sql` adalah snapshot, bukan jalur deploy. Setiap perubahan DDL
   harus masuk ke migrasi **dan** snapshot; `npm run check:schema-drift`
   membandingkan keduanya.
4. Seed dijalankan terpisah (`npm run seed:db`) dan harus idempoten.

## 3. Perintah lokal / CI

```bash
npm run migrate          # terapkan semua migrasi yang belum tercatat
npm run db:status        # daftar migrasi + checksum yang tercatat
npm run seed:db          # seed konfigurasi (boleh diulang)
npm run check:schema-drift   # docs/schema.sql vs database (butuh DATABASE_URL)
npm run verify:postgres      # RLS JWT + REFRESH CONCURRENTLY (Postgres nyata)
npm test                     # termasuk tests/db (migrasi vs snapshot + parser)
```

`DATABASE_URL` dibaca dari `.env`; di CI nilainya datang dari service container
`postgres:16`. `--env-file-if-exists` membuat perintah tetap jalan di runner
tanpa `.env`.

Job CI yang menguji jalur ini:

- `database` — `npm run migrate` dari database kosong → `check:schema-drift` →
  `verify:postgres` (RLS berbasis `request.jwt.claims` dan tiga
  `REFRESH MATERIALIZED VIEW CONCURRENTLY`);
- `backup-restore` — `pg_dump`/`pg_restore` ke database terpisah, lalu
  `verify:restore`.

## 4. Rollout produksi yang tidak menyentuh aplikasi lain

**Jangan** menjalankan `drop schema public`, `alter table ... set schema` pada
tabel yang sudah dipakai, atau `pg_dump --schema=public` tanpa filter: ketiganya
dapat menyentuh atau menghapus objek aplikasi lain.

Rencana yang disetujui secara teknis (belum dieksekusi):

1. **Bekukan penulisan** (ingestion worker + cron) dan catat waktu mulai.
2. **Backup penuh** sesuai [`backup-restore.md`](backup-restore.md); simpan
   restore drill yang sudah lulus.
3. **Rehearsal**: pulihkan backup ke database scratch, terapkan migrasi di sana,
   jalankan `check:schema-drift` + `verify:postgres` + seluruh gate. Jangan
   lanjut bila ada drift.
4. **Opsi A (direkomendasikan): project Supabase baru.** Buat project, isi
   `DATABASE_URL` baru, jalankan migrasi dari nol, lalu salin **hanya** data
   aplikasi. Cara paling aman: dump per-tabel dari daftar 37 tabel di
   `docs/schema.sql` (jangan seluruh schema `public`), restore ke project baru,
   lalu jalankan `npm run seed:db`. Verifikasi jumlah baris per tabel sebelum
   cutover.
5. **Opsi B (in-place, hanya dengan persetujuan tertulis):** buat schema
   `animebattle`, terapkan `0001` + `0002`, salin data dengan `insert into
   animebattle.<tabel> select ... from public.<tabel>` dalam urutan FK, lalu
   verifikasi. Jangan memindahkan objek; biarkan tabel lama tetap ada sebagai
   arsip sampai cutover dinyatakan stabil. Ini tetap memakai role/kredensial
   yang sama, jadi bukan isolasi penuh.
6. **Cutover**: ubah `DATABASE_URL` ke database/schema baru, deploy, lalu
   jalankan `npm run check:schema-drift` dan smoke test (`/api/health/ready`,
   `/characters`, `/api/search?q=...`, satu simulasi).
7. **Sesudah cutover**: pantau error 5xx dan job ingestion minimal 24 jam.
   Setelah itu baru pertimbangkan menghapus tabel lama (dengan backup baru).

## 5. Rollback

Rollback harus direncanakan **sebelum** cutover.

| Keadaan | Tindakan |
|---|---|
| Migrasi gagal sebelum commit | Runner rollback transaksi otomatis; perbaiki migrasi di PR baru, jangan edit migrasi lama. |
| Aplikasi sudah deploy tetapi query gagal | Kembalikan `DATABASE_URL` ke database lama (Opsi A) atau set `search_path` lama (Opsi B), deploy ulang. Database lama tidak dihapus. |
| Data rusak setelah migrasi | Hentikan penulisan, restore snapshot/PITR ke database **baru**, verifikasi dengan `verify:restore`, lalu cutover. Jangan menimpa database produksi secara langsung. |
| Migrasi merusak objek aplikasi lain | Itu pelanggaran prosedur; hentikan, pulihkan backup penuh, dan buka insiden. Jangan mencoba memperbaiki dengan `drop`/`alter` tambahan. |

Rollback **bukan** `down migration`: repo ini tidak menyediakan migrasi mundur
otomatis karena drop kolom/tabel dapat menghilangkan data. Perbaikan yang salah
dilakukan dengan migrasi maju (aditif) atau restore.

## 6. Hal yang tidak boleh dilakukan

- Menjalankan migrasi pada produksi tanpa backup yang sudah diuji restore.
- Mengubah `0001`/`0002` setelah pernah diterapkan (checksum akan gagal).
- Memberi `EXECUTE` fungsi pemeliharaan ke `anon`/`authenticated`.
- Memberi grant tabel tanpa policy RLS, atau sebaliknya.
- Menghapus schema `public` atau tabel aplikasi lain.
- Menganggap schema `animebattle` sebagai isolasi kredensial penuh.
