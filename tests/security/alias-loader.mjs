/**
 * Loader ESM untuk `node --test`: memetakan alias `@/` → `src/`.
 *
 * Route (`app/**`) berada di zona `web-request` yang berbasis bundler, sehingga
 * alias `@/` hanya dikenali `next build` — bukan `node --test`. Loader ini
 * memungkinkan integration test mengimpor route langsung tanpa mengubah satu
 * baris pun kode produksi.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const base = new URL('../../src/', import.meta.url);
    return nextResolve(new URL(specifier.replace('@/', ''), base).href);
  }
  return nextResolve(specifier, context);
}
