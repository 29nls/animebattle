# Arah Desain Anime VS Battle

Berkas ini mendokumentasikan arah visual yang **sudah ada** di repo, bukan arah baru.
Setiap nilai di bawah disalin dari sumber yang disebut di sebelahnya. Kalau kode dan
dokumen ini berbeda, kode menang dan dokumen ini yang harus diperbaiki.

Sumber kebenaran:

- `app/globals.css` (token `@theme`, base, utility, keyframes), 402 baris.
- `app/layout.tsx` (metadata, `themeColor`, navbar, footer).
- `app/page.tsx` dan `src/components/*.tsx` (pemakaian token yang sebenarnya).

Dial: ENERGY 3 / RHYTHM 2 / MOTION 2

Baris di atas adalah kontrak. Agen yang membangun UI membaca baris itu lebih dulu
(antislop R-37), lalu memeriksa apakah keputusan barunya masih di dalam dial.

## 1. Identitas

**Apa ini:** basis data pertarungan karakter fiksi dengan mesin simulasi
deterministik. Pengguna memilih dua form karakter, lalu membaca hasil yang bisa
dipertanggungjawabkan: probabilitas, alasan ber-rujukan, dan keterbatasan.

**Kesan yang dituju:** arena gelap yang serius, bukan fan page. Latarnya nyaris
hitam, dua aksen bersuhu berlawanan mewakili dua petarung, dan angka adalah
bintang utamanya. Tidak ada ilustrasi dekoratif, tidak ada maskot, tidak ada
testimoni.

**Satu kalimat arah:** papan skor arena di ruang gelap, tempat merah dan biru
bertemu di satu titik VS.

**Yang sengaja tidak ada:**

- Mode terang. `html { color-scheme: dark }` dan token dipisah agar penambahan
  nanti tidak menuntut audit ulang, tetapi MVP hanya gelap.
- Gambar karakter. `app/characters/page.tsx` memakai kotak placeholder CSS dan
  mencatat alasannya di komentar; artwork menunggu pipeline (PRD F-23).
- Em dash (U+2014) di teks yang ditulis agen (antislop R-02).

## 2. Palet

Semua warna antarmuka ditulis dalam OKLCH. Hex hanya muncul di dua tempat yang
memang menuntutnya: `themeColor` di `app/layout.tsx` (dibaca browser sebelum CSS
ada) dan SVG OG image di `app/og/versus/[...matchup]/route.tsx` (SVG mandiri tanpa
akses ke CSS). Jangan menambah hex baru di komponen React.

### 2.1 Surface

Tangga gelap dengan undertone biru tipis. Naik satu langkah berarti naik satu
lapis elevasi, bukan sekadar variasi.

| Token | Nilai | Peran |
|---|---|---|
| `--color-surface-0` | `oklch(0.13 0.015 270)` | Latar halaman (`html`) |
| `--color-surface-1` | `oklch(0.17 0.02 268)` | Kartu dan panel isi |
| `--color-surface-2` | `oklch(0.22 0.025 266)` | Elemen di dalam kartu: badge, bar kosong, input |
| `--color-surface-3` | `oklch(0.28 0.03 265)` | Keadaan hover/aktif, blok kode, thumbnail kosong |
| `--color-surface-4` | `oklch(0.34 0.03 264)` | Thumb scrollbar saat hover, batas atas tangga |

Aturan: komponen tidak menulis warna latar sendiri. Kalau butuh latar baru,
pilih salah satu dari lima ini. `surface-4` adalah ujung tangga; jangan menambah
`surface-5` tanpa memperbarui tabel ini.

**Ketidakcocokan yang diketahui.** `themeColor` di `app/layout.tsx` bernilai
`#1a1a2e`, sedangkan `surface-0` setara sekitar `#05070d`. Artinya bilah browser
di perangkat mobile berwarna lebih terang daripada halaman. Ini belum diperbaiki
karena mengubahnya berarti menyentuh metadata, bukan dokumen desain. Kalau ada
yang mengambil tugas itu, samakan dengan `surface-0` dan catat hasilnya di sini.

### 2.2 Ink

Empat tingkat teks. `ink-0` untuk hal yang paling penting, `ink-3` untuk metadata
yang tetap harus terbaca.

| Token | Nilai | Peran | Kontras terendah di surface-0..2 |
|---|---|---|---|
| `--color-ink-0` | `oklch(0.97 0.005 265)` | Judul, angka, nama pemenang | 15,9:1 |
| `--color-ink-1` | `oklch(0.88 0.01 265)` | Teks isi utama (`body`) | 12,1:1 |
| `--color-ink-2` | `oklch(0.68 0.015 265)` | Teks sekunder, label, keterangan | 6,0:1 |
| `--color-ink-3` | `oklch(0.64 0.02 265)` | Metadata, placeholder, catatan kecil | 5,15:1 |

Angka kontras dihitung dari nilai token dengan rumus WCAG 2.x (sRGB relatif
luminans), bukan dikutip dari alat lain. Di `surface-3`, satu-satunya tingkat
yang membuat `ink-3` mepet, nilainya 4,34:1. Itu di bawah ambang AA 4,5:1 untuk
teks normal, jadi `ink-3` tidak boleh dipakai di atas `surface-3` kecuali untuk
teks besar (≥ 18,66 px tebal atau ≥ 24 px biasa, ambang 3:1).

`ink-3` pernah bernilai `0.52` dan gagal audit `color-contrast` Lighthouse.
Dihitung ulang, nilai lama hanya mencapai 3,65:1 di `surface-0`, 3,47:1 di
`surface-1`, 3,14:1 di `surface-2`, dan 2,65:1 di `surface-3`, semuanya di bawah
ambang AA 4,5:1. Nilainya dinaikkan ke `0.64` (kini 5,98 sampai 4,34:1) dan
komentar di `app/globals.css` menyimpan alasan itu. Jangan menurunkannya kembali
demi tampilan yang lebih redup.

### 2.3 Aksen

Dua aksen utama adalah identitas produk: A selalu merah, B selalu biru. Empat
aksen status dipakai hanya untuk keadaan, bukan hiasan.

| Token | Nilai | Arti | Pemakaian |
|---|---|---|---|
| `--color-accent-a` | `oklch(0.72 0.22 25)` | Petarung A | 30 kemunculan |
| `--color-accent-b` | `oklch(0.7 0.18 255)` | Petarung B, fokus, tautan | 90 kemunculan |
| `--color-accent-win` | `oklch(0.76 0.17 155)` | Menang, data lengkap | 16 |
| `--color-accent-lose` | `oklch(0.7 0.19 25)` | Gagal, data kurang | 22 |
| `--color-accent-flag` | `oklch(0.8 0.15 85)` | Peringatan, keyakinan rendah, offline | 68 |
| `--color-accent-draw` | `oklch(0.75 0.12 200)` | Seri | 0 (cadangan) |

Hitungan pemakaian diambil dari `app/**` dan `src/**` saat dokumen ini ditulis.
Angka itu berguna sebagai pemeriksaan kewajaran, bukan target.

`accent-draw` dan `--color-grad-win-*` sudah ada di token tetapi belum dipakai
komponen mana pun. Keduanya dipertahankan karena maknanya jelas (seri, kemenangan)
dan akan dipakai saat tampilan hasil seri dibangun lebih jauh. Jangan menghapus
token hanya karena hitungannya nol.

Kontras aksen di atas `surface-0` sampai `surface-2`: A 6,60 / 6,28 / 5,68,
B 7,33 / 6,97 / 6,31, win 10,04 / 9,54 / 8,64, lose 6,92 / 6,58 / 5,96,
flag 10,67 / 10,14 / 9,19, draw 9,48 / 9,02 / 8,17. Semua lolos AA untuk teks
normal, bahkan di surface paling terang. `accent-lose` adalah yang paling mepet
(5,96:1 di `surface-2`), jadi jangan memakainya untuk teks di atas `surface-3`.

### 2.4 Garis

| Token | Nilai | Peran |
|---|---|---|
| `--color-line` | `oklch(0.28 0.02 268)` | Garis default kartu dan pemisah |
| `--color-line-strong` | `oklch(0.42 0.03 265)` | Batas yang harus terlihat: input, panel VS, garis putus-putus |
| `--color-line-glow` | `oklch(0.5 0.1 255 / 0.3)` | Belum dipakai; disediakan untuk sorot tepi |

Garis tipis adalah struktur, bukan dekorasi. Kartu memakai `border-line`, dan
hanya elemen yang memang harus menonjol (panel pemilih petarung, keadaan kosong)
memakai `line-strong`.

### 2.5 Gradien

| Token | Nilai | Peran |
|---|---|---|
| `--color-grad-a-from` | `oklch(0.65 0.25 20)` | Ujung terang gradien A, 4 rujukan di CSS |
| `--color-grad-a-to` | `oklch(0.55 0.2 350)` | Ujung gelap gradien A (merah ke magenta); hanya di `.vs-badge`, kelas yang tidak dipakai |
| `--color-grad-b-from` | `oklch(0.6 0.2 250)` | Ujung terang gradien B, **tidak dipakai** |
| `--color-grad-b-to` | `oklch(0.5 0.18 280)` | Ujung gelap gradien B (biru ke ungu), dipakai 2 kali |
| `--color-grad-win-from` | `oklch(0.7 0.2 150)` | Cadangan untuk keadaan menang, tidak dipakai |
| `--color-grad-win-to` | `oklch(0.6 0.15 180)` | Cadangan untuk keadaan menang, tidak dipakai |

Gradien dipakai di tiga tempat yang punya alasan:

1. **Logo VS** (`bg-gradient-to-br from-accent-a to-accent-b`). Dua petarung
   bertemu dalam satu tanda. Ini motif identitas. Tanda VS yang lebih kecil di
   formulir, `/versus`, dan `/compare` memakai `.text-gradient-vs`, gradien teks
   merah ke jingga; alasan yang sama, ukuran berbeda. Judul halaman juga memakai
   gradien teks yang sama untuk satu kata kunci ("Database **Karakter**",
   "Bandingkan **Statistik**"), sehingga ada 8 pemakaian.
2. **Tombol aksi utama** (`.btn-primary`, `.btn-battle`). Gradien menandai satu
   tindakan yang paling penting di halaman.
3. **Bar probabilitas dan stat** (`.prob-bar-a/b`, `.stat-bar-fill-a/b`).
   Gradien menunjukkan arah kepemilikan: merah ke kiri, biru ke kanan.

Catatan pemakaian: bar A memakai `grad-a-from` menuju `accent-a`, dan bar B
memakai `accent-b` menuju `grad-b-to`. Jadi `grad-b-from` memang tidak terpakai,
bukan karena lupa, melainkan karena ujung birunya sudah diwakili `accent-b`.

Selain tiga itu, gradien adalah hiasan dan harus dihapus. Sorotan latar
(`bg-accent-a/20 blur-[80px]` di hero) adalah pengecualian yang dihitung sebagai
bagian dari komposisi hero, bukan gradien tambahan.

`.text-gradient-hero` hanya muncul di dua tempat: kata "Debat" di H1 beranda dan
hover nama situs di navbar. Itu satu-satunya gradien teks di luar tanda VS.

### 2.6 Bayangan dan cahaya

| Token | Nilai | Peran |
|---|---|---|
| `--shadow-card` | `0 2px 12px oklch(0 0 0 / 0.25), 0 0 1px oklch(0 0 0 / 0.4)` | Kartu diam |
| `--shadow-card-hover` | `0 8px 32px oklch(0 0 0 / 0.35), 0 0 1px oklch(0 0 0 / 0.5)` | Kartu saat hover |
| `--shadow-glow-a` | `0 0 30px oklch(0.65 0.25 20 / 0.2)` | Sorot merah, belum dipakai |
| `--shadow-glow-b` | `0 0 30px oklch(0.6 0.2 250 / 0.2)` | Sorot biru, dipakai sekali pada hover kartu karakter |

Bayangan gelap menandai elevasi. Sorotan berwarna hanya dipakai saat elemen
menyatakan pihaknya (kartu karakter B, badge VS). Jangan memberi sorot ke semua
komponen sekaligus; itu menghapus makna sorot itu sendiri.

### 2.7 Warna literal di lapisan utility

Tidak semua warna di repo lewat token. `app/globals.css` punya 28 baris `oklch()`
di luar blok `@theme`, dan sebagian besar adalah nilai literal yang ditulis
di tempat: latar dan garis `.glass`, garis hover `.card-hover`, sorot `.vs-badge`,
seluruh keluarga `.tier-*`, `.advantage-*`, pola `.hero-grid` dan `.hero-radial`,
tiga gradien teks dan tombol, cincin fokus `.input-field`, kilau `.skeleton`, dan
tiga `text-shadow`.

Itu warisan lapisan utility, bukan pola yang boleh ditiru. Aturannya:

- Komponen React memakai token. Tidak ada `oklch()` baru di `app/**` atau
  `src/**` selama token yang setara sudah ada.
- Kalau sebuah utility butuh warna yang belum ada, angkat nilainya menjadi token
  di `@theme` lebih dulu, lalu pakai token itu. Jangan menyalin literal dari
  utility lama ke komponen baru.
- `.tier-*` adalah pengecualian yang disadari: empat tingkat dengan empat warna
  berbeda, dan pemetaannya ke token aksen akan mengaburkan arti tingkat. Kalau
  nanti dirapikan, jadikan empat token bernama, bukan empat literal.

Dokumen ini tidak menghitung 28 baris itu sebagai bagian dari palet. Palet yang
mengikat ada di 2.1 sampai 2.6.

## 3. Tipografi

### 3.1 Keluarga huruf

| Token | Nilai | Peran |
|---|---|---|
| `--font-sans` | `'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif` | Seluruh antarmuka (`body`) |
| `--font-mono` | `ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace` | ID, versi, potongan kode, rujukan |
| `--font-display` | `'Inter', ui-sans-serif, system-ui, sans-serif` | Disiapkan untuk judul besar; tidak dipakai |

`font-mono` dipakai 36 kali, 24 di antaranya di panel admin untuk ID entitas,
nama aksi audit, dan nilai mentah. Sisanya di halaman publik: ID galat, hash,
ID pertarungan, nama tabel, kode tiket laporan, dan nama form pilihan. Itu
pembagian yang benar: mono menandakan "ini nilai yang disalin apa adanya", bukan
pilihan gaya untuk teks biasa.

**Catatan jujur tentang Inter.** Komentar di `app/globals.css` baris 48 menyebut
Inter dimuat lewat `next/font`, tetapi tidak ada satu pun impor `next/font` di
repo, tidak ada `@font-face` di CSS hasil build, dan Inter bukan dependensi di
`package.json`. Artinya: selama berkas font tidak benar-benar dimuat, pengguna
mendapat `ui-sans-serif` atau `system-ui` dari perangkatnya.

Keputusan yang berlaku sampai ada perubahan: **jangan mengandalkan Inter sebagai
fakta.** Rancang dengan metrik font sistem, dan jangan memakai angka kerning yang
hanya benar untuk Inter. Kalau Inter ingin benar-benar dipakai, itu perubahan
terpisah: tambahkan `next/font/google`, ukur ulang, lalu perbarui tabel ini.

### 3.2 Skala

Tidak ada token ukuran huruf khusus. Skala memakai utilitas Tailwind yang sudah
terpasang, dan pemakaian nyatanya di repo seperti ini:

| Peran | Kelas | Ukuran | Contoh |
|---|---|---|---|
| Judul hero | `text-5xl sm:text-7xl` | 48 / 72 px | H1 beranda (satu-satunya) |
| Judul halaman | `text-3xl` dengan `sm:text-4xl` atau `sm:text-5xl` | 30 lalu 36 atau 48 px | 12 dari 24 H1, termasuk halaman karakter |
| Judul halaman tetap | `text-3xl` | 30 px | 7 H1: panel admin, `app/error.tsx`, `app/global-error.tsx` |
| Judul halaman besar | `text-4xl sm:text-5xl` | 36 / 48 px | H1 404 |
| Judul panel admin | `text-2xl` | 24 px | Dua H1 di `/admin/login` |
| Judul galat sempit | `text-lg` | 18 px | H1 `/versus/result` saat simulasi gagal |
| Judul bagian | `text-2xl` | 24 px | "Impor terakhir", "Pertarungan Populer" |
| Subjudul kartu | `text-xl` | 20 px | "Database Karakter" |
| Teks isi | `text-sm` | 14 px | Mayoritas paragraf |
| Metadata | `text-xs` | 12 px | Label, tanggal, satuan |
| Metadata terkecil | `text-[0.65rem]` | 10,4 px | Catatan kaki kartu, persentase |

Frekuensi sesungguhnya: `text-sm` 144 kali, `text-xs` 140, `text-[0.65rem]` 29,
`text-[0.7rem]` 16, `text-[0.6rem]` 10. Antarmuka ini padat dan berbasis tabel,
jadi ukuran kecil adalah pilihan sadar, bukan kelalaian. Yang wajib dijaga adalah
kontrasnya: teks di bawah 12 px hanya boleh memakai `ink-2` atau lebih terang.

Ukuran pecahan (`text-[0.7rem]` dan sejenisnya) muncul hampir seluruhnya di panel
admin, tempat kepadatan informasi lebih penting daripada kenyamanan membaca.
Halaman publik sebaiknya tetap di `text-xs` ke atas.

### 3.3 Berat

| Berat | Kelas | Pemakaian |
|---|---|---|
| 900 | `font-black` | Angka, nama pemenang, H1, logo VS (33) |
| 700 | `font-bold` | Judul bagian dan label tegas (104) |
| 600 | `font-semibold` | Tombol, label formulir (16) |
| 500 | `font-medium` | Navigasi, teks isi ringan (53) |
| 400 | bawaan | Paragraf |

Tidak ada `font-extrabold` dan tidak ada `font-normal` eksplisit. Perbedaan berat
adalah alat hierarki utama di sini, karena ukuran huruf tidak boleh terlalu jauh
bervariasi di halaman data yang padat.

### 3.4 Perlakuan khas

- **Huruf besar berjarak lebar** untuk label kecil: `uppercase tracking-wider`
  (24 kali) dan `tracking-widest` (7 kali). Ukurannya 10 sampai 14 px, tidak
  pernah lebih. Dipakai pada label status, judul banner hasil, judul bagian
  seperti "Keterbatasan", dan subjudul logo. Ini bagian dari motif identitas:
  teks kecil yang berteriak pelan seperti papan skor.
- **Huruf besar tanpa jarak tambahan** muncul 11 kali lagi, semuanya kepala tabel
  `<thead>` dan badge status di panel admin serta tabel sumber. `uppercase` tanpa
  `tracking` hanya boleh untuk konteks tabel padat seperti itu; untuk label
  mandiri, pakai pasangan `uppercase tracking-wider`.
- **Angka rata kolom** untuk angka yang berubah: `tabular-nums` (4 kali) pada
  statistik katalog dan hitungan impor. Angka yang dibandingkan harus sejajar.
- **Miring** hanya sekali, untuk skenario potensial di narasi engine. Jangan
  menambah pemakaian miring untuk penekanan biasa.
- **Gradien pada teks** hanya untuk dua kelas. `.text-gradient-hero` untuk kata
  "Debat" di H1 beranda dan hover nama situs. `.text-gradient-vs` untuk tanda VS
  dan satu kata kunci di H1 halaman daftar (8 pemakaian). Bukan untuk judul
  bagian, bukan untuk teks isi.

### 3.5 Emoji

Emoji dipakai 32 kali di 14 berkas, dan hampir selalu sebagai penanda satu kata,
bukan pengganti sistem ikon. Contoh yang paling sering: ⚠️ (3 kali, peringatan
data), ⚔️ (3 kali, keadaan kosong dan tombol simulasi), 🌌 (3 kali, entitas
verse), 📊 dan 📥 (2 kali masing-masing). Delapan di antaranya ada di panel admin,
enam sebagai label navigasi dan dua sebagai penanda keadaan kosong.

Aturan yang berlaku dari pemakaian nyata itu:

- Emoji boleh menempel pada judul, tombol, atau baris navigasi. Jangan menjadikan
  emoji sebagai satu-satunya isi keadaan kosong tanpa teks pendamping.
- Emoji dekoratif sebaiknya `aria-hidden="true"`, tetapi ini baru dilakukan di 6
  dari 32 baris. Itu utang aksesibilitas yang harus dibayar saat menyentuh
  berkasnya, bukan alasan menambah emoji baru.
- Jangan menambah emoji baru untuk hiasan. Kalau butuh ikon, pakai SVG garis
  seperti di kartu karakter dan tautan beranda, bukan emoji.

### 3.6 Ritme vertikal

Jarak antar blok memakai skala Tailwind tanpa token tambahan: `gap-2` sampai
`gap-8` di dalam komponen, `mt-6`/`mt-8`/`mt-12`/`mt-16` antar bagian, dan
`py-8 sm:py-12` pada `main`. Halaman data memakai jarak lebih rapat daripada
beranda; beranda boleh bernapas karena ia etalase.

### 3.7 Lebar dan grid

Satu wadah global: `max-w-6xl` (72 rem) dengan `px-4 sm:px-6`, dipakai navbar,
`main`, dan footer. Isi yang lebih sempit memakai `max-w-3xl` (formulir hero),
`max-w-2xl` (paragraf pengantar), dan `max-w-md`/`max-w-sm` (formulir kecil).

Grid beranda: `grid-cols-2 sm:grid-cols-5` untuk statistik katalog,
`sm:grid-cols-2` untuk kartu pengantar, `sm:grid-cols-3` untuk daftar impor, dan
`sm:grid-cols-2 lg:grid-cols-3` untuk pertarungan populer.

Pola umum di seluruh repo: satu kolom di ponsel, dua di `sm`, tiga di `lg`. Ada
juga `lg:grid-cols-2` untuk pasangan panel dan `lg:grid-cols-4` untuk empat kartu
ringkas di panel admin. Dua halaman memakai rasio eksplisit
`lg:grid-cols-[2fr_1fr]` (isi plus bilah samping). Yang tidak ada: breakpoint di
luar `sm`, `lg`, dan `xl`. Jangan menambah breakpoint baru hanya untuk satu
bagian.

## 4. Bentuk, sudut, dan elevasi

| Token | Nilai | Peran |
|---|---|---|
| `--radius-card` | `0.875rem` (14 px) | Disiapkan untuk kartu; tidak dipakai, kode memakai `rounded-2xl` (16 px) |
| `--radius-pill` | `9999px` | Disiapkan untuk pil; tidak dipakai, kode memakai `rounded-full` |

Pemakaian radius sesungguhnya: `rounded-2xl` 49 kali (panel besar, kartu
hasil), `rounded-lg` 47 (tombol, input, badge persegi), `rounded-xl` 31 (kartu
katalog, panel pemilih), `rounded-full` 19 (titik status, badge VS, pil), dan
`rounded-sm`/`rounded-md` untuk potongan kecil.

Aturan: satu tingkat radius per tingkat elemen. Panel besar `2xl`, kartu `xl`,
kontrol `lg`, penanda `full`. Jangan memakai `full` untuk tombol lebar; pil
adalah bahasa badge di sini, bukan bahasa tombol.

Lapisan utility menulis radius sendiri dalam nilai mentah: `4px` untuk badge
status, `0.625rem` (10 px) untuk `.btn-primary`, `.btn-battle`, dan
`.input-field`, serta `0.5rem` (8 px) untuk `.prob-bar` dan `.stat-bar`. Dua nilai
pertama setara `rounded` dan `rounded-lg`; yang ketiga sedikit di bawah `rounded-lg`.
Untuk komponen baru, pakai kelas Tailwind, bukan angka mentah.

**Kaca (glass).** `.glass` dan `.glass-strong` ada di CSS, tetapi yang dipakai
hanya `glass-strong` (6 tempat: navbar, panel pemilih A/B di `/versus` dan
`/compare`, formulir hero). Itu sudah batas wajar: kaca hanya untuk permukaan
yang melayang di atas latar, bukan untuk semua kartu. Jangan menambah pemakaian
kaca pada kartu isi biasa.

### 4.1 Keadaan interaksi

| Keadaan | Perlakuan | Sumber |
|---|---|---|
| Fokus keyboard | `outline: 2px solid accent-b`, `offset 2px` | `:focus-visible` global |
| Fokus input | Border `accent-b` plus cincin `oklch(0.6 0.2 255 / 0.15)` setebal 3 px, `outline: none` | `.input-field:focus` |
| Hover kartu | Naik 2 px, `shadow-card-hover`, border memudar | `.card-hover` |
| Nonaktif | `disabled:opacity-60` plus `disabled:cursor-not-allowed` | `src/components/takedown-form.tsx` |

Di cincin fokus, `accent-b` berperan sebagai penanda fokus, bukan sebagai warna
pihak B. Dua peran itu kebetulan memakai token yang sama, dan itu wajar karena
biru adalah warna interaksi di sini. Jangan menghapus `outline` global demi
estetika; `outline: none` hanya boleh muncul bersamaan dengan pengganti yang
sama-sama terlihat (seperti pada `.input-field:focus`).

## 5. Dial

Dial: ENERGY 3 / RHYTHM 2 / MOTION 2

### 5.1 ENERGY 3: berani, bukan riuh

Alasan: beranda memasang H1 `text-5xl sm:text-7xl` dengan `font-black`, satu kata
bergradien, badge status berdenyut, dua lingkaran cahaya merah dan biru di latar,
grid halus, dan panel kaca di tengah dengan pendar di belakangnya. Ini bukan
bahasa Linear yang tenang.

Puncak energi halaman ada di hero: dua lingkaran `blur-[80px]` merah dan biru di
latar, ditambah satu lapisan gradien `animate-pulse-glow` di belakang formulir.
Ketiganya sengaja hanya ada di sana. Jangan menyalin pola itu ke bagian lain.

Yang membuatnya tetap terkendali: hanya **satu** titik terang per layar. Di
beranda, titik itu adalah formulir pemilih lawan. Di halaman hasil, titik itu
adalah nama pemenang dan bar probabilitas. Semua yang lain turun satu tingkat.

Konsekuensi untuk pekerjaan baru: bagian baru boleh punya satu elemen yang
berteriak, dan sisanya harus diam. Dua bagian yang sama-sama berteriak berarti
ENERGY naik ke 3 yang salah, yaitu riuh.

### 5.2 RHYTHM 2: konsisten dengan beberapa jeda

Alasan: beranda punya lima `<section>`: hero, statistik katalog, dua kartu
pengantar, impor terakhir, dan pertarungan populer. Tiga di antaranya memakai pola
yang sama: judul, satu baris keterangan, lalu grid. Yang memecah pola adalah hero
(lebar penuh, latar sendiri, tanpa judul bagian) dan bagian dua kartu pengantar
yang langsung berupa grid tanpa judul. Halaman data seperti `/characters` dan
`/character/[slug]` justru sengaja seragam karena isinya tabel pembanding.

Jadi ritmenya bukan "setiap bagian beda", dan bukan "semua sama". Aturannya:
setiap halaman boleh punya satu bagian yang memecah pola, biasanya yang pertama.
Sisanya mengikuti grid yang sama supaya mata bisa memindai.

Jangan menaikkan ke RHYTHM 3 (asimetris, kolase) tanpa alasan produk. Halaman ini
dibaca untuk membandingkan angka, dan kolase merusak perbandingan.

### 5.3 MOTION 2: transisi yang menjelaskan, bukan pertunjukan

Alasan: tidak ada `IntersectionObserver`, tidak ada animasi scroll, tidak ada
parallax. Yang ada adalah animasi masuk sekali jalan dan transisi keadaan.

Dalam bahasa antislop, MOTION 2 biasanya berarti "scroll-reveal dan transisi".
Repo ini hanya memakai separuh keduanya: transisi keadaan ada, scroll-reveal
tidak. Nilainya tetap 2 karena geraknya lebih dari sekadar hover (ada animasi
masuk berjeda dan empat animasi berulang), tetapi tidak pernah sampai ke
koreografi. Kalau nanti scroll-reveal ditambahkan, dial ini tidak berubah; yang
berubah adalah catatan bahwa separuh lainnya sudah terpakai.

| Gerak | Nilai | Dipakai untuk |
|---|---|---|
| `fade-in` | 0,5 dtk `ease-out` | Hampir setiap halaman saat dimuat (33 kali) |
| `fade-in-up` | 0,6 dtk `ease-out` | Blok beranda dan beberapa halaman daftar (11 kali), dengan jeda 100 sampai 500 ms |
| `slide-in-left/right` | 0,5 dtk | Tersedia, belum dipakai |
| `pulse-glow` | 3 dtk, tak terbatas | Titik status "engine aktif", pendar formulir hero, sorot VS di `/versus` |
| `float` | 4 dtk, tak terbatas | Emoji pedang di halaman 404 |
| `vs-pulse` | 2,5 dtk, tak terbatas | Tombol simulasi di `/versus` (satu-satunya) |
| `shimmer` | 1,8 dtk, tak terbatas | Kilau di dalam `.skeleton`, dipakai `app/loading.tsx` lewat `PageSkeleton` |
| `gradient-shift` | 4 dtk | Tersedia, belum dipakai |
| `card-hover` | 0,3 dtk, naik 2 px | Kartu yang bisa diklik |
| `stat-bar` / `prob-bar` | 0,8 dan 1 dtk | Bar yang lebarnya berubah; `prob-bar` dipakai di `battle-result-view.tsx`, `stat-bar` belum dipakai |

Aturan gerak:

1. **Animasi masuk hanya sekali.** `animate-fade-in-up` dengan `delay-*` dipakai
   berurutan 100, 200, 300, 400, 500 ms, seluruhnya di `app/page.tsx` (7 elemen).
   Jangan menambah delay di luar lima nilai itu, dan jangan memasang animasi masuk
   pada elemen yang muncul saat scroll.
2. **Gerak berulang hanya untuk status hidup.** `pulse-glow`, `float`, `vs-pulse`,
   dan `shimmer` boleh berulang karena masing-masing menandakan sesuatu yang
   memang berlangsung: mesin aktif, halaman kosong, ajakan bertarung, data dimuat.
3. **Hover mengangkat, bukan membesar.** `translateY(-1px)` pada `.btn-primary`,
   `-2px` pada `.btn-battle` dan `.card-hover`. Tidak ada `scale` sama sekali di
   repo, dan itu disengaja: pembesaran menggeser tata letak di halaman tabel.
   Bayangan yang naik bersama elemen sudah cukup memberi rasa terangkat.
4. **Transisi keadaan memakai `cubic-bezier(0.4, 0, 0.2, 1)`** untuk bar dan
   kartu, `ease` untuk tombol. Jangan mencampur kurva lain.
5. **Hormati `prefers-reduced-motion`.** Saat ini belum ada satu pun aturan
   `prefers-reduced-motion` di repo. Itu utang, bukan pilihan: setiap pekerjaan UI
   baru wajib menyertakan `motion-reduce:animate-none` pada elemen beranimasi
   berulang, atau menambahkan blok media query di `app/globals.css` yang
   mematikan `animation` dan `transition` saat preferensi itu aktif.

## 6. Motif identitas

Tiga hal yang harus tetap sama di setiap halaman supaya produk ini dikenali
walau logonya ditukar:

1. **Dua kutub warna.** Merah selalu pihak A, biru selalu pihak B. Tidak ada
   halaman yang membalik arti itu.
2. **Tanda VS sebagai satu-satunya ornamen.** Kotak VS bergradien merah ke biru
   muncul di navigasi (navbar dan header ponsel), dan pendar merah-biru yang
   berdenyut mengelilingi badge VS di `/versus`. Versi kecilnya memakai teks
   bergradien merah ke jingga: tiga badge VS (formulir beranda, `/versus`,
   `/compare`) dan satu kata di lima H1 halaman daftar. Tidak ada ornamen lain
   yang diulang seperti itu.
3. **Angka yang jujur.** Angka besar, tebal, dan selalu berasal dari data. Tidak
   ada angka contoh, tidak ada "10.000+ karakter", tidak ada testimoni. Ini motif
   yang tidak terlihat tetapi paling menentukan karakter produk.

## 7. Larangan

- Tanpa em dash (U+2014) di teks yang ditulis agen. Pakai koma, titik, titik dua,
  atau kurung (antislop R-02).
- Tanpa mode terang, tanpa tombol tema.
- Tanpa warna di luar token di 2.1 sampai 2.6. Tidak ada hex atau `oklch()`
  baru di komponen; lihat 2.7 untuk warna literal yang sudah terlanjur ada.
- Tanpa ilustrasi, avatar, atau logo karangan. Placeholder harus terlihat seperti
  placeholder (antislop R-23).
- Tanpa angka, statistik, atau testimoni yang tidak berasal dari database.
- Tanpa gradien sebagai hiasan. Hanya tiga pemakaian yang diizinkan di bagian 2.5.
- Tanpa `scale` pada hover dan tanpa animasi masuk yang dipicu scroll.
- Tanpa menambah tingkat radius, surface, atau bayangan baru tanpa memperbarui
  dokumen ini.

## 8. Jawaban atas gate yang mudah disalahpahami

Beberapa butir Delivery Gate terlihat gagal kalau dibaca cepat. Alasannya sudah
ada di desain nyata, jadi ditulis di sini supaya tidak perlu diulang tiap tugas.

**R-21 (mode gelap dipaksakan).** Ini pilihan merek, bukan bawaan. Seluruh
identitas bertumpu pada dua sorotan berwarna di latar nyaris hitam; di latar
terang sorotan itu hilang dan tanda VS kehilangan kontras. Alasan satu baris:
arena malam adalah panggungnya.

**R-29 (palet lebih dari tiga warna).** Yang dihitung sebagai warna adalah dua
aksen pihak (A merah, B biru). Surface dan ink adalah tangga netral, bukan warna
merek. Empat aksen status hanya muncul saat ada keadaan yang memang perlu
dibedakan, dan tidak pernah dipakai sebagai hiasan.

**R-06 (huruf besar berjarak lebar).** `tracking-wider` dan `tracking-widest`
hanya dipakai pada label 10 sampai 14 px, bukan pada teks besar. Enam di antaranya
teks 14 px: judul bagian seperti "Jejak Sumber Data", "Keterbatasan", "Asumsi",
dan "Sumber Lisensi Data". Alasannya tertulis di bagian 3.4: meniru label papan
skor, dan label itu memang selalu kecil.

**R-01 dan R-13 (gradien dan sorot).** Ada hierarki tertulis di bagian 2.5 dan
2.6. Gradien menandai pihak atau tindakan utama; sorot hanya pada elemen yang
menyatakan pihaknya.

**R-10 (kaca di banyak tempat).** Ini yang paling dekat gagal: `glass-strong`
dipakai 6 kali, yaitu navbar, formulir hero, dua panel pemilih di `/versus`, dan
dua panel di `/compare`. Semuanya permukaan yang melayang di atas latar, jadi
masih bisa dibela, tetapi kalau jumlahnya bertambah lagi, ganti salah satunya
dengan `surface-1` biasa.

**R-39 (`prefers-reduced-motion`).** Gagal, dan tidak dibela. Lihat bagian 5.3
butir 5. Ini pekerjaan yang harus diselesaikan sebelum rilis berikutnya yang
menyentuh animasi.

## 9. Cara memakai dokumen ini

1. Baca baris `Dial:` di bagian pembuka, lalu bagian 5 untuk alasannya.
2. Cari token yang dibutuhkan di bagian 2 dan 3. Kalau tidak ada, jangan mengarang;
   pakai yang terdekat dan catat alasannya di komentar kode.
3. Periksa keputusan baru terhadap bagian 5. Kalau pekerjaan itu menuntut dial
   berbeda, ubah dokumen ini lebih dulu, baru kodenya.
4. Jalankan Delivery Gate antislop dan laporkan PASS/FAIL per item.
5. Kalau dokumen ini dan kode berbeda, kode menang. Perbaiki dokumen ini di
   commit yang sama dengan perubahan kode.
