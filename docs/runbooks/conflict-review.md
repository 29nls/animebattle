# Runbook — Conflict Review

**Status:** aktif. Langkah SQL pada runbook ini diuji di PGlite lokal dengan
`docs/schema.sql` + `docs/seed.sql` (2026-10-09); **belum** pernah dijalankan pada
instance Supabase produksi.

Dipicu oleh, salah satu saja:

- `character_source_conflicts.status = 'open'` ada barisnya (lihat `/admin/conflicts`);
- metrik K5: proporsi record `conflicting` yang belum di-review melewati 0,5%;
- laporan kurator bahwa nilai satu karakter terlihat salah di dua tempat.

**Baca dulu — keadaan jujur antarmuka hari ini:** `/admin/conflicts` bersifat
**baca-saja** (tombol simpan resolusi menyusul; lihat catatan di halaman itu), dan
**belum ada kode pipeline yang menulis baris konflik** (detektor AC-15 menyusul —
tabelnya, indeksnya, dan pembacanya sudah ada dan diuji di
`tests/ingestion/pipeline.test.ts`). Karena itu prosedur di bawah dieksekusi lewat
SQL admin (Supabase SQL Editor / `psql`), bukan lewat UI.

## 1. Membaca keadaan dalam 30 detik

Di panel `/admin/conflicts`: kartu **Terbuka** (status `open`), **Selesai (7 hari)**,
**Total**. Tabelnya menampilkan karakter, field, nilai A/B, dan waktu deteksi.

Daftar lengkap dengan bobot sumber:

```sql
select sc.id, ch.slug as karakter, sc.field, sc.value_a, sc.value_b,
       sa.slug as source_a, sa.priority as prio_a,
       sb.slug as source_b, sb.priority as prio_b,
       sc.status, sc.detected_at
  from character_source_conflicts sc
  join characters ch on ch.id = sc.character_id
  left join sources sa on sa.id = sc.source_a_id
  left join sources sb on sb.id = sc.source_b_id
 where sc.status = 'open'
 order by sc.detected_at;
```

`priority` adalah kelas reputasi sumber (PRD §19.1) — inilah satu-satunya dasar
menentukan pemenang:

| Kelas | `priority` | Definisi | Menang konflik? |
|---|---|---|---|
| 1 tertinggi | 1 | `primary_canon` — materi resmi yang dikutip langsung | Ya |
| 2 | 2 | `official_secondary` — panduan/pernyataan penulis resmi | Ya bila tidak ada kelas 1 |
| 3 | 3 | `curated_db` — dataset berlisensi / editor internal | Ya atas kelas 4 |
| 4 | 4 | `community_wiki` — wiki publik | Tidak; hanya mengisi field kosong |
| 5 terendah | 5 | `forum_user` — forum/konten pengguna | Tidak; petunjuk, bukan fakta |

## 2. Triase: keputusan mana yang sah

| Kondisi | Keputusan | Alasan |
|---|---|---|
| `prio_a < prio_b` (kelas lebih tinggi di A) | `keep_a` | Kelas 1/2/3 menang menurut §19.1 |
| `prio_b < prio_a` | `keep_b` | Kebalikannya |
| `prio_a = prio_b` dan kedua nilai **dapat hidup berdampingan** | `keep_both` | Lihat §3.3 — hampir selalu berarti dua nilai milik dua **form** berbeda |
| `prio_a = prio_b`, satu kelas, dua nilai berbeda, tak ada bukti pemutus | **biarkan `open`** | Menebak di sini menghasilkan data yang tampak pasti padahal tidak. Queue yang terbuka lebih jujur daripada resolusi karangan |
| Kedua nilai rusak/tidak sah (skala tidak ada, angka gila) | `ignored` | Keduanya tidak layak tayang; `ignored` mengeluarkan baris dari antrean tanpa memilih pemenang |

Catatan soal `unresolved`: enum skemanya hanya `open | resolved | ignored` —
**tidak ada status `unresolved`**. Pilihan yang benar adalah: (a) masih diselidiki →
biarkan `open` (tetap terhitung di K5, jadi tidak bisa dilupakan), atau (b) sudah
diputuskan tidak akan pernah bisa diselesaikan → `ignored` dengan `resolution` yang
menjelaskan *mengapa* tidak bisa diputuskan. Yang tidak boleh: memilih `resolved`
tanpa jawaban — itu menyembunyikan ketidakpastian.

## 3. Tindakan yang aman

Semua perintah dijalankan sebagai pemilik tabel / service role. RLS aktif di tabel
ini (`pol_character_source_conflicts_admin` menuntut `is_admin()`); koneksi anon
tidak akan menulis apa pun — bila update diam-diam mengenai 0 baris, itu karena
peran, bukan karena datanya.

Simpan dulu salinan sebelum mengubah apa pun (dipakai juga untuk rollback):

```sql
create table conflict_review_backup_20261009 as
select * from character_source_conflicts where status = 'open';
```

### 3.1 `keep_a` / `keep_b` — satu nilai menang

```sql
begin;
-- 1. catat keputusannya (idempoten: hanya baris yang masih 'open')
update character_source_conflicts
   set status     = 'resolved',
       resolution = 'keep_b: kelas 2 (official_secondary) mengalahkan kelas 4 (community_wiki); bukti <URL-revisi>',
       resolved_by = '00000000-0000-0000-0000-000000000001',
       resolved_at = now()
 where id = '<conflict-id>' and status = 'open';

-- 2. baris statistik pihak yang kalah ditandai 'conflicting' (bukan dihapus —
--    tetap dapat diaudit dan dapat dikembalikan)
update statistics
   set status = 'conflicting', updated_at = now()
 where character_version_id = '<version-id>'
   and metric = '<metric>'::stat_metric_t
   and source_id = '<source-pihak-kalah>'
   and status = 'current';
commit;
```

`resolved_by` adalah `uuid` biasa di tabel ini (tanpa FK ke `users`), jadi pakai
uuid stabil identitas operator Anda — jangan uuid acak per eksekusi, agar riwayat
dapat ditelusuri.

### 3.2 `keep_both` — kedua nilai benar, asal dipisah per form

Pola khasnya: "Island level" benar untuk form Part I, "Country level" benar untuk
form Part II. Yang dipindah adalah **baris statistik ke form yang benar**, bukan
nilai yang dihapus:

```sql
begin;
update statistics
   set character_version_id = '<form-yang-benar>',
       updated_at = now()
 where id = '<statistik-id>';
update character_source_conflicts
   set status = 'resolved',
       resolution = 'keep_both: nilai A milik <form-slug-1>, nilai B milik <form-slug-2> (dipecah per form)',
       resolved_by = '00000000-0000-0000-0000-000000000001',
       resolved_at = now()
 where id = '<conflict-id>';
commit;
```

Bila keduanya memang milik **form yang sama** dan sumbernya berbeda, keduanya boleh
tetap `current` — indeks `idx_statistics_current` unik per
`(form, metrik, sumber)`, jadi dua sumber tidak saling menghapus. Pada kasus itu
`keep_both` berarti "tidak ada perubahan data; kedua atribusi tetap tampil".

### 3.3 `ignored` — tidak ada pemenang

```sql
update character_source_conflicts
   set status = 'ignored',
       resolution = 'ignored: kelas 4 vs kelas 4, keduanya melanggar LP-4 (nilai > 400 karakter) — tidak ada nilai sah',
       resolved_by = '00000000-0000-0000-0000-000000000001',
       resolved_at = now()
 where id = '<conflict-id>' and status = 'open';
```

## 4. Jalur gagal

| Langkah | Bila gagal | Yang dikerjakan |
|---|---|---|
| Update `resolution` mengenai 0 baris | Kemungkinan bukan `status='open'` (sudah diproses orang lain) atau koneksi bukan peran admin | `select status from character_source_conflicts where id='<id>';` — bila sudah `resolved`, berhenti; bila peran salah, ulangi dengan service role |
| Update `statistics` mengenai 0 baris | `<metric>`/`<version-id>`/`<source-id>` salah, atau barisnya sudah `conflicting` | Periksa dengan `select id,status from statistics where character_version_id='<vid>' and metric='<metric>';` — bila memang tidak ada baris `current` untuk sumber itu, keputusan pencatatannya tetap sah: cukup baris konflik yang diperbarui |
| Langkah 1 sukses, langkah 2 gagal di tengah | Keduanya dibungkus `commit`/`begin` — bila transaksi gagal, **semuanya** kembali | Perbaiki penyebab, jalankan ulang blok yang sama (idempoten) |
| Nilai menang ternyata salah setelah diresolusi | Balikkan dari salinan | `update statistics set status='current' where id='<statistik-id>';` dan `update character_source_conflicts set status='open', resolution=null, resolved_at=null where id='<id>';` — lihat [rollback.md](rollback.md) |
| Konflik tidak pernah muncul di queue padahal dua sumber berbeda | Detektor AC-15 belum ada di pipeline | Ini **bukan** kegagalan operasi; catat sebagai tugas kode. Jangan menutupinya dengan menandai konflik yang tidak ada |

## 5. Yang TIDAK boleh dilakukan

1. **Jangan menimpa `value_a`/`value_b`.** Kolom itu adalah bukti; keputusan hidup
   di `status` + `resolution`.
2. **Jangan memutuskan konflik hanya karena satu nilai "lebih masuk akal".**
   Pemutusnya kelas sumber (§19.1), bukan intuisi.
3. **Jangan menghapus baris `statistics` pihak yang kalah.** Tandai `conflicting`;
   penghapusan menghilangkan kemampuan membalikkan keputusan.
4. **Jangan menyelesaikan semua konflik dalam satu batch tanpa membaca satu pun.**
   K5 mengukur konflik yang belum di-review — menutup massal membuat metriknya
   bodoh, bukan memperbaiki kualitas.
5. **Jangan menulis dari jalur request/UI publik.** Tabel ini di bawah RLS admin;
   tulis lewat SQL editor dengan peran admin, bukan lewat klien anon.

## 6. Batas yang diketahui (jujur)

1. **Tidak ada UI resolusi.** Halaman `/admin/conflicts` membaca dan menampilkan;
   penyimpanan keputusan hari ini lewat SQL. Tombol "simpan" + tulisan ke
   `audit_logs` adalah pekerjaan tersendiri.
2. **Detektor konflik (AC-15) belum ada di pipeline.** Tidak ada kode yang menulis
   `character_source_conflicts`; baris yang muncul hari ini berasal dari
   pemeriksaan manual atau test.
3. **Tidak ada pemicu otomatis.** Queue tidak mengirim notifikasi; "backlog konflik
   besar" baru terlihat saat seseorang membuka halaman (K5 harus dijadwalkan
   sebagai query, belum ada).
4. **`resolved_by` tanpa referensi `users`.** Tidak ada integritas terhadap
   akun sungguhan sampai Supabase Auth terpasang (Sprint 4).

## 7. Verifikasi setelah tindakan

```sql
-- 1. tidak ada konflik tersisa yang belum diputus
select count(*) from character_source_conflicts where status = 'open';

-- 2. setiap resolusi memuat alasan (tidak ada resolved tanpa penjelasan)
select id, status, resolution, resolved_by, resolved_at
  from character_source_conflicts
 where status = 'resolved' and (resolution is null or resolution = '');

-- 3. tidak ada dua 'current' untuk form+metrik+sumber yang sama
select character_version_id, metric, source_id, count(*)
  from statistics where status = 'current'
 group by 1,2,3 having count(*) > 1;
```

Berhasil bila: query 1 turun ke 0, query 2 tidak mengembalikan baris, dan query 3
kosong (indeks `idx_statistics_current` seharusnya menjamin ini — query ini
memastikan tidak ada yang mengelabuinya). Lalu muat ulang `/admin/conflicts` dan
pastikan kartu **Terbuka** ikut berkurang.
