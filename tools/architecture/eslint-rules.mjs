/**
 * Perakitan aturan per zona — dipakai oleh `eslint.config.mjs` **dan**
 * `scripts/check-architecture.mjs`.
 *
 * Kenapa satu fungsi untuk keduanya: kalau pemeriksa membangun aturannya sendiri,
 * ia akan menguji aturan yang berbeda dari yang benar-benar dijalankan sehari-hari,
 * dan seluruh pembuktiannya menjadi tidak berarti. Dengan berbagi fungsi ini,
 * fixture diuji tepat dengan aturan yang sama yang dipakai pada kode produksi.
 */

import { LARGE_TABLES } from './large-tables.mjs';

export const languageOptions = {
  ecmaVersion: 'latest',
  sourceType: 'module',
  ecmaFeatures: { jsx: true },
};

export const NO_SELECT_STAR_RULE = ['error', { largeTables: LARGE_TABLES }];

/**
 * Aturan yang berlaku untuk sebuah zona.
 *
 * `zoneRootOverride` dipakai `check-architecture.mjs`: fixture berada di direktori
 * lain, sehingga akar zona harus diganti ke direktori fixture agar aturan
 * "impor relatif tidak boleh keluar zona" diuji dengan benar alih-alih selalu
 * dianggap melanggar.
 */
export function rulesForZone(zone, zoneRootOverride) {
  return {
    'architecture/no-select-star': NO_SELECT_STAR_RULE,

    ...(zone.purity
      ? {
          'architecture/engine-purity': [
            'error',
            {
              zone: zone.name,
              allowedNodeModules: zone.purity.allowedNodeModules,
              denyGlobals: zone.purity.denyGlobals,
              denyMembers: zone.purity.denyMembers,
              zoneRoot: zoneRootOverride ?? zone.root ?? null,
            },
          ],
        }
      : {}),

    'architecture/boundary-import': [
      'error',
      {
        zone: zone.name,
        deny: zone.deny ?? [],
        relativeImportsOnly: zone.relativeImportsOnly ?? false,
      },
    ],
  };
}

/** Aturan khusus untuk aturan `select *`, tanpa aturan batas zona. */
export function selectStarOnlyRules() {
  return { 'architecture/no-select-star': NO_SELECT_STAR_RULE };
}
