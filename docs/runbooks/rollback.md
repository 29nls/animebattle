# Runbook — Rollback Data

**Status:** aktif. Langkah SQL diuji di PGlite lokal dengan `docs/schema.sql` +
`docs/seed.sql` (2026-10-09); **belum** pernah dijalankan pada instance Supabase
produksi.

Dipicu oleh: data ingestion yang buruk sudah terlihat di produksi — statistik
salah di banyak halaman, impor yang menimpa nilai benar, atau kesalahan manual
yang diketahui setelah dieksekusi.

## 1. Membaca keadaan dalam 30 detik

Tentukan dulu **cakupan kerusakanannya**, karena itu menentukan jalur di §2:

```sql
-- job mana dan kapan? (angka records_* yang tidak masuk akal = titik mulai)
select id, source_id, scope, status, records_created, records_updated, records_failed,
       started_at, completed_at, error_type, error_message
  from ingestion_jobs
 order by completed_at desc nulls last limit 20;

-- sebaran status statistik — inti diagnosis
select status, count(*) from statistics group by status;
--    current     : yang tayang
--    superseded  : riwayat (D6) — inilah "nilai lama" untuk pemulihan
--    conflicting : belum diputuskan / sudah ditandukah konflik

-- statistik yang berubah dalam jendela waktu tertentu
select id, character_version_id, metric, source_id, status, raw_text, updated_at
  from statistics
 where updated_at between '<awal>' and '<akhir>'
 order by updated_at desc limit 50;
```

## 2. Memilih jenis rollback

| Situasi | Jalur | Bagian |
|---|---|---|
| Nilai salah pada sejumlah (form, metrik, sumber), nilai lama masih ada sebagai `superseded` | Rollback per-entitas dari riwayat `statistics` | §3.2 |
| Ada jejak `audit_logs` untuk perubahan yang mau dibatalkan | Balikkan memakai `before` | §3.1 |
| Seluruh run impor buruk, tetapi baris tidak dihapus | Tandai run itu + pulihkan dari riwayat | §3.3 |
| Baris **hilang** (terhapus), skema salah, atau kerusakan massal | **Restore backup** — rollback SQL tidak dapat menghidupkan apa yang sudah tidak ada | §5 |

## 3. Tindakan yang aman

### 3.1 Membalikkan perubahan per-entitas dari `audit_logs`

Kolom `before`/`after` menyimpan citra JSON lengkap baris sebelum dan sesudah
perubahan. Kembalikan field yang berubah dengan citra `before` baris terakhir:

```sql
begin;
update statistics s
   set raw_text   = b.before->>'raw_text',
       status     = (b.before->>'status')::stat_status_t,
       confidence = (b.before->>'confidence')::numeric,
       notes      = b.before->>'notes',
       updated_at = now()
  from (select before from audit_logs
         where entity_type = 'statistics' and entity_id = '<stat-id>'
         order by created_at desc limit 1) b
 where s.id = '<stat-id>';
commit;
```

Riwayat per-entitas untuk memutuskan **apa** yang dibalikkan:

```sql
select action, entity_type, entity_id, before, after, created_at
  from audit_logs
 where entity_id = '<entity-id>' or entity_id = '<slug>'
 order by created_at desc;
```

**Keadaan jujur:** belum ada kode yang menulis `audit_logs` (tabel + RLS + index
sudah ada; tidak ada satu pun penulis — lihat §7). Karena itu jalur §3.2 dari
riwayat `statistics` adalah jalur utama hari ini, dan menulis baris `audit_logs`
manual saat melakukan rollback adalah cara menjaga jejak agar jalur §3.1 ikut
terisi.

### 3.2 Rollback per-entitas: `superseded` → `current`

Urutan yang dipakai: **turunkan dulu, baru angkat**, dalam satu transaksi —
niat perubahan dibuat eksplisit dan pada akhirnya tetap tepat satu `current`:

> Fakta skema yang perlu diketahui: ada trigger `trg_statistics_supersede`
> yang begitu baris menjadi `current` otomatis menurunkan baris `current` lain
> pada triple (form, metrik, sumber) yang sama. Karena itu urutan terbalik pun
> tidak akan menghasilkan dua `current` (diuji, §9) — dan justru karena trigger
> itu bahaya sebenarnya di sini **bukan error**, melainkan pertukaran diam-diam
> bila baris yang dinaikkan ternyata salah; lihat §7 dan jalur gagal §4.

```sql
begin;
-- 1. nilai buruk (masih 'current') diturunkan — jangan dihapus
update statistics
   set status = 'superseded', updated_at = now()
 where id = '<id-nilai-buruk>' and status = 'current';

-- 2. nilai lama yang benar dinaikkan kembali
update statistics
   set status = 'current', updated_at = now()
 where character_version_id = '<form-id>' and metric = '<metric>'::stat_metric_t
   and source_id = '<source-id>' and status = 'superseded'
   and id = '<id-nilai-lama>';
commit;
```

Bila id nilai lama tidak diketahui, cari dari riwayat (baris `superseded` paling
baru untuk triple itu):

```sql
select id, raw_text, status, created_at, updated_at
  from statistics
 where character_version_id = '<form-id>' and metric = '<metric>'::stat_metric_t
   and source_id = '<source-id>'
 order by updated_at desc;
```

### 3.3 Rollback satu run impor

1. Catat jendela run dari `ingestion_jobs` (§1) — `started_at`/`completed_at`.
2. Untuk setiap (form, metrik, sumber) yang berubah di jendela itu, jalankan §3.2:
   nilai yang dibuat run buruk → `superseded`, nilai sebelumnya → `current`.
3. Bila run itu juga **menambah** karakter/form (bukan hanya menimpa), jangan
   menghapusnya di sini — kalau sudah pasti duplikat, jalurnya
   [merge.md](merge.md), bukan rollback.
4. Job-nya sendiri tidak perlu diulang; cukup pastikan `status`-nya `failed`
   agar tidak dikira sukses di panel (retry akan menulis ulang data yang sama).

### 3.4 Menulis jejak rollback

```sql
insert into audit_logs (action, entity_type, entity_id, before, after)
values ('rollback_statistics', 'statistics', '<stat-id>',
        jsonb_build_object('status', 'current', 'raw_text', '<nilai-buruk>'),
        jsonb_build_object('status', 'superseded', 'reason', '<alasan>', 'job', '<job-id>'));
```

## 4. Jalur gagal

| Langkah | Bila gagal | Yang dikerjakan |
|---|---|---|
| §3.1 mengenai 0 baris / `audit_logs` kosong | Memang belum ada penulisnya (§8) — jalur ini menunggu kode | Bukan kegagalan data; lanjutkan dengan §3.2 dari riwayat `statistics`. Jangan mengarang baris `audit_logs` untuk menutupinya |
| §3.1 jalan tapi nilai tetap salah | `before` tidak memuat kolom yang dipilih (citra parsial) | `select before from audit_logs where entity_id = '<stat-id>';` — periksa field yang tersedia; sisanya pulihkan dari riwayat `statistics` (§3.2) |
| §3.2 menaikkan baris yang **salah** | **Tidak ada error** — trigger `trg_statistics_supersede` menurunkan `current` yang benar diam-diam | §6 query 2: bila `raw_text` yang `current` bukan yang diharapkan, ulangi §3.2 dengan id yang benar (idempoten) |
| Transaksi §3.2/§3.3 gagal di tengah | Koneksi putus / peran bukan pemilik tabel (RLS aktif) | Rollback terjadi otomatis — tidak ada kondisi setengah-jalan. Ulangi blok yang sama dengan peran yang benar |
| Tidak ada baris `superseded` untuk dipromosikan | Nilai lama tidak pernah tersimpan (impor pertama) atau retensi sudah lewat | Rollback per-entitas tidak mungkin di sini → jalur restore backup (§5) |
| §3.4 insert `audit_logs` ditolak FK `actor_id` | `actor_id` menunjuk `users` yang tidak ada | Kosongkan `actor_id` (kolom nullable); jejak tetap lengkap lewat `action` + `entity_id` + `after` |
| Setelah semua langkah, angka hilang sama sekali dari halaman | Tidak ada baris `current` untuk triple itu | `select status, count(*) from statistics where character_version_id = '<form-id>' group by status;` — ada `superseded` → promosikan (§3.2); tidak ada sama sekali → §5 |
| §3.2 selesai tetapi halaman masih menampilkan nilai lama | Bukan data — cache/ISR | Muat ulang tanpa cache; bila masih salah, bandingkan `select raw_text, status from statistics where id = '<id>'` dengan yang tayang — kalau DB benar, masalahnya di query halaman, bukan di rollback |

## 5. Kapan restore backup lebih tepat

Pilih restore, bukan rollback per-entitas, bila **salah satu** berlaku:

- **Baris hilang.** Rollback hanya membalikkan kolom pada baris yang masih ada;
  `delete` yang sudah terjadi butuh backup (walau `statistics` lama masih
  menutupi kasus nilai tertimpa — yang hilang benar-benar hilang).
- **Skema salah.** Perubahan `docs/schema.sql` yang keliru diperbaiki lewat
  migrasi, bukan update baris.
- **Kerusakan massal** (ribuan baris dalam menit) — menghitung titik balik per
  entitas lebih lama dan lebih rawan salah daripada restore + replay run terakhir.
- **Jendela riwayat lewat.** `ingestion_raw_pages` / `source_snapshots` adalah
  pembanding data mentah; staging dibuang pada 90 hari (`purge_expired_staging()`).
  Setelah itu, tanpa `audit_logs` dan tanpa salinan, restore adalah satu-satunya
  jalan.

Urutan restore yang aman: hentikan ingestion dulu (lihat [incident.md](incident.md)
§3) → restore ke environment terisolasi → verifikasi dengan §6 → baru arahkan
traffic kembali → jalankan ulang run terakhir.

## 6. Verifikasi hasil rollback terhadap `statistics.status`

```sql
-- 1. INVARIAN: tepat satu 'current' per (form, metrik, sumber)
select character_version_id, metric, source_id, count(*)
  from statistics where status = 'current'
 group by 1,2,3 having count(*) > 1;
--    → wajib kosong (idx_statistics_current juga menjamin ini)

-- 2. nilai yang diperbaiki benar-benar 'current' lagi
select id, status, raw_text from statistics where id = '<id-nilai-lama>';   -- current
select id, status, raw_text from statistics where id = '<id-nilai-buruk>';  -- superseded

-- 3. tidak ada 'conflicting' yang tertinggal dari run itu
select status, count(*) from statistics group by status;

-- 4. tidak ada baris yatim
select count(*) from statistics s
 where not exists (select 1 from character_versions v where v.id = s.character_version_id);
```

Berhasil bila: query 1 kosong, query 2 menunjukkan status yang diharapkan, dan
sebaran query 3 kembali ke pola sebelum run buruk. Lalu buka halaman karakter
terdampak di browser dan cocokkan nilainya — angka di DB yang benar tetap bukan
bukti sampai halaman menampilkan hal yang benar. Jalankan juga
`npm run test:ingestion` untuk memastikan kontrak pipeline tidak ikut rusak oleh
perubahan data.

## 7. Yang TIDAK boleh dilakukan

1. **Jangan menghapus baris `statistics` buruk.** Turunkan ke `superseded` —
   penghapusan menghilangkan bukti dan kemampuan membalikkan lagi (D6).
2. **Jangan menaikkan baris `superseded` yang salah.** Karena trigger
   `trg_statistics_supersede` otomatis menurunkan `current` lama begitu baris
   lain pada triple yang sama menjadi `current`, kesalahan promosi **tidak
   menghasilkan error** — ia menukar nilai benar dengan nilai salah diam-diam.
   Selalu cocokkan `raw_text` yang tayang (§6 query 2 + halaman di browser),
   bukan hanya statusnya.
3. **Jangan menjalankan §3.2 satu per satu tanpa transaksi.** Dua `current` untuk
   satu triple memang dicegah skema (trigger + indeks unik `idx_statistics_current`),
   tetapi kondisi "tidak ada `current` sama sekali" bisa terjadi di tengah jalan —
   dan halaman kehilangan angka sama sekali.
4. **Jangan memulai ulang full sync saat insiden masih berlangsung.** Sync baru
   menulis di atas data yang belum diverifikasi; pertama pulihkan, baru sinkron.
5. **Jangan menganggap `audit_logs` berisi riwayat hari ini.** Tabelnya ada,
   penulisnya belum — klaim sebaliknya membuat prosedur §3.1 terlihat otomatis
   padahal belum.

## 8. Batas yang diketahui (jujur)

1. **`audit_logs` belum ditulis oleh kode mana pun.** §3.1 adalah mekanisme yang
   sudah teruji sintaksnya dan siap dipakai begitu penulisnya ada; jalur operasional
   hari ini adalah riwayat `statistics` (§3.2) + salinan manual.
2. **Pipeline tidak memakai transaksi per job** (lihat [ingestion.md](ingestion.md)
   §5): kegagalan di tengah meninggalkan sebagian baris, sehingga rollback memang
   harus per-entitas — tidak ada "batas run" otomatis untuk dibatalkan.
3. **Retensi data mentah 90 hari.** Setelah itu perbandingan "apa yang berubah"
   hanya bisa dari `audit_logs` (yang belum terisi) atau backup.
4. **Tidak ada otomasi.** Tidak ada tombol undo di panel; setiap langkah di sini
   SQL manual yang diverifikasi di §6.

## 9. Verifikasi lingkungan lokal (bisa diulang kapan saja)

Prosedur §3.2 dan §3.4 diverifikasi pada 2026-10-09 di atas `docs/schema.sql` +
`docs/seed.sql` (PGlite): satu baris `current` diturunkan, baris `superseded`
dinaikkan, invarian §6 query 1 terbukti kosong, tulisan `audit_logs` manual
dapat dibaca kembali oleh §3.1, dan — sebagai jalur gagal §4 — mempromosikan
baris tanpa menurunkan `current` terbukti **tidak** error: trigger
`trg_statistics_supersede` menurunkan saudaranya sendiri. Jalankan ulang kapan
pun dengan:

```bash
npm run test:ingestion    # kontrak pipeline + skema, termasuk perilaku status
npm run validate:schema   # skema, indeks, fungsi, dan seed
```
