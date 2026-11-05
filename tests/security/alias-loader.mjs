/**
 * Loader ESM untuk `node --test`: memetakan alias `@/` → `src/`.
 *
 * Route (`app/**`) berada di zona `web-request` yang berbasis bundler, sehingga
 * alias `@/` hanya dikenali `next build` — bukan `node --test`. Loader ini
 * memungkinkan integration test mengimpor route langsung tanpa mengubah satu
 * baris pun kode produksi.
 *
 * Berkas `.json` juga ditangani: route mengimpornya sebagai modul biasa karena
 * bundler menambahkan atribut impor sendiri, sedangkan Node menolak impor JSON
 * tanpa `with { type: 'json' }`. Atribut tidak dapat disuntikkan lewat `resolve`
 * (atribut berasal dari teks sumber), jadi berkas JSON diubah menjadi modul ESM
 * di memori yang mengekspor objek yang sama.
 */

import { readFileSync } from 'node:fs';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const base = new URL('../../src/', import.meta.url);
    return nextResolve(new URL(specifier.replace('@/', ''), base).href);
  }

  if (specifier.endsWith('.json')) {
    const resolved = await nextResolve(specifier, context);
    const json = readFileSync(new URL(resolved.url), 'utf8');
    const source = `export default ${json};`;
    return {
      url: `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`,
      shortCircuit: true,
    };
  }

  return nextResolve(specifier, context);
}
