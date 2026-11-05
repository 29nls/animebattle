# Launch Checklist — Anime VS Battle

**Verdict per 2026-11-05: NO-GO untuk rilis publik.**
Alasannya bukan satu bug, melainkan empat hal yang belum dapat dibuktikan:
katalog 200 karakter, p95 produksi, review legal yang disetujui, dan drill
restore backup. Detail dan bukti ada di tabel bawah.

Dokumen ini hanya boleh diisi dari hasil perintah/run nyata. Status **LULUS**
berarti ada keluaran yang dapat ditunjukkan; **BELUM TERBUKTI** berarti belum ada
bukti, bukan "hampir selesai".

## Kriteria go/no-go

| # | Kriteria | Ambang | Status | Bukti / catatan |
|---|---|---|---|---|
| 1 | Gerbang kode lokal | typecheck, lint, architecture, test, schema, battle-cases, build hijau | **LULUS** | 2026-11-05: typecheck 0, lint 0, architecture 38/38, `npm test` 523/523, schema 59/59, battle 425/0, build hijau |
| 2 | CI GitHub hijau | Semua job `verify`, `database`, `backup-restore`, `secret-scan` lulus | **BELUM TERBUKTI** | Workflow ada di repo; tidak ada run GitHub yang diamati pada sesi ini |
| 3 | Katalog siap battle | ≥ 200 karakter dengan statistik + sumber | **GAGAL** | Dataset terkurasi baru 3 karakter (73 baris impor OPM); produksi belum 200 |
| 4 | p95 pencarian di katalog besar | < 200 ms pada ≥ 200 karakter | **BELUM TERBUKTI** | Lokal 34,51 ms, tetapi hanya 3 karakter; bukan katalog sasaran |
| 5 | p95 simulasi | < 300 ms engine / < 1,5 s + narrator | **BELUM TERBUKTI** | Lokal 52,28 ms pada 3 karakter; belum diukur di produksi |
| 6 | Uptime | ≥ 99,5% (K7) | **BELUM TERBUKTI** | Belum ada riwayat monitor; workflow uptime belum pernah berjalan |
| 7 | Backup teruji | Restore ke database scratch + `verify:restore` identik | **GAGAL** | Job CI `backup-restore` terpasang, tetapi belum pernah dieksekusi/diamati; PITR belum diuji |
| 8 | Auth admin aktif | Login Supabase + TOTP; rute admin fail-closed | **BELUM TERBUKTI (produksi)** | Kode + 102 test keamanan lulus; login produksi tidak diverifikasi ulang hari ini |
| 9 | Review legal disetujui | `docs/legal/source-review.md` ditandatangani | **GAGAL** | Status masih **GATE TERBUKA**; belum ada persetujuan review legal |
| 10 | Identitas badan hukum | Nama entitas, alamat, yurisdiksi, kontak di privacy/terms | **GAGAL** | Belum ada keputusan manusia; halaman memakai placeholder yang tidak boleh tayang sebagai fakta |
| 11 | Halaman legal publik | Takedown (form + tiket), privacy, terms, sumber | **SEBAGIAN** | Form menyimpan tiket + 5 test lulus; privacy/terms belum memuat identitas final |
| 12 | Observabilitas log | JSON satu baris + redaksi rahasia | **LULUS** | 5 test observability; `LOG_LEVEL` terdokumentasi |
| 13 | Error tracking | Sentry menerima event server | **TERBLOKIR** | Kode siap; `SENTRY_DSN` belum diisi, jadi no-op |
| 14 | Alert uptime | Notifikasi saat `/api/health/ready` gagal | **TERBLOKIR** | `uptime.yml` ada; `DEPLOY_URL`/`ALERT_WEBHOOK_URL` dan run pertama belum terbukti |
| 15 | Alert ingestion | Notifikasi job gagal/macet | **TERBLOKIR** | `ingestion-health.yml` ada; `DATABASE_URL`/`ALERT_WEBHOOK_URL` dan run pertama belum terbukti |
| 16 | Header keamanan + CSP | CSP, HSTS produksi, COOP/CORP, Permissions-Policy | **LULUS (dengan catatan)** | 2 test header; CSP masih `script-src 'unsafe-inline'` (bukan strict) |
| 17 | Audit env | Tidak ada secret di `NEXT_PUBLIC_*`; nama env dikenal | **LULUS (lokal)** | `npm run audit:env` memeriksa 15 nama; hanya nama, bukan nilai |
| 18 | Pemindaian secret CI | gitleaks lulus pada riwayat | **BELUM TERBUKTI** | Job `secret-scan` ditambahkan; belum pernah berjalan di GitHub |
| 19 | Rate limit rute publik | 429 setelah kuota; tidak fail-open diam-diam | **LULUS (dengan catatan)** | Search/suggest/versions/simulate/legal memakai limiter Postgres; kegagalan limiter sengaja fail-open + log |
| 20 | Review SSRF | Tidak ada fetch di jalur request pengguna; guard alamat privat | **LULUS (dengan catatan)** | Lihat [security-review.md](runbooks/security-review.md); risiko sisa DNS rebinding |
| 21 | Uji beban k6 | 0% error; ambang p95 tiap skenario | **LULUS (lokal)** | 72/60/91 permintaan, error 0%; lihat [benchmark](benchmarks/load-2026-11-05.md) |
| 22 | Migrasi produksi 0008 | `legal_reports` ada di database produksi | **BELUM TERBUKTI** | Migrasi + test lokal 7/7; penerapan produksi belum dilakukan/diamati |

## Blocker wajib sebelum GO

1. **Katalog 200 karakter** dengan statistik bersumber. Ini juga menutup
   kriteria p95 pencarian; tanpa data, angka latency tidak bermakna.
2. **Review legal disetujui** (`docs/legal/source-review.md`) dan identitas badan
   hukum/yurisdiksi di privacy + terms. Ini keputusan manusia, bukan pekerjaan
   kode.
3. **Drill restore backup** dijalankan dan hasilnya diperiksa, bukan hanya
   workflow-nya ada.
4. **Observabilitas aktif**: isi `SENTRY_DSN`, jalankan `uptime.yml` dan
   `ingestion-health.yml` minimal sekali, dan pastikan alert benar-benar sampai.
5. **Terapkan migrasi 0008** ke database produksi sebelum mengumumkan formulir
   takedown.
6. **Jalankan CI di GitHub** (termasuk gitleaks dan job database) dan simpan
   tautan run-nya sebagai bukti.

## Setelah GO (24 jam pertama)

- Pantau `/api/health/ready` dan error rate 5xx; alarm bila > 0,5% selama 15 menit.
- Pantau antrean ingestion: job `failed`, `processing` > 15 menit, `pending` > 30 menit.
- Periksa tiket `legal_reports` baru setiap hari kerja; SLA verifikasi ≤ 3 hari kerja.
- Jangan menaikkan trafik/klaim performa sampai p95 produksi diukur pada katalog
  sebenarnya.

## Cara memperbarui dokumen ini

Setiap sel Status harus menyebut bukti yang dapat diulang: perintah + tanggal,
tautan run CI, atau keluaran monitor. Jangan mengubah **BELUM TERBUKTI** menjadi
**LULUS** karena kode sudah ditulis — hanya karena bukti eksekusinya ada.
