/**
 * `boundary-import` — aturan batas antar-zona (PRD §39, AC-25).
 *
 * Aturan ini sengaja tetap generik: zona dan pola larangannya datang dari
 * `tools/architecture/zones.mjs`, bukan dari kode rule. Menambah larangan berarti
 * menyunting berkas data itu, dan konsekuensinya seluruh larangan di repo
 * terbaca di satu tempat.
 *
 * Yang diperiksa: impor statis, re-export, `import()` dinamis, dan `require()`
 * literal. Impor yang dirakit dari string (mis. `await import('@/services/' +
 * nama)`) tidak dapat dilihat lint mana pun — itu sebabnya klaimnya dibatasi:
 * aturan ini menegakkan jalur yang **tertulis**, bukan jalur yang dikarang saat
 * runtime. Pemeriksaan runtime ada di `scripts/check-architecture.mjs` untuk
 * berkas nyata, dan di case library untuk mesin pertarungan.
 */

import { globToRegExp } from '../../architecture/glob.mjs';

/** Pencocokan glob memakai implementasi yang sama dengan pemeriksa cakupan zona. */
const globCache = new Map();
function matchesGlob(pattern, path) {
  if (!globCache.has(pattern)) globCache.set(pattern, globToRegExp(pattern));
  return globCache.get(pattern).test(path);
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Menegakkan batas antar-zona arsitektur: pola impor yang dilarang dan kewajiban impor relatif.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          zone: { type: 'string' },
          deny: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                pattern: { type: 'string' },
                except: { type: 'array', items: { type: 'string' } },
                reason: { type: 'string' },
                prd: { type: 'string' },
              },
              required: ['pattern', 'reason'],
              additionalProperties: false,
            },
          },
          relativeImportsOnly: { type: 'boolean' },
        },
        required: ['zone'],
        additionalProperties: false,
      },
    ],
    messages: {
      denied: 'Zona "{{zone}}" tidak boleh mengimpor "{{source}}" — {{reason}} ({{prd}})',
      aliasForbidden:
        'Zona "{{zone}}" dimuat Node dengan type stripping, sehingga alias "{{source}}" tidak dikenali saat runtime. Pakai jalur relatif dengan ekstensi `.ts` eksplisit (mis. `../../lib/db/client.ts`).',
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const zone = options.zone ?? 'unknown';
    const deny = options.deny ?? [];
    const filename = context.filename.replace(/\\/g, '/');

    /**
     * Menyelesaikan spesifier relatif menjadi jalur repositori, sehingga pola
     * larangan menangkap baik `@/services/ingestion/x` maupun
     * `../services/ingestion/x`.
     *
     * Tanpa langkah ini, larangan berbasis nama modul hanya menangkap satu bentuk
     * penulisan: fixture `node-runtime/ingestion-import.ts` yang memakai jalur
     * relatif lolos tanpa dilaporkan — persis jenis lubang yang akan dipakai
     * siapa saja yang ingin melewati aturan tanpa terlihat.
     */
    function canonicalTarget(source) {
      if (!source.startsWith('.')) return source;
      const dir = filename.slice(0, filename.lastIndexOf('/'));
      return `${dir}/${source}`.split('/').reduce((acc, part) => {
        if (part === '.' || part === '') return acc;
        if (part === '..') return acc.slice(0, acc.lastIndexOf('/'));
        return `${acc}/${part}`;
      }, '');
    }

    function check(node, source) {
      if (options.relativeImportsOnly === true && !source.startsWith('.')) {
        context.report({ node, messageId: 'aliasForbidden', data: { zone, source } });
        return;
      }

      const target = canonicalTarget(source);

      for (const entry of deny) {
        if (!source.includes(entry.pattern) && !target.includes(entry.pattern)) continue;

        // Pengecualian dinilai terhadap berkas yang MENGIMPOR, bukan yang diimpor:
        // zona `node-runtime` boleh memuat ingestion dari worker, tetapi tidak
        // dari modul antrian yang juga diimpor jalur request.
        const excepted = (entry.except ?? []).some((pattern) => matchesGlob(pattern, filename));
        if (excepted) continue;

        context.report({
          node,
          messageId: 'denied',
          data: { zone, source, reason: entry.reason, prd: entry.prd ?? 'PRD §39' },
        });
        return;
      }
    }

    return {
      ImportDeclaration(node) {
        if (typeof node.source.value === 'string') check(node.source, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source && typeof node.source.value === 'string') {
          check(node.source, node.source.value);
        }
      },
      ExportAllDeclaration(node) {
        if (typeof node.source.value === 'string') check(node.source, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
          check(node.source, node.source.value);
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments[0]?.type === 'Literal' &&
          typeof node.arguments[0].value === 'string'
        ) {
          check(node.arguments[0], node.arguments[0].value);
        }
      },
    };
  },
};
