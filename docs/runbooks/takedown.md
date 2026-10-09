# Runbook — Takedown (Hak Cipta)

**Status:** aktif. Langkah SQL diuji di PGlite lokal dengan `docs/schema.sql` +
`docs/seed.sql` (2026-10-09); **belum** pernah dijalankan pada instance Supabase
produksi. Prosedur mengikuti [PRD §30.3](../PRD.md#303-proses-takedown).

Dipicu oleh laporan hak cipta masuk — dari formulir `/legal/takedown`, email, atau
notifikasi platform — tentang gambar, teks, atau data di situs ini.

## 1. Membaca keadaan dalam 30 detik

Cari dulu objek yang dilaporkan (URL diambil dari laporan pelapor):

```sql
-- gambar/teks: karakter dari URL /character/<slug>
select id, slug, name, image_url, image_source, image_license, image_attribution
  from characters where slug = '<slug-dari-url>';

-- sumber asal konten: dari atribusi di halaman itu
select id, slug, base_url, legal_status, is_active, license, legal_notes
  from sources where base_url like '%<domain-pelapor>%';

-- excerpt teks yang tersimpan dari sumber itu (maks 400 karakter, LP-4)
select id, source_url, fetched_at, excerpt
  from source_snapshots where source_id = '<source-id>' and excerpt is not null;
```

Tiga kemungkinan hasil, dan mana yang berlaku menentukan jalur di §3:

| Yang dilaporkan | Jalur |
|---|---|
| Gambar/artwork di halaman karakter | §3.1 saja (cepat: ≤ 3 hari kerja) |
| Excerpt teks / data yang berasal dari satu sumber | §3.1 + §3.2 |
| Banyak konten dari satu domain | §3.1 + §3.2 + §3.3 |

## 2. Timeline SLA (wajib diikuti — PRD §30.3)

| Langkah | SLA | Aksi |
|---|---|---|
| 1 | **≤ 24 jam** | Terima laporan, buat tiket dengan bukti kepemilikan yang dilampirkan pelapor |
| 2 | **≤ 3 hari kerja** | Verifikasi; bila valid → `image_license = 'disputed'`, sembunyikan aset (situs menampilkan placeholder — LP-2) |
| 3 | **≤ 5 hari kerja** | Bila mencakup data: `legal_status = 'disabled'` pada sumber + job terkait `skipped` + hapus excerpt terkait |
| 4 | **≤ 7 hari kerja** | Konfirmasi tertulis ke pelapor + catat di changelog legal |
| 5 | Berkelanjutan | Pastikan domain tidak dapat diimpor kembali (deny-list, §3.3) |

Tiket hari ini = pelacakan manual (lihat §6 — belum ada tabel tiket khusus dan
formulir belum menyimpan apa pun). Rekam minimal: waktu masuk, bukti kepemilikan,
URL terlapor, dan setiap langkah yang dieksekusi. IG-6 mengukur pemenuhan SLA
≤ 5 hari kerja; R5 menetapkan target ≤ 7 hari.

## 3. Tindakan yang aman

Simpan bukti sebelum menyentuh apa pun (ini juga bahan konfirmasi ke pelapor):

```sql
create table takedown_evidence_<yyyymmdd> as
select * from characters where slug = '<slug>';
```

### 3.1 Sembunyikan artwork — tanpa menghapus data karakter (LP-2)

```sql
begin;
update characters
   set image_license = 'disputed',     -- penanda: lisensi dipersoalkan
       image_url     = null,           -- aset tidak lagi ditayangkan
       updated_at    = now()
 where slug = '<slug>' and image_url is not null;
commit;
```

`image_source`/`image_attribution`/`image_license_url` **tetap** — kredit tidak
dihapus, hanya asetnya. Constraint `characters_image_requires_license` tetap
terpenuhi karena berlaku hanya saat `image_url` terisi. Seluruh data lain — deskripsi,
form, statistik, ability, feat — tidak tersentuh: itulah inti LP-2 (data dan
artwork berbeda tabel/kolom dengan siklus hidup berbeda). Nilai `image_url` lama
ada di tabel bukti §3, jadi pembalikan tinggal mengembalikan kolomnya.

### 3.2 Nonaktifkan sumber + hapus excerpt

```sql
begin;
-- 1. sumber dinonaktifkan: jalur impor HANYA membaca legal_status='allowed',
--    sehingga langkah ini juga adalah deny-list efektif (lihat §3.3)
update sources
   set legal_status   = 'disabled',
       is_active      = false,
       legal_notes    = 'takedown <ticket-id>: <ringkasan>; dinonaktifkan <tanggal>',
       legal_reviewed_at = now(),
       updated_at     = now()
 where slug = '<source-slug>';

-- 2. job yang masih menunggu untuk sumber itu dibatalkan (konsisten dengan
--    check ingestion_jobs_completed_consistency: skipped wajib punya completed_at)
update ingestion_jobs
   set status = 'skipped', completed_at = now(), updated_at = now()
 where source_id = '<source-id>' and status = 'pending';

-- 3. excerpt teks dihapus dari snapshot (bukan arsip penuh — LP-4/IG-5)
update source_snapshots set excerpt = null where source_id = '<source-id>' and excerpt is not null;
commit;
```

Pertahanan lapis kedua: worker menolak sumber non-`allowed` dengan `PolicyBlocked`
bahkan bila ada job yang lolos — jadi tidak perlu buru-buru memburu setiap baris
job sebelum §3.2 langkah 1 selesai.

### 3.3 Menambahkan domain ke deny-list

Skema **tidak punya tabel deny-list terpisah**; peran itu dijalankan kombinasi
`legal_status = 'disabled'` + `is_active = false` (§3.2 langkah 1). Cukup satu
baris `sources` per domain:

```sql
insert into sources (slug, name, base_url, source_type, priority, legal_status,
                     legal_reviewed_by, legal_reviewed_at, legal_notes,
                     respect_robots, rate_limit_rps, license, is_active)
values ('<domain>-disabled', '<Domain> (dinonaktifkan takedown)', 'https://<domain>/', 'wiki',
        5, 'disabled', 'legal', now(), 'deny-list: takedown <ticket-id> (<tanggal>)',
        true, 1.0, null, false)
on conflict (slug) do update set legal_status = 'disabled', is_active = false,
                                  legal_notes = excluded.legal_notes;
```

Domain yang belum pernah terdaftar tetap tertutup dua kali: tidak ada baris
`sources` = tidak cocok dengan allow-list mana pun → ditolak 409 `SOURCE_DISABLED`
di jalur request; dan walau sebuah baris menyebut domain itu, fetcher tetap
menolak kebijakan sumber non-`allowed`.

## 4. Jalur gagal

| Langkah | Bila gagal | Yang dikerjakan |
|---|---|---|
| Langkah 1 (≤ 24 jam) — laporan tidak jelas / tanpa bukti kepemilikan | Tidak cukup bukti untuk bertindak | Balas dengan template B di §3.4 yang meminta bukti; SLA berhenti sampai bukti masuk (catat waktu berhentinya — itu bukan pelanggaran SLA bila pelapor tidak merespons) |
| §3.1 update mengenai 0 baris | `image_url` memang kosong (halaman itu tidak menampilkan gambar) atau slug salah | `select slug, image_url from characters where slug = '<slug>';` — bila memang kosong, tidak ada yang perlu disembunyikan; tetap lanjut ke §3.2 bila laporan juga mencakup data |
| §3.2 langkah 2 gagal karena constraint `completed_consistency` | Ada job `pending` yang juga kena filter status lain | `update` di atas sudah menyetel `completed_at`; bila masih gagal, periksa apakah job berstatus `processing` — **jangan** memaksa: worker sedang memegangnya (lihat [ingestion.md](ingestion.md) §3) |
| Excerpt ternyata dibutuhkan sebagai bukti di tiket | Setelah §3.2 langkah 3, excerpt hilang dari DB | Karena itu langkah §3 (tabel bukti) dijalankan **sebelum** §3.2. Bila terlanjur: ambil salinan dari tautan sumber asli pelapor |
| Pelapor keberatan setelah konten disembunyikan | Ternyata sah | Balikkan dari tabel bukti: `update characters set image_url = (select image_url from takedown_evidence_<yyyymmdd>), image_license = (select image_license from takedown_evidence_<yyyymmdd>) where slug = '<slug>';` lalu catat keputusan di changelog legal |
| Laporan menyangkut banyak domain sekaligus | §3.2/§3.3 harus diulang per sumber | Ulangi per `source-slug`; jangan menonaktifkan sumber yang tidak disebut laporan — itu menghentikan atribusi yang sah untuk karakter lain |
| Setelah 7 hari kerja belum selesai | SLA terlewati | Eskalasi hari itu juga: selesaikan langkah yang tersisa **dan** catat penyebab keterlambatan di tiket; jangan menutup tiket tanpa konfirmasi tertulis (langkah 4) |

## 3.4 Template balasan

**A. Penerimaan (kirim dalam 24 jam):**

> Kami menerima permintaan Anda pada <tanggal> dan sedang memverifikasi. Lampiran
> bukti kepemilikan Anda kami simpan bersama tiket <ticket-id>. Target penyelesaian
> kami: 3 hari kerja untuk verifikasi, maksimal 7 hari kerja untuk tindakan dan
> konfirmasi akhir. Bila kami memerlukan klarifikasi, kami akan menghubungi email
> ini.

**B. Permintaan bukti (bila lampiran kurang):**

> Untuk memproses permintaan, mohon kirimkan: (1) bukti kepemilikan hak atau
> representasi Anda atas karya tersebut, (2) URL persis konten yang dilaporkan,
> dan (3) penjelasan singkat pelanggarannya. Tanpa kelengkapan ini permintaan
> belum dapat kami verifikasi.

**C. Permintaan diterima (tindakan selesai):**

> Sesuai permintaan Anda, kami telah: <menyembunyikan artwork pada halaman X /
> menonaktifkan sumber Y dan menghapus kutipan terkait>. Data karakter non-gambar
> tetap tersimpan sesuai kebijakan kami (LP-2). Perubahan ini tercatat pada
> changelog legal kami. Terima kasih telah menghubungi kami.

**D. Permintaan ditolak (konten ternyata sah):**

> Setelah verifikasi, kami menyimpulkan konten pada <URL> tidak melanggar:
> <alasan singkat dengan rujukan bukti>. Bila Anda memiliki bukti tambahan,
> balas email ini dan kami akan membuka kembali tiket <ticket-id>.

## 5. Yang TIDAK boleh dilakukan

1. **Jangan menghapus baris `characters` atau `character_versions`.** LP-2:
   menghapus gambar tidak boleh menghapus data karakter. Sembunyikan `image_url`,
   jangan hapus entitas.
2. **Jangan menghapus `image_source`/`image_attribution`.** Kredit tetap berdiri
   meski aset diturunkan; menghapusnya justru melanggar LP-1.
3. **Jangan menonaktifkan sumber yang tidak disebut laporan.** Itu menghentikan
   impor sah dan menghilangkan atribusi untuk karakter lain.
4. **Jangan menunggu sampai langkah 3 untuk menyimpan bukti.** Setelah excerpt
   dihapus, salinan lokal Anda adalah satu-satunya bukti kutipan.
5. **Jangan menutup tiket tanpa konfirmasi tertulis ke pelapor** (langkah 4 SLA).

## 6. Batas yang diketahui (jujur)

1. **Formulir `/legal/takedown` belum menyimpan apa pun** — tidak ada `action`,
   tidak ada rute API. Hari ini laporan masuk lewat email/kontak manual; tiket
   dicatat manual. Ini celah yang harus ditutup sebelum volume laporan nyata.
2. **Tidak ada tabel tiket khusus.** `data_reports` (dengan status
   `new/reviewing/accepted/rejected`) adalah kandidat terdekat, tetapi belum ada
   kode yang menulisnya — jangan mengklaim tiket "sudah tercatat di DB" selama
   langkah itu belum dibangun.
3. **Tidak ada notifikasi otomatis.** Pengingat SLA harus dipantau manual
   (kalender/tiket); tidak ada yang akan memperingatkan Anda bahwa langkah 2
   hampir lewat 3 hari kerja.
4. **Tidak ada changelog legal otomatis.** Langkah 4 berarti menambah entri di
   catatan changelog legal (repo/depan) secara manual.
5. **`legal_reviewed_at` diisi `now()` pada §3.3** karena constraint
   `sources_active_requires_review` menuntut tanggal review pada baris; untuk
   baris `is_active = false` sebenarnya tidak wajib, tetapi diisi agar jejak
   review tetap utuh.

## 7. Verifikasi setelah tindakan

```sql
-- 1. artwork tidak lagi tayang, data karakter utuh
select slug, image_url, image_license, image_source, name, description
  from characters where slug = '<slug>';          -- image_url null, data tidak null

-- 2. sumber benar-benar mati dan tidak lagi cocok allow-list
select slug, legal_status, is_active from sources where slug = '<source-slug>';
--    → disabled / false; dan
select count(*) from sources
 where is_active and legal_status = 'allowed' and base_url like '%<domain>%';  -- → 0

-- 3. tidak ada job pending tersisa untuk sumber itu
select count(*) from ingestion_jobs
 where source_id = '<source-id>' and status = 'pending';                       -- → 0

-- 4. excerpt bersih
select count(*) from source_snapshots where source_id = '<source-id>' and excerpt is not null;  -- → 0
```

Berhasil bila keempatnya sesuai harapan, lalu buka halaman karakter terkait di
browser: gambar harus sudah diganti placeholder, sementara nama, deskripsi, form,
dan statistik tetap tampil. Konfirmasi (template C) dikirim setelah empat query
di atas lolos — bukan sebelumnya.
