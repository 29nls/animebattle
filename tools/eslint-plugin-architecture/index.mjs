/**
 * Plugin ESLint internal untuk aturan batas arsitektur.
 *
 * Ditulis sendiri, bukan memakai `eslint-plugin-boundaries`, karena tiga aturan
 * yang dibutuhkan PRD §39 tidak semuanya berbentuk "zona A tidak boleh impor
 * zona B":
 *
 * - `engine-purity` juga harus mengawasi pemakaian global dan anggota modul yang
 *   sebagian murni (`node:crypto`), bukan hanya nama modul.
 * - `no-select-star` bekerja pada isi string SQL dan rantai pemanggilan; itu
 *   sama sekali bukan aturan impor.
 * - `boundary-import` memang aturan impor, dan bentuknya yang paling sederhana —
 *   tetapi ia harus berbagi sumber kebenaran zona dengan dua aturan lain dan
 *   dengan pemeriksa cakupan, dan plugin eksternal tidak menyediakan itu.
 *
 * Konsekuensi yang perlu disadari: plugin ini ikut dirawat oleh repo ini. Karena
 * itu setiap aturan punya uji positif dan negatif (`npm run test:lint-rules`)
 * serta pembuktian pada berkas sengaja melanggar (`npm run check:architecture`).
 */

import boundaryImport from './rules/boundary-import.mjs';
import enginePurity from './rules/engine-purity.mjs';
import noSelectStar from './rules/no-select-star.mjs';

const plugin = {
  meta: {
    name: 'architecture',
    version: '0.1.0',
  },
  rules: {
    'boundary-import': boundaryImport,
    'engine-purity': enginePurity,
    'no-select-star': noSelectStar,
  },
};

export default plugin;
