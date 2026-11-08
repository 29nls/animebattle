# Panduan Agen

Berkas ini untuk agen yang bekerja di repo ini. Isinya bukan pengantar produk (itu [README.md](README.md)), melainkan hal yang kalau tidak dibaca akan menghasilkan perubahan yang salah.

**Produk**: Anime VS Battle, Next.js App Router + TypeScript strict, battle engine deterministik, pipeline ingestion terpisah dari jalur request. Deployment produksi memakai Cloudflare D1 (`env.DB`) + R2 (`env.FILES`) lewat Freebuff Sites. Dokumen produk berbahasa Indonesia, dan **antarmuka publik juga berbahasa Indonesia saja** (D23 di [PRD](docs/PRD.md)).

## Perintah yang wajib lulus sebelum menyatakan selesai

```bash
npm run typecheck        # TS strict
npm run lint             # batas arsitektur + next/core-web-vitals
npm test                 # 7 suite berurutan, total 550 test
npm run check:architecture   # 38 pemeriksaan batas
```

Angka acuan (jangan dilaporkan sebagai "hijau" tanpa angka ini): engine 229, security 104, web 147, ingestion 31, db 32, lint-rules 3, lighthouse-config 4. Per suite: `npm run test:<nama>`.

Tambahan sesuai jenis perubahan:

| Menyentuh | Tambahan |
|---|---|
| `src/services/battle/**`, `cases/*.json` | `npm run validate:battle-cases` (425 pemeriksaan), `npm run check:battle-guards` |
| `docs/schema.sql`, `docs/schema.d1.sql`, `migrations/`, seed | `npm run validate:schema` (59 uji), `npm run test:db` |
| `app/**`, `src/components/**`, CSS | `npm run build`, lalu jalankan dan klik alurnya |
| Route API baru | test kontrak di `tests/security/` |

Database nyata butuh `DATABASE_URL`. Tanpa itu, jalur Postgres dilewati dan test yang bergantung padanya tidak membuktikan apa pun.

## Zona arsitektur

Sumber kebenaran: `tools/architecture/zones.mjs`. Ditegakkan lint, bukan review manual.

| Zona | Jalur | Batas |
|---|---|---|
| `engine` | `src/services/battle/**` | Murni. Tanpa `Date`, `process`, `console`, `fetch`, `Math.random`, `randomUUID`. Hanya `node:crypto.createHash` dari builtin. Impor relatif di dalam zona saja |
| `node-runtime` | `src/lib/**`, `src/services/queue/**` | Impor relatif + ekstensi `.ts` eksplisit. Dilarang menarik `services/ingestion` |
| `ingestion-worker` | `worker/**`, `src/services/ingestion/**` | Satu-satunya tempat sah menjalankan ingestion |
| `web-request` | `app/**` (kecuali cron), `src/features/**`, `src/components/**` | Tak boleh impor ingestion. Hanya menulis baris antrian |
| `scheduled-worker` | `app/api/cron/**` | Boleh mengerjakan antrian, dipicu penjadwal |

Konsekuensi praktis yang sering terlewat:

- `verbatimModuleSyntax` → `import type { X }` untuk tipe.
- `erasableSyntaxOnly` → tanpa `enum` runtime, tanpa parameter property, tanpa namespace berkode. Pakai `as const`.
- Alias `@/` hanya sah di zona berbasis bundler (`app/**`). Di `src/lib/**` dan `src/services/**` pakai jalur relatif ber-`.ts`.
- Jangan memindahkan logika ingestion ke route demi menghindari worker. Itu pelanggaran paling mahal di repo ini (AC-25).
- `select *` dilarang pada tabel besar. Sebut kolomnya.
- Error route memakai `apiError` dari `src/lib/errors.ts`: `{ error: { code, message, details? } }`.
- Rahasia tidak pernah masuk kode, commit, atau log. `.env*` gitignored, `.env.example` hanya placeholder.

## Skill yang tersedia

Skill ada di `.agents/skills/`, dicatat di `skills-lock.json`, dan bisa dipulihkan dengan `npx skills experimental_install`. Muat yang relevan, jangan semuanya.

| Tugas | Skill |
|---|---|
| Menyentuh UI, CSS, komponen, halaman | `antislop` (inti, selalu) + `antislop-ui` |
| Layout yang harus reflow phone ke desktop | `antislop` + `antislop-layoutmobile` |
| Kontras, keyboard, focus, affordance | `antislop` + `antislop-human` |
| Menulis teks antarmuka, label, CTA, pesan galat | `antislop` + `antislop-copywriting` |
| Menulis atau mengubah komentar kode | `antislop-code` |
| Menulis kode apa pun, meninjau diff, refactor | `karpathy-guidelines` |
| Mendesain modul, memindahkan batas, menambah guardrail | `codebase-architecture` |
| Memahami repo yang belum dikenal, onboarding | `repo-skillopt` |

### Aturan yang mengikat dari skill

**`antislop` bukan filter opsional untuk pekerjaan UI.** Tiga hal berlaku di setiap mode:

1. **R-02**: jangan menulis em dash (U+2014) di teks yang agen tulis. Pakai koma, titik, titik dua, atau kurung. Ini berlaku untuk kode, komentar, dokumentasi, dan pesan commit.
2. **R-37**: sebelum membangun UI, butuh arah desain. Repo ini **belum punya `DESIGN.md`**, tetapi arahnya sudah terbaca dari `app/globals.css`: token OKLCH, aksen A (merah) vs B (biru), `--radius-card`, `--shadow-glow-a/b`. Baca berkas itu dulu. Kalau arah tidak jelas, tanyakan atau beri label "draft tanpa arah".
3. **R-23**: jangan mengarang logo, avatar, statistik, atau testimoni. Angka di halaman harus dibaca dari database, bukan ditulis tangan. README mencatat satu insiden persis seperti ini ("lebih dari 10.000 karakter" saat katalog berisi 3).

**R-35**: jangan menyatakan UI selesai tanpa `npm run build` dan klik nyata pada setiap kontrol. Kalau tidak bisa dijalankan, katakan itu dan verifikasi lewat inspeksi kode, jangan mengklaim sudah diklik.

**Delivery Gate** milik `antislop` wajib dilaporkan PASS/FAIL per item untuk pekerjaan UI. Laporan berisi FAIL tidak boleh diserahkan.

**`karpathy-guidelines`** menolak empat kebiasaan: asumsi diam-diam, abstraksi untuk kode sekali pakai, menyentuh kode di luar tugas, dan tugas tanpa kriteria sukses. Kalau ada dua tafsir, sebutkan keduanya, jangan pilih sendiri lalu jalan.

## Konvensi kerja

- **Test lebih dulu untuk perbaikan bug.** Tulis test yang gagal, buktikan merah, lalu hijau. Test yang tidak pernah merah tidak membuktikan apa pun.
- **Jangan menulis mock SQL.** Jalur yang menyentuh database diuji dengan `docs/schema.sql` asli di PGlite lewat `setSqlClient()`. Mock akan lulus pada skema yang salah, dan itu sudah pernah terjadi di repo ini.
- **Case library adalah data.** Menambah cakupan = menambah JSON + `expect`. Engine tidak boleh tahu kasus mana yang ada. Jangan menambah `if` di engine untuk satu kasus.
- **Perubahan perilaku engine memaksa `rule_set_version` baru** plus update case JSON. Jangan menyetel ulang ekspektasi secara senyap.
- **Fixture batas arsitektur wajib didaftarkan** di `tests/architecture/fixtures/expected.mjs`, baik `.ts` maupun `.tsx`.
- **Suite test baru harus terikat ke salah satu script `test:*`**, kalau tidak ia lolos diam-diam lokal dan hanya gagal di CI.
- **Commit** memakai Conventional Commits (`feat:`, `fix:`, `build:`, `chore:`, `deploy:`), pesan menjelaskan alasan, bukan hanya isi.
- **Gaya berkas**: ikuti sekitarnya. Tidak ada formatter di CI, jadi jangan memformat ulang berkas yang tidak diminta.
- **Dokumentasi dalam bahasa Indonesia.** Istilah teknis boleh tetap Inggris.

## Peta dokumen

| Butuh | Baca |
|---|---|
| Aturan zona dan alasannya | [docs/PRD.md §39](docs/PRD.md), `tools/architecture/zones.mjs` |
| Skema tabel | [docs/schema.sql](docs/schema.sql) (Postgres), [docs/schema.d1.sql](docs/schema.d1.sql) (D1) |
| Endpoint API | [docs/PRD.md §24](docs/PRD.md), `app/api/**/route.ts` |
| Prosedur operasional | [docs/runbooks/](docs/runbooks/) |
| Status kesiapan rilis | [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md) |
| Konvensi kontribusi lengkap | [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) |

`README.md` memuat riwayat verifikasi yang panjang dan spesifik. Sebelum mengklaim sesuatu "sudah terverifikasi", cek apakah README sudah menyebut batasnya. Beberapa hal sengaja dicatat **belum** terverifikasi, misalnya login Supabase end-to-end dan target p95 pencarian di bawah 200 ms.
