/**
 * Slug permalink pertarungan: `karakter/form-vs-karakter/form`.
 *
 * Kenapa bentuknya begitu: pemilih di `/versus` memakai nilai `karakter/form`
 * (lihat `queries.ts`), karena slug form hanya unik **per karakter** — `base`
 * milik Goku dan `base` milik Naruto adalah dua baris berbeda. Permalink yang
 * hanya memuat slug karakter akan kehilangan sisi yang justru menentukan hasil
 * (PRD §11: engine hanya menerima `character_version_id`).
 *
 * Urutan kanonik: dua sisi diurutkan menurut `karakter/form` secara
 * leksikografis. Tanpa itu, `a-vs-b` dan `b-vs-a` menjadi dua URL untuk satu
 * pertanyaan yang sama — dua entri cache, dua canonical, dan sinyal SEO yang
 * terbelah. Halaman yang menerima urutan terbalik mengalihkan 308 ke bentuk
 * kanonik, bukan melayani dua URL.
 *
 * Modul ini murni (tanpa database, tanpa `next`), sehingga aturan slug dapat
 * diuji `node --test` seperti `conditions.ts`.
 */

import { parseBattleSelection, type BattleSelection } from './queries.ts';

/** Pemisah sisi. Karakter tidak boleh memuatnya; diperiksa saat parse. */
export const MATCHUP_SEPARATOR = '-vs-';

/** Bentuk nilai pemilih `karakter/form`, dipakai juga sebagai kunci urutan. */
export function selectionValue(selection: BattleSelection): string {
  return `${selection.characterSlug}/${selection.formSlug}`;
}

/**
 * Bandingkan dua pilihan menurut nilai kanoniknya.
 *
 * `localeCompare` sengaja tidak dipakai: hasilnya bergantung pada locale proses,
 * sehingga URL kanonik dapat berbeda antara server dan CI. Perbandingan kode
 * unit (`<`/`>`) deterministik di mana pun.
 */
export function compareSelections(a: BattleSelection, b: BattleSelection): number {
  const left = selectionValue(a);
  const right = selectionValue(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export interface CanonicalMatchup {
  /** Sisi pertama pada URL — selalu yang lebih kecil menurut `compareSelections`. */
  sideA: BattleSelection;
  sideB: BattleSelection;
  /** `sideA/sideB` dalam bentuk `karakter/form-vs-karakter/form`. */
  slug: string;
  /** `true` bila pemanggil mengirim urutan yang sudah kanonik. */
  canonical: boolean;
}

/**
 * Bangun slug kanonik dari dua pilihan.
 *
 * Mengembalikan `null` bila kedua sisi sama: pertarungan karakter dengan dirinya
 * sendiri tidak punya hasil (dan `battles` menolaknya lewat
 * `battles_distinct_sides`). Menolak di sini membuat halaman menjawab 404,
 * bukan 500 dari constraint database.
 */
export function canonicalMatchup(
  first: BattleSelection,
  second: BattleSelection,
): CanonicalMatchup | null {
  if (compareSelections(first, second) === 0) return null;

  const swap = compareSelections(first, second) > 0;
  const sideA = swap ? second : first;
  const sideB = swap ? first : second;

  return {
    sideA,
    sideB,
    slug: `${selectionValue(sideA)}${MATCHUP_SEPARATOR}${selectionValue(sideB)}`,
    canonical: !swap,
  };
}

/** Slug kanonik saja, atau `null` bila pasangannya tidak sah. */
export function matchupSlug(first: BattleSelection, second: BattleSelection): string | null {
  return canonicalMatchup(first, second)?.slug ?? null;
}

/**
 * Urai slug permalink menjadi dua pilihan.
 *
 * Ketat dengan sengaja, sama seperti `parseBattleSelection`: jumlah pemisah harus
 * tepat satu, dan setiap bagian harus berbentuk `karakter/form` yang sah. Slug
 * yang "hampir benar" (`a-vs-b-vs-c`, `a-vs-`, `a/b-vs-c`) ditolak supaya
 * halaman menjawab 404 dengan jelas alih-alih menebak sisi mana yang dimaksud.
 */
export function parseMatchupSlug(slug: string): { sideA: BattleSelection; sideB: BattleSelection } | null {
  const parts = slug.split(MATCHUP_SEPARATOR);
  if (parts.length !== 2) return null;

  const sideA = parseBattleSelection(parts[0] ?? '');
  const sideB = parseBattleSelection(parts[1] ?? '');
  if (!sideA || !sideB) return null;

  return { sideA, sideB };
}

/**
 * Tujuan pengalihan untuk slug yang bukan bentuk kanonik.
 *
 * `null` berarti tidak ada yang perlu dialihkan: slug tidak sah (pemanggil
 * menjawab 404) atau sudah kanonik (pemanggil merender halaman). Sisi yang sama
 * juga `null` — bukan pengalihan ke diri sendiri.
 */
export function canonicalRedirectTarget(slug: string): string | null {
  const parsed = parseMatchupSlug(slug);
  if (!parsed) return null;

  const canonical = canonicalMatchup(parsed.sideA, parsed.sideB);
  if (!canonical) return null;
  return canonical.slug === slug ? null : canonical.slug;
}
