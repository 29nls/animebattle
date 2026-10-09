# Konvensi Kontribusi

> Catatan: versi sebelumnya dari berkas ini memuat konvensi untuk proyek Java/Spring
> yang bukan milik repo ini. Seluruh isinya diganti — kode di sini TypeScript strict
> di Node, bukan JUnit/MockMvc.

## Stack & gaya bahasa

- **TypeScript strict** (`tsconfig.json`: `strict`, `verbatimModuleSyntax`,
  `erasableSyntaxOnly`, `noImplicitOverride`, `isolatedModules`).
  - `verbatimModuleSyntax` → impor tike wajib `import type { … }`; linter
    (`noImportTypeOnlyIdentifiers`-style) menolak bentuk campuran.
  - `erasableSyntaxOnly` → tanpa sintaks yang menghasilkan kode saat transpile:
    tidak ada parameter property (`constructor(readonly x: T)`), tidak ada
    `enum` runtime, tidak ada namespace berkod. Gunakan `object` literal +
    `as const`, dan isi field secara eksplisit.
  - `noFallthroughCasesInSwitch` → setiap `case` wajib `break`/`return`.
- **Node menjalankan `.ts` dengan type stripping** (bukan transpile) untuk
  unit test & worker. Konsekuensinya di zona `node-runtime`
  (`src/lib/**`, `src/services/queue/**`) dan zona lain ber-`relativeImportsOnly`:
  impor WAJIB jalur relatif + ekstensi `.ts` eksplisit untuk modul internal, dan
  paket node_modules boleh lewat specifier bare (`postgres`, `node:crypto`).
  Alias `@/` hanya sah di zona berbasis bundler (`app/**`).
- **Format**: tidak ada formatter yang ditegakkan CI; ikuti gaya berkas di sekitar
  (2 spasi, double quote untuk string ber-nested, tanda titik-koma). Fokus review
  adalah pada arsitektur, bukan perbedaan tanda kutip.

## Aturan arsitektur (yang dijaga lint, bukan review manual)

Zona dan larangan ada di `tools/architecture/zones.mjs` — satu-satunya sumber
kebenaran. Ringkas:

| Zona | Jalur | Batas utama |
|---|---|---|
| `engine` | `src/services/battle/**` | Murni: tanpa I/O, tanpa `Date`/`Math.random`/`fetch`/`process`; hanya `node:crypto.createHash` yang diizinkan dari node builtin |
| `node-runtime` | `src/lib/**`, `src/services/queue/**` | Impor relatif + ekstensi `.ts`; **dilarang** menarik `services/ingestion` ke graf impor (AC-25) |
| `ingestion-worker` | `worker/**`, `src/services/ingestion/**` | Satu-satunya tempat sah menjalankan ingestion |
| `web-request` | `app/**` (kecuali cron), `src/features/**`, `src/components/**` | Tak boleh mengimpor ingestion; hanya menulis baris antrian |
| `scheduled-worker` | `app/api/cron/**` | Boleh mengerjakan antrian; dipicu penjadwal, bukan pengguna |

Sebelum membuka PR, minimal:

```bash
npm run typecheck          # TS strict menolak fixture & tipe salah
npm run lint               # batas arsitektur + next/core-web-vitals
npm test                   # unit test engine + security + aturan lint + guard anggaran
```

Angka yang diharapkan (lihat README untuk detail): engine 225/225, security 32/32,
web 13/13, ingestion 28/28, lintrules 3/3, lighthouse-config 4/4,
`check:architecture` 38/38, `validate:battle-cases` 425/425.

## Testing philosophy

- Test engine ada di `tests/battle-engine/` (8 berkas, Node `node --test`,
  TypeScript asli — **bukan** Jest/Vitest). Fixture dibuat lewat pabrik bertipe di
  `tests/battle-engine/helpers.ts`, sehingga `npm run typecheck` menolak fixture
  tidak sah sebelum test berjalan.
- Case library end-to-end adalah **data**, bukan kode: `src/services/battle/cases/*.json`.
  Menambah cakupan = menambah JSON + `expect`; engine tidak boleh tahu kasus mana
  yang ada. Guard runner-nya dibuktikan dengan mutasi (`check:battle-guards`).
  Kasus berlabel juga menjadi input [scripts/calibrate-weights.mjs](scripts/calibrate-weights.mjs)
  (harness kalibrasi bobot, D21) — labelnya adalah pemenang kanon yang kamu
  tulis di `expect`, jadi menjaga kejujuran label = menjaga kualitas kalibrasi.
- Uji aturan lint sendiri ada di `tools/eslint-plugin-architecture/__tests__/`
  (RuleTester). Saat menambah/merubah aturan: sertakan kasus regresi untuk bug
  yang ditemukan — konvensi repo ini. Fixture batas tinggal di
  `tests/architecture/fixtures/` dan **wajib** didaftarkan di `expected.mjs`: baik
  `.ts` maupun `.tsx` diperiksa oleh invarian "setiap fixture punya harapan".
- Rute API baru wajib memakai envelope error dari `src/lib/errors.ts`
  (`apiError`) — `{ error: { code, message, details? } }` sesuai PRD §24 — dan
  kontrak handler-nya diuji di `tests/security/` dengan `Request` nyata (tanpa DB).
- Jalur yang menyentuh database diuji di `tests/ingestion/` dengan cara yang sama
  seperti `validate:schema`: `docs/schema.sql` + `docs/seed.sql` dieksekusi di
  PGlite, lalu klien itu disuntikkan lewat `setSqlClient()` dan **kode produksi
  dijalankan apa adanya** (route handler, pipeline, query panel). Jangan menulis
  mock SQL — test semacam itu akan lulus pada skema yang salah, dan itu sudah
  pernah terjadi: query konflik menyebut tabel `source_conflicts` yang tidak ada,
  dan baru ketahuan saat uji ini dijalankan. Fetch/DNS/jam disuntik lewat opsi
  pipeline (`fetchImpl`, `dnsLookup`, `clock`), sehingga kebijakan robots, SSRF,
  rate limit, dan retry dapat diuji deterministik tanpa jaringan.
- Modul `services/ingestion/*` **tidak boleh** diimpor dari `app/**` (non-cron) atau
  `src/features/**` (AC-25). Jalur request hanya menulis baris antrian/staging;
  aturan itu ditegakkan lint, jadi jangan "memindahkan" logika impor ke route
  demi menghindari worker — itu justru pelanggaran yang paling mahal.
- TDD: tulis test yang memferifikasi kontrak sebelum memperbaiki bug; buktikan
  test merah dulu, lalu hijau. Integration test (database) memakai Runner
  `validate:schema` — jalankan itu ketika menyentuh `docs/schema.sql` atau seed.

## Test helper

- `tests/battle-engine/helpers.ts` — pabrik fixture bertipe sisi A/B, rule set
  default dari `src/services/battle/fixtures/rule-set.default.json`, dan util
  asersi determinisme.
- `scripts/run-battle-cases.mjs` — runner case library yang sama yang dipakai CI.

Pastikan nama berkas test mengikuti pola `*.test.ts`: `tests/battle-engine/`
untuk engine (diikat `npm run test:engine`), `tests/security/` untuk guard &
integration test rute admin (`npm run test:security`), `tests/web/` untuk
halaman/dataset demo + token sesi (`npm run test:web`), dan `tests/ingestion/`
untuk pipeline + rute ingestion di atas skema nyata (`npm run test:ingestion`,
memakai loader alias yang sama dengan suite security karena route memakai `@/`).
`npm test` menjalankan keenam suite itu berurutan — suite baru yang tidak
terikat salah satu script akan lolos diam-diam secara lokal dan hanya gagal di CI.

**Test-driven development.** Pendekatan repo ini:

1. Mulai dari test kecil yang membuktikan kontrak modul (angka eksak, bukan rentang kabur).
2. Jalankan test → merah; implementasikan perubahan; test → hijau.
3. Case library ditambah ketika perilaku lintas-lapis (gate → hax → skor) berubah,
   bukan menggantikan unit test.
4. Refactoring diperbolehkan selama ketiga lapis di atas tetap hijau dan angka
   hasil engine untuk kasus yang sama tidak berubah — perubahan perilaku memaksa
   `rule_set_version` baru + update case JSON, bukan penyesuaian senyap ekspektasi.
