# Runbook — Review Keamanan

**Status:** review kode + uji, **2026-11-05**. Ini bukan penetration test dan
bukan audit pihak ketiga. Produksi tidak diserang atau dipindai pada sesi ini;
temuan di bawah berasal dari membaca kode dan menjalankan suite yang ada.

Dipakai saat: mengubah CSP/header, menambah sumber ingestion, menaikkan kuota
rate limit, menambah field PII, atau menindaklanjuti dugaan SSRF/abuse.

## 1. Ruang lingkup dan bukti

| Area | Yang diperiksa | Bukti |
|---|---|---|
| SSRF ingestion | Allow-list, alamat privat, redirect, robots | `src/services/ingestion/fetcher.ts`; `tests/ingestion/` |
| Rate limit | Rute publik, identitas bucket, perilaku gagal | `src/lib/security/distributed-rate-limit.ts`; `tests/security/`, `tests/web/database-queries.test.ts` |
| Header/CSP | CSP, HSTS, COOP/CORP, Permissions-Policy | `next.config.ts`; `tests/security/security-headers.test.ts` |
| Env/secret | `NEXT_PUBLIC_*`, `.env` ter-commit, nama env | `scripts/audit-env.mjs`; `tests/security/env-audit.test.ts` |
| Intake legal | Validasi, same-origin, kuota, PII | `app/api/legal/takedown/route.ts`; `tests/security/legal-takedown.test.ts` |

Tidak diperiksa: dependensi CVE (`npm audit` tidak dijalankan), konfigurasi
Supabase/Vercel, WAF/DDoS, dan rotasi kredensial nyata.

## 2. SSRF

**Jalur request pengguna tidak melakukan fetch.** Pencarian, halaman, dan
simulasi hanya membaca database; impor hanya menulis staging + antrian. Fetch
hanya terjadi di worker ingestion atau endpoint cron terjadwal — batas ini juga
ditegakkan `boundary-import`.

Guard sebelum satu byte diambil (`fetchSourcePage`):

1. Skema hanya `http:`/`https:`; URL berkredensial ditolak.
2. Allow-list sumber diperiksa ulang di **setiap** lompatan redirect.
3. Redirect diikuti manual, maksimal 3; `redirect: 'follow'` tidak dipakai.
4. Hostname diperiksa: literal IP privat/loopback/link-local ditolak; hostname
   di-resolve lalu **semua** alamat hasil resolusi diperiksa.
5. `robots.txt` fail-closed bila `respect_robots` aktif.
6. Rate limit per host sebelum fetch.

**Risiko sisa — DNS TOCTOU (rendah).** `assertHostIsPublic` me-resolve hostname
sekali, lalu `fetchImpl` menerima URL dan melakukan resolusi sendiri. Tidak ada
IP pinning/custom dispatcher, sehingga DNS yang berubah di antara dua resolusi
dapat mengembalikan alamat publik saat diperiksa dan alamat privat saat
dihubungi. Dampaknya dibatasi: sumber harus sudah ada di allow-list, fetch
berjalan di worker (bukan jalur request pengguna), dan isi respons tetap lewat
parser. Perbaikan yang benar adalah mem-pin IP hasil resolusi ke koneksi
(mis. dispatcher `lookup`) atau menolak host yang berubah alamat; belum
diimplementasikan.

Tindakan bila dicurigai: matikan sumber (`is_active = false`), periksa
`ingestion_jobs`/`ingestion_errors` untuk URL yang dicoba, dan tambahkan host ke
deny-list sesuai [takedown.md](takedown.md) §3.3.

## 3. Rate limit

Rute publik yang memakai limiter terdistribusi (tabel `rate_limit_windows`):
`/api/search`, `/api/search/suggest`, `/api/characters/:slug/versions`,
`/api/battle/simulate`, dan `/api/legal/takedown`. Rute admin memakai limiter
per pengguna di proses web; login punya limiter sendiri.

- Identitas bucket = hash IP + salt harian + nama endpoint. IP mentah tidak
  disimpan.
- **Fail-open saat database gagal**: permintaan diteruskan dan
  `rate_limit.unavailable` dicatat. Ini disengaja karena database yang sama
  membuat jalur data menjawab 503; menolak lebih dulu sebagai 429 menyamarkan
  gangguan. Konsekuensinya, limiter bukan batas keamanan saat DB down.
- `x-forwarded-for` diambil nilai pertama. Bila platform tidak menimpa header
  itu, klien dapat memalsukannya dan berpindah bucket. Perilaku Vercel belum
  diuji dengan header palsu pada sesi ini.

Tindakan bila abuse: turunkan `limit` di route terkait, tambahkan aturan di
platform (WAF/edge), dan periksa `rate_limit_windows` untuk pola bucket. Jangan
menghapus limiter karena satu keluhan false positive.

## 4. Header dan CSP

`next.config.ts` memasang di semua path: `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`,
CSP, `Permissions-Policy` (camera/mic/geolocation/payment mati),
`Cross-Origin-Opener-Policy: same-origin`,
`Cross-Origin-Resource-Policy: same-origin`, dan
`X-DNS-Prefetch-Control: off`. HSTS (`max-age=63072000; includeSubDomains;
preload`) hanya saat `NODE_ENV=production`.

CSP memakai `script-src 'self' 'unsafe-inline'` dan
`style-src 'self' 'unsafe-inline'`. Ini **bukan CSP strict**: nonce per-request
akan memaksa semua halaman menjadi dinamis. `connect-src` hanya `self` +
Supabase; Sentry server-only sehingga tidak ada DSN di browser. Tidak ada
`report-uri`/`report-to`, jadi pelanggaran CSP tidak teramati.

## 5. Env dan secret

- `.env*` di `.gitignore`; hanya `.env.example` yang ikut repo.
- `npm run audit:env` memeriksa **nama** env: semua `NEXT_PUBLIC_*` harus ada di
  allow-list, dan berkas env nyata tidak boleh ter-commit. Ia **tidak** membaca
  nilai, jadi tidak membuktikan tidak ada secret di dalam nilai.
- Sentry memakai `@sentry/node` server-only; `dataCollection` mematikan PII,
  header, body, dan query.
- Job `secret-scan` (gitleaks) sudah ada di CI, tetapi belum pernah diamati
  berjalan di GitHub. Sampai itu terjadi, pemindaian secret belum menjadi bukti.

## 6. Intake legal dan PII

`legal_reports` tidak punya grant/policy `anon`; hanya `authenticated` dengan
`is_admin()`. Route memvalidasi body (maks 16 KB), menolak origin lintas situs,
memakai honeypot, dan membatasi 5 laporan/jam per IP. Log hanya mencatat
`ticket_code` dan `kind`, bukan surel/deskripsi.

Risiko sisa:

- **Tidak ada masa retensi** untuk `legal_reports`; penghapusan tiket adalah
  keputusan manusia. Jangan menghapus sebelum tiket selesai dan kebijakan
  retensi ditetapkan.
- `data_reports` (tabel lama, bukan tiket legal) masih memberi `insert` kepada
  `anon` dengan policy `with check (true)`. Tidak dipakai formulir legal, tetapi
  tabel itu dapat diisi anonim; pantau pertumbuhannya.

## 7. Ringkasan risiko sisa

| Risiko | Tingkat | Tindakan |
|---|---|---|
| CSP `unsafe-inline` | Sedang | Migrasi ke nonce = keputusan arsitektur; sampai itu, jangan klaim CSP strict |
| `x-forwarded-for` dipercaya | Sedang | Pastikan platform menimpa header; uji dengan header palsu di produksi |
| `data_reports` insert anon | Sedang | Pantau ukuran tabel; bila tidak dipakai, cabut grant pada migrasi berikutnya |
| DNS rebinding TOCTOU | Rendah | Pin IP pada koneksi; sumber tetap allow-list + worker-only |
| Limiter fail-open | Rendah | Alert `rate_limit.unavailable`; jangan dianggap batas saat DB down |
| Gitleaks belum berjalan | Proses | Jalankan CI dan simpan tautan run |

## 8. Cara mengulang pemeriksaan

```bash
npm run typecheck
npm run test:security          # 102 test: sesi, header, env, legal, SSRF-related route
npm run audit:env              # nama env saja; bukan nilai
npm run check:architecture     # batas zona + jalur impor ingestion
```

Pemeriksaan manual yang belum tercakup otomatis: kirim `POST
/api/admin/ingestion/import` dengan URL privat (`http://169.254.169.254/`) dan
pastikan ditolak sebelum antrean; periksa header respons produksi dengan
`curl -sSI`; dan jalankan gitleaks di CI.

## 9. Yang tidak boleh dilakukan

1. Jangan mematikan pemeriksaan alamat privat atau allow-list agar satu sumber
   "berhasil" — itu membuka SSRF.
2. Jangan memakai `redirect: 'follow'`, dan jangan memeriksa allow-list hanya di
   URL awal.
3. Jangan menghapus rate limit karena keluhan; turunkan angkanya atau tangani di
   edge.
4. Jangan menaruh DSN/secret di `NEXT_PUBLIC_*` atau mengaktifkan SDK Sentry di
   browser.
5. Jangan memakai service-role key Supabase di aplikasi; RLS admin adalah
   batasnya.
