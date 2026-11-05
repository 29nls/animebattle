# Branch Protection — setelan yang harus diaktifkan manual

> Dokumen ini tidak mengubah setelan GitHub. Branch protection hanya dapat
> diaktifkan oleh admin repo (atau via API dengan token admin); sesi ini tidak
> memiliki akses autentikasi GitHub. Ikuti langkah di bawah setelah workflow
> pertama berjalan minimal sekali.

## 1. Prasyarat

1. Push branch dengan `.github/workflows/ci.yml` yang sudah diperbarui.
2. Buka **Actions** dan pastikan job berikut muncul dan hijau pada commit yang
   akan dijadikan dasar:
   - `Verifikasi lengkap (9 gerbang + audit)`
   - `Migrasi + drift + Postgres nyata (RLS JWT, MV CONCURRENTLY)`
   - `Uji restore pg_dump/pg_restore`
3. Bila salah satu merah, **jangan** mengaktifkan protection yang mengunci
   branch; perbaiki dulu. Job `lighthouse.yml` juga perlu hijau pada PR yang
   menyentuh UI/anggaran (lihat PRD §29.1).

## 2. Setelan branch `main`

GitHub → **Settings → Branches → Add branch protection rule** (atau
**Rulesets → New branch ruleset**).

| Setelan | Nilai | Alasan |
|---|---|---|
| Branch name pattern | `main` | Satu branch rilis |
| Require a pull request before merging | **aktif** | Tidak ada push langsung |
| Required approvals | **1** (minimal) | Review manusia; tambah untuk tim > 2 |
| Dismiss stale pull request approvals when new commits are pushed | **aktif** | Approval tidak berlaku untuk kode baru |
| Require review from Code Owners | aktif bila `CODEOWNERS` ada | — |
| Require status checks to pass before merging | **aktif** | Gerbang CI |
| Require branches to be up to date before merging | **aktif** | Mencegah gabungan yang belum diuji ulang |
| Status checks yang wajib | lihat §3 | Nama harus persis |
| Require conversation resolution before merging | **aktif** | Temuan review tidak hilang |
| Require signed commits | opsional | Aktifkan bila semua kontributor punya kunci |
| Require linear history | **aktif** | Riwayat mudah diaudit; merge commit dilarang |
| Do not allow bypassing the above settings | **aktif** | Termasuk admin, kecuali keadaan darurat |
| Allow force pushes | **nonaktif** | Mencegah penulisan ulang riwayat |
| Allow deletions | **nonaktif** | Mencegah branch hilang |

## 3. Nama status check yang wajib

Gunakan nama **job** seperti yang tampil di Actions:

```
Verifikasi lengkap (9 gerbang + audit)
Migrasi + drift + Postgres nyata (RLS JWT, MV CONCURRENTLY)
Uji restore pg_dump/pg_restore
```

Bila memakai ruleset, tambahkan juga:

```
Lighthouse CI (mobile, 5 URL)
```

`Lighthouse` hanya berjalan pada `push`/`pull_request` yang memicunya; pastikan
ia terdaftar sebagai required hanya bila memang selalu berjalan untuk PR
tersebut,否则 PR akan menunggu selamanya. Cara aman: jadikan `ci.yml` wajib,
dan Lighthouse wajib untuk path UI melalui ruleset terpisah bila tersedia.

## 4. Environment `production` (disarankan)

GitHub → **Settings → Environments → New environment → production**:

- Required reviewers: minimal 1 (pemilik repo).
- Deployment branches: `main` saja.
- Secrets environment: `DATABASE_URL`, `CRON_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon key publik; jangan menambahkan service-role key ke aplikasi)
  (jangan taruh di repo secrets bila hanya deploy yang membutuhkannya).
- Jangan mengaktifkan "Allow administrators to bypass" kecuali benar-benar
  diperlukan.

## 5. Dependabot dan audit

- `.github/dependabot.yml` sudah mengaktifkan update mingguan npm + GitHub
  Actions.
- `npm audit --audit-level=high` adalah langkah pertama job `verify`; high/
  critical menggagalkan PR.
- Moderately severe yang tersisa (eslint/minimatch) tidak menggagalkan gate
  high, tetapi tetap harus ditinjau di PR Dependabot. Jangan memakai
  `npm audit fix --force` tanpa menjalankan seluruh gate dan build.
- Dependabot PR memakai branch protection yang sama; jangan auto-merge sebelum
  branch protection aktif dan CI stabil.

## 6. Verifikasi setelah diaktifkan

1. Buat PR uji yang mengubah satu baris README.
2. Pastikan tombol **Merge** terkunci sampai ketiga check hijau dan satu
   approval masuk.
3. Push commit baru ke PR; approval lama harus gugur.
4. Coba force-push ke `main` dari akun non-admin; harus ditolak.
5. Hapus branch uji.

Catat tanggal aktivasi dan siapa yang mengaktifkan di tabel berikut.

| Tanggal | Oleh | Catatan |
|---|---|---|
| belum diaktifkan | — | menunggu akses admin GitHub |
