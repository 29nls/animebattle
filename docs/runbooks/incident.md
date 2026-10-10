# Runbook — Insiden Operasional

**Status:** aktif. Langkah SQL pada runbook ini diuji di PGlite lokal dengan
`docs/schema.sql` + `docs/seed.sql` (2026-10-09); pemeriksaan HTTP diuji terhadap
rute sungguhan lokal (2026-10-09). **Belum** pernah dijalankan pada instance
Supabase produksi.

Dipicu oleh, salah satu saja (K3/K7, [PRD §35.2](../PRD.md)):

- error rate API 5xx > 0,5% selama 15 menit (K7: uptime ≥ 99,5%);
- p95 simulasi melewati target: < 300 ms (engine) / < 1,5 s (+narrator) — K3;
- kebocoran atau dugaan kebocoran kunci (`ADMIN_INGESTION_SECRET`, `CRON_SECRET`).

## 1. Membaca keadaan dalam 30 detik

Tiga pemeriksaan berurutan, dari yang tidak menyentuh database ke yang
menyentuhnya:

```bash
# 1. liveness — proses web hidup? (TIDAK menyentuh DB; 200 = proses melayani)
curl -sS -o /dev/null -w '%{http_code}\n' "$SITE_URL/api/health"

# 2. kesiapan DB — menyentuh DB sungguhan (select 1); no-store, jadi tidak basi
curl -sS -w '\n%{http_code}\n' "$SITE_URL/api/health/ready"
#  200 {"status":"ready","database":"connected"}  → DB sehat
#  503 {"status":"not_configured",...}            → DATABASE_URL hilang di server
#  503 {"status":"unhealthy","database":"connection_failed"} → DB tak terjangkau

# 3. ringkasan sistem (butuh Bearer; rate limit 30/menit)
curl -sS -H "Authorization: Bearer $ADMIN_INGESTION_SECRET" "$SITE_URL/api/admin/metrics"
```

`/api/health` yang 200 sementara `/api/health/ready` 503 adalah **kombinasi
paling umum**: proses web sehat, database mati. Panel admin pada kondisi ini
menampilkan "Database tidak dapat dihubungi; tidak ada perubahan yang
dilakukan." (fail-closed) — keadaan itu sudah benar, jangan "diperbaiki" dengan
menonaktifkan guard.

## 2. Triase: web, DB, atau worker

| Lapisan | Pertanyaan | Cara menjawab | Bila ya |
|---|---|---|---|
| **Web** | Proses error/mati? | `/api/health` ≠ 200; log platform (Sentry); `npm run build` + `npm run dev` lokal gagal? | Lihat §4 jalur "web" |
| **DB** | Database tak terjangkau? | `/api/health/ready` 503 `connection_failed` / `not_configured` | Lihat §4 jalur "DB" |
| **Worker** | Antrian ingestion macet/rusak? | Query §3.1; `/api/cron/sync` membalas 401/503? | Lihat §3 |
| **Engine** | Hanya simulasi lambat? | `POST /api/battle/simulate` p95 > target (APM), halaman lain normal | Lihat §3.3 |

Pemisahan yang penting: `/api/health` sengaja **tidak** menyentuh DB, dan
`/api/health/ready` sengaja menyentuh DB — mencampur keduanya membuat platform
me-restart proses yang sehat hanya karena DB sedang sibuk. Diagnosis yang benar
selalu memakai keduanya, bukan salah satu.

Untuk kasus "error rate 5xx > 0,5%": buka log platform dan kelompokkan 5xx per
rute. Pola umum:

- **5xx di `/api/admin/*` dan `/api/cron/sync` saja** → hampir pasti kunci/config
  (503 `UNAVAILABLE` = secret belum disetel, 401 = secret salah) — itu bukan
  insiden lapisan aplikasi; jalankan §3.4 (rotasi/verifikasi kunci).
- **5xx di rute publik yang menyentuh DB** (`/api/search`, halaman dinamis) →
  lapisan DB (baris "DB" di tabel).
- **5xx hanya di `POST /api/battle/simulate`** → engine/parser; jalankan
  `npm run test:engine` dan `npm run validate:battle-cases` pada versi yang
  ter-deploy — bila hijau, masalahnya di beban/latensi, bukan di logika.

## 3. Tindakan yang aman

### 3.1 Membaca antrian worker

```sql
-- job terakhir: mana yang stuck/gagal?
select id, source_id, scope, status, retry_count, error_type, error_message,
       started_at, completed_at
  from ingestion_jobs
 order by created_at desc limit 20;

-- sumber yang sedang menarik traffic crawler
select slug, is_active, rate_limit_rps, max_fetches_per_day from sources order by slug;
```

### 3.2 Menonaktifkan ingestion sementara

Tiga tuas, dari yang paling halus ke paling kasar — jalankan sesuai kebutuhan:

```sql
-- (a) MATIKAN satu sumber. Impor baru untuk sumber ini langsung ditolak
--     409 SOURCE_DISABLED SEBELUM satu baris antrian pun ditulis (AC-19),
--     sehingga tidak ada dampak tulis sama sekali.
update sources set is_active = false, updated_at = now()
 where slug = '<source-slug>';
```

Verifikasi: `POST /api/admin/ingestion/import` dengan sumber itu harus membalas
**409 `SOURCE_DISABLED`**, dan `select count(*) from ingestion_jobs where source_id='<id>' and created_at > now() - interval '1 minute';`
harus nol.

```sql
-- (b) kosongkan antrian yang belum dikerjakan (hanya status 'pending' —
--     'queued' bukan anggota job_status_t dan akan membuat query ini error).
--     Job 'processing' sengaja tidak disentuh di sini: lihat catatan rute di bawah.
select id, status from ingestion_jobs
 where status = 'pending' order by created_at;
```

Per job, pakai rute resmi (lebih aman daripada update manual — ia memvalidasi
status dan menolak job yang sedang berjalan):

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_INGESTION_SECRET" \
  "$SITE_URL/api/admin/ingestion/jobs/<job-id>/cancel"      # → {"status":"skipped"}
```

- **Job `pending`/`queued`** → bisa dibatalkan (200).
- **Job `processing`** → rute membalas **409**: menghentikan worker yang sedang
  berjalan bukan sesuatu yang dapat dijanjikan satu `update`. Biarkan selesai
  (cron memproses maksimal 3 job per tick, jadi antrean berhenti dengan sendirinya
  dalam satu tick setelah job aktif keluar).

```bash
# (c) matikan pemicu terjadwal (GitHub Actions, cron */15m)
gh workflow disable scheduled-ingest
# verifikasi: tampil "disabled"; workflow tidak lagi muncul di antrean run
gh workflow list | grep scheduled-ingest
# ulangi bila perlu: gh workflow enable scheduled-ingest
```

**Urutan yang aman**: (c) dulu agar tidak ada pemicu baru → (a) untuk menutup
pintu impor manual → (b) untuk mengosongkan sisa antrean.

### 3.3 Menangani p95 simulasi di atas target (K3)

1. Ukur ulang p95 `POST /api/battle/simulate` di APM (target < 300 ms engine,
   < 1,5 s dengan narrator). Satu titik data bukan insiden; **> 15 menit di atas
   target** baru jadi pemicu (sesuai baris monitoring PRD).
2. Bandingkan dengan beban: bila hanya terjadi saat ingest aktif, matikan ingestion
   sementara (§3.2) dan ukur lagi — korelasi berarti kelebihan beban, bukan regresi kode.
3. Bila tidak berkorelasi: jalankan `npm run test:engine` +
   `npm run validate:battle-cases` pada commit yang ter-deploy. Hijau = masalah
   infra/latensi DB; merah = regresi kode → rollback kode, lihat
   [rollback.md](rollback.md) §5 dan jalur "web" di §4.

### 3.4 Merotasi kunci tanpa downtime

Kunci yang ada: `ADMIN_INGESTION_SECRET` (seluruh `/api/admin/*` **dan** token
login `/admin` — sesi cookie ditandatangani dengannya, 12 jam) dan `CRON_SECRET`
(`GET /api/cron/sync`). Keduanya dibandingkan **timing-safe** terhadap **satu**
nilai env; tidak ada daftar kunci cadangan.

Urutan yang meminimalkan downtime (urutannya penting):

```bash
# 1. siapkan kunci BARU (jangan pernah men-blank kunci lama — lihat §5)
NEW_ADMIN=$(openssl rand -hex 32)
NEW_CRON=$(openssl rand -hex 32)

# 2. perbarui konsumen yang ada di luar platform LEBIH DULU:
#    - GitHub Actions secret CRON_SECRET (workflow scheduled-ingest)
gh secret set CRON_SECRET --body "$NEW_CRON"   # nilai baru belum dipakai server → aman

# 3. set env baru di platform (Vercel/lokal) DAN deploy dalam satu langkah:
#    ADMIN_INGESTION_SECRET=$NEW_ADMIN, CRON_SECRET=$NEW_CRON
#    (perubahan env tanpa deploy tidak dipakai proses yang sedang berjalan)

# 4. verifikasi — semuanya harus menjawab seperti sebelum rotasi:
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $NEW_ADMIN" \
  "$SITE_URL/api/admin/metrics"          # 200
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $NEW_CRON" \
  "$SITE_URL/api/cron/sync"              # 200 (bukan 401/503)
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $OLD_ADMIN" \
  "$SITE_URL/api/admin/metrics"          # 401 — kunci lama sudah MATI
```

Mengapa ini "tanpa downtime": (1)–(2) menyiapkan semua pemakai sebelum server
berganti; (3) memperbarui server dan konsumen hampir bersamaan; tidak ada
langkah yang pernah mengosongkan secret, sehingga guard tidak pernah masuk
mode 503. Efek samping yang **diharapkan** saat rotasi karena kebocoran: seluruh
sesi `/admin` yang lama ikut mati (cookie ditandatangani dengan secret lama) —
operator cukup login ulang dengan token baru. Pada rotasi rutin, efek itu
sama-sama tidak berbahaya.

## 4. Jalur gagal

| Situasi | Bila terjadi | Yang dikerjakan |
|---|---|---|
| `/api/health` ≠ 200 (proses mati/error) | Bukan DB — proses gagal start atau crash | Baca log platform; jalankan `npm run typecheck && npm run build` lokal pada commit ter-deploy; bila build gagal, rollback kode ke commit hijau terakhir lalu redeploy |
| `/api/health` 200 tapi `/api/health/ready` `connection_failed` | DB mati/overloaded/TLS | Cek `DATABASE_URL` (pooler **6543**, bukan 5432) dan status instance DB; **jangan** restart proses web — ia sehat; ulangi `/api/health/ready` tiap 30 detik sampai 200 |
| `/api/health/ready` `connection_failed` dengan `self-signed certificate in certificate chain` (pengunjung melihat pesan generik; detailnya ada di log server) | Supabase memakai CA **privat**; `sslmode=verify-full` memverifikasi terhadap CA bawaan Node — dan `sslrootcert` di URL diabaikan postgres.js | Setel `DATABASE_CA_CERT` (isi PEM "Supabase Root 2021 CA") di env platform lalu redeploy; **jangan** memakai `sslmode=require` sebagai jalan pintas — itu menonaktifkan verifikasi sertifikat. Detail: README §Konfigurasi lingkungan |
| Halaman ber-DB menampilkan `relation "…" does not exist` (SQLSTATE `42P01`) padahal `/api/health/ready` 200 | Kredensial benar, tetapi skema aplikasi belum ada di database tujuan — atau URL menunjuk project lain | Cocokkan project lebih dulu: `select table_name from information_schema.tables where table_schema='public'`; bila `characters`/`verses` tidak ada, arahkan `DATABASE_URL` ke project yang benar atau terapkan `docs/schema.sql` (lalu `docs/seed.sql`) pada project itu — jangan menebak, project itu bisa dimiliki aplikasi lain |
| `/api/health/ready` `not_configured` | `DATABASE_URL` hilang/ter-reset di env platform | Setel ulang `DATABASE_URL` + redeploy; halaman menampilkan fail-closed yang benar sampai kembali |
| `cancel` job membalas 409 | Job `processing`, atau sudah selesai | `processing` = biarkan selesai (maks 3 job/tick), lalu pastikan job berikutnya ter-cancel; bila sudah selesai, tidak ada yang perlu dilakukan |
| Setelah `sources.is_active=false`, impor masih menulis baris | Bukan sumber itu (slug salah) atau klien memakai allow-list berbeda | `select slug,is_active from sources;` — cocokkan slug persis; verifikasi lagi dengan 409 pada langkah §3.2(a); bila tetap menulis, catat slug persis yang lolos sebagai temuan kode, jangan diamkan |
| `gh workflow disable` ditolak/berhasil tapi run tetap jalan | Run sudah dalam antrean sebelum dinonaktifkan | `gh run list --workflow=scheduled-ingest` → `gh run cancel <id>` pada run yang sedang berjalan |
| Rotasi: endpoint menjawab 401 **setelah** langkah 3 | Deploy belum selesai, atau konsumen memakai nilai lama | Tunggu deploy selesai lalu ulangi langkah 4; bila masih 401, pastikan tidak ada proses yang menjalankan kode lama (rollback platform sekali lagi) |
| Rotasi: endpoint menjawab **503** | Secret ter-blank (pernah kosong di tengah proses) | Isi langsung dengan nilai baru (jangan lewat nilai kosong), redeploy; 503 = guard bekerja sebagaimana mestinya |
| P95 masih tinggi setelah ingestion dimatikan | Bukan beban; regresi kode atau DB | `npm run test:engine && npm run validate:battle-cases` — merah → rollback kode; hijau → periksa query lambat (slow query log) dan pertimbangkan [rollback.md](rollback.md) §5 |
| Tidak tahu apakah 5xx berasal dari DB atau engine | Log platform tidak membedakan | Ulangi §2 dari atas; `/api/health` dan `/api/health/ready` sudah memisahkan kedua kasus ini dalam dua permintaan |

## 5. Yang TIDAK boleh dilakukan

1. **Jangan pernah men-blank secret untuk "merotasi".** `ADMIN_INGESTION_SECRET`
   atau `CRON_SECRET` yang kosong mengubah seluruh panel admin dan cron menjadi
   503 fail-closed — itu downtime buatan sendiri. Selalu set langsung lama → baru.
2. **Jangan menonaktifkan guard/fail-closed agar 5xx hilang.** 503 `UNAVAILABLE`
   pada rute admin berarti konfigurasi kurang, bukan bug; menghapus guard
   membuka rute admin ke publik.
3. **Jangan menjalankan full sync untuk "menguji" selama insiden.** Sync baru
   menulis di atas data yang belum diverifikasi — perbaiki dulu, baru sinkron
   ([incident.md](incident.md) → [rollback.md](rollback.md)).
4. **Jangan mematikan `respect_robots` atau menaikkan `rate_limit_rps`** untuk
   mempercepat pemulihan — itu memindahkan insiden ke sumber yang memblokir kita.
5. **Jangan mengubah `ALLOW_BATTLE_PREVIEW`/`ALLOW_DEMO_DATA` di produksi.**
   Keduanya gerbang non-produksi; membukanya di produksi membuat data demo tayang
   sebagai data nyata (AC-09).
6. **Jangan menganggap 401 pada rute admin sebagai serangan** sebelum memeriksa
   apakah secret baru saja dirotasi — 401 setelah rotasi pada konsumen lama adalah
   perilaku yang diharapkan, bukan insiden kedua.

## 6. Batas yang diketahui (jujur)

1. **Rotasi tidak mendukung dua kunci sekaligus.** Tidak ada mekanisme
   `OLD`+`NEW` yang valid bersamaan; jendela terlama yang tidak sempurna adalah
   antara deploy server baru dan pembaruan konsumen terakhir (menit, bukan jam —
   karena langkah 2 mendahului langkah 3).
2. **Tidak ada rotasi otomatis.** Semua langkah §3.4 manual; tidak ada cron yang
   mengganti secret.
3. **`scheduled-ingest` masih STUB** (lihat komentar di
   `.github/workflows/scheduled-ingest.yml`): tanpa secret ia skip dengan pesan
   jelas, jadi di lingkungan tanpa deployment, "ingestion mati" memang kondisi
   aslinya — jangan dikira berhasil mematikan sesuatu yang belum pernah hidup.
4. **Metrik 5xx/p95 bergantung APM eksternal** (PRD: Vercel Analytics + Sentry +
   slow query log). Tanpa APM terpasang, trigger K3/K7 hanya bisa diukur dari
   log mentah — catat hal ini saat melaporkan status insiden.
5. **Tidak ada alerting bawaan di repo ini.** Pemicu di atas dideteksi oleh
   uptime monitor yang dikonfigurasi di platform, bukan oleh kode kita.

## 7. Verifikasi setelah insiden selesai

```bash
# 1. kesehatan kembali penuh
curl -sS -o /dev/null -w '%{http_code}\n' "$SITE_URL/api/health"          # 200
curl -sS -o /dev/null -w '%{http_code}\n' "$SITE_URL/api/health/ready"    # 200

# 2. kunci baru berlaku, kunci lama mati (rotasi §3.4)
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $NEW_ADMIN" \
  "$SITE_URL/api/admin/metrics"                                           # 200
```

```sql
-- 3. ingestion kembali normal bila tadi dimatikan
select slug, is_active from sources order by slug;                        -- true kembali
select status, count(*) from ingestion_jobs
 group by status order by status;                                         -- tak ada 'processing' lama yang tertinggal

-- 4. tidak ada dampak data dari insiden (baris yatim / dobel current)
select count(*) from statistics s
 where not exists (select 1 from character_versions v where v.id = s.character_version_id);
select character_version_id, metric, source_id, count(*)
  from statistics where status='current' group by 1,2,3 having count(*) > 1;
```

Berhasil bila: dua pemeriksaan HTTP 200, rute admin membalas 200 dengan kunci
baru dan 401 dengan kunci lama, sumber kembali aktif bila tadi dimatikan, dan
kedua query SQL terakhir mengembalikan 0 baris. Terakhir, buka situs di browser
dan jalankan satu simulasi — angka sehat tanpa halaman yang tayang bukan pemulihan.

## 8. Verifikasi lingkungan lokal (bisa diulang kapan saja)

Pemeriksaan pada 2026-10-09, dua lapis:

- **HTTP langsung** terhadap `npm run dev` yang sedang berjalan: `/api/health`
  → 200 (`database_configured: false`), `/api/health/ready` → 503
  `not_configured` (dengan nama env yang kurang), `/api/admin/metrics` tanpa
  header / bearer salah / bearer kosong → **401**, `/api/cron/sync` → **503
  `UNAVAILABLE`** (CRON_SECRET kosong — gagal tertutup sebelum menyentuh DB).
- **Cabang yang butuh keadaan khusus** diverifikasi lewat integration test:
  rute admin **503 tanpa secret** dan **401 dengan secret salah** →
  `tests/security/admin-routes.integration.test.ts`; cron 503/401 →
  `tests/security/cron-route.integration.test.ts`; `/api/health/ready`
  `connection_failed` (DATABASE_URL menunjuk host yang tak terjangkau) →
  `tests/security/api-error-contract.test.ts`. Cabang `ready` 200 butuh
  Postgres hidup — tidak tersedia di mesin pengujian ini.

Jalankan ulang kapan pun dengan:

```bash
npm run typecheck && npm run lint && npm run test:security   # guard, sesi, dan rate limit
npm run validate:schema                                       # skema + constraint yang dipakai §3.2
```
