/**
 * Serialisasi stabil + hash isi.
 *
 * Kenapa berada di `src/lib` dan bukan di `src/services/ingestion`: fungsi ini
 * dipakai **dua sisi** yang tidak boleh saling mengimpor. Jalur request
 * (`app/api/admin/ingestion/import`) menghitung `content_hash` saat men-stage
 * dataset; worker (`services/ingestion`) menghitungnya lagi saat men-stage hasil
 * fetch. Kalau kedua sisi punya salinan algoritmanya sendiri, satu perubahan
 * kecil di salah satunya membuat indeks unik `uq_raw_pages` berhenti bekerja
 * sebagai penjaga idempotensi — dan kegagalannya sunyi. Satu implementasi di
 * zona `node-runtime` yang boleh dibaca keduanya menutup celah itu.
 *
 * Zona `node-runtime` (PRD §39): impor relatif ber-ekstensi `.ts` untuk modul
 * internal; `node:crypto` adalah specifier bare paket yang sah.
 */

import { createHash } from 'node:crypto';

/**
 * Kunci diurutkan lebih dulu, sehingga isi yang sama menghasilkan string yang
 * sama walau urutan kunci di berkas berbeda. Inilah yang membuat
 * `content_hash` bermakna sebagai kunci idempotensi, bukan sekadar sidik jari.
 */
export function stableSerialize(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v === null || typeof v !== 'object') return v;
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((key) => [key, sort((v as Record<string, unknown>)[key])]),
    );
  };
  return JSON.stringify(sort(value));
}

/** sha256 heksadesimal dari serialisasi stabil. */
export function stableContentHash(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value), 'utf8').digest('hex');
}
