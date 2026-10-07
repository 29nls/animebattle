/**
 * `engine-purity` — engine pertarungan bebas I/O (PRD §39).
 *
 * Kenapa aturan ini ditulis sebagai rule sendiri, bukan sekadar
 * `no-restricted-imports`: yang harus dilarang bukan hanya modul, melainkan juga
 * *cara* memakai modul yang sebagian murni. `node:crypto` contohnya: `createHash`
 * murni (input sama → hash sama), sementara `randomUUID` tidak. Melarang seluruh
 * modul akan menghukum engine yang justru membutuhkannya, dan larangan yang
 * menghukum kode yang benar akan dimatikan orang lewat `eslint-disable`.
 *
 * Yang dijaga aturan ini adalah sifat yang membuat seluruh repo ini dapat
 * dipercaya: hasil pertarungan harus merupakan fungsi dari input — dari
 * `input_hash` saja harus dapat direproduksi. Satu `Date.now()` di dalam engine
 * sudah cukup untuk membatalkan jaminan itu, dan kegagalannya akan muncul sebagai
 * kegagalan determinisme yang sulit dilacak.
 */

import { dirname, isAbsolute, resolve, sep } from 'node:path';

function memberName(parts) {
  return parts.join('.');
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Menjaga engine pertarungan bebas I/O dan deterministik (PRD §39, PRD §43).',
    },
    schema: [
      {
        type: 'object',
        properties: {
          zone: { type: 'string' },
          /** Modul yang boleh diimpor → daftar anggota yang boleh dipakai. */
          allowedNodeModules: {
            type: 'object',
            additionalProperties: { type: 'array', items: { type: 'string' } },
          },
          denyGlobals: { type: 'array', items: { type: 'string' } },
          denyMembers: { type: 'array', items: { type: 'string' } },
          /** Akar zona; impor relatif yang keluar dari sini tetap pelanggaran. `null` = tidak dibatasi. */
          zoneRoot: { type: ['string', 'null'] },
        },
        required: ['zone'],
        additionalProperties: false,
      },
    ],
    messages: {
      externalImport:
        'Engine hanya boleh mengimpor modul relatif di dalam services/battle. Impor "{{source}}" berarti engine bergantung pada I/O atau lingkungan, dan hasilnya tidak lagi dapat direproduksi dari input_hash.',
      outsideZone:
        'Impor relatif "{{source}}" keluar dari "{{root}}" menuju "{{target}}". Engine boleh mengimpor relatif, tetapi hanya di dalam zonanya sendiri: impor yang menembus keluar diam-diam menarik modul lain (mis. ingestion) ke dalam graf engine.',
      unlistedMember:
        'Engine boleh mengimpor "{{module}}", tetapi hanya anggota {{allowed}}. "{{member}}" tidak termasuk: pemakaiannya membuat hasil bergantung pada nilai acak atau keadaan luar.',
      wildcardImport:
        'Impor namespace dari "{{module}}" tidak dapat diperiksa anggota mana yang dipakai. Impor anggotanya secara eksplisit (mis. `import { createHash } from \'node:crypto\'`).',
      deniedGlobal:
        'Nilai global "{{name}}" dilarang di engine: ia membuat hasil bergantung pada waktu, lingkungan, jaringan, atau keluaran terminal, bukan pada argumen fungsi.',
      deniedMember:
        'Anggota "{{name}}" dilarang di engine karena tidak deterministik. Nilai acak dan waktu adalah dua cara tercepat membuat hasil tidak dapat direproduksi (PRD §43).',
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const zone = options.zone ?? 'engine';
    const allowedNodeModules = options.allowedNodeModules ?? {};
    const denyGlobals = new Set(options.denyGlobals ?? []);
    const denyMembers = new Set(options.denyMembers ?? []);
    /**
     * Akar zona dalam jalur absolut.
     *
     * Perbandingan path harus dilakukan pada basis yang sama. Versi pertama rule
     * ini membandingkan `context.filename` (absolut) dengan `zoneRoot` (relatif),
     * sehingga setiap impor relatif dianggap keluar zona — dan rule itu menuduh
     * seluruh engine sungguhan sebagai pelanggar. Yang menangkapnya bukan review,
     * melainkan pemeriksaan "kode nyata bebas pelanggaran" di
     * scripts/check-architecture.mjs.
     */
    const zoneRoot = options.zoneRoot
      ? isAbsolute(options.zoneRoot)
        ? options.zoneRoot
        : resolve(context.cwd, options.zoneRoot)
      : null;

    /** Menyelesaikan impor relatif menjadi jalur absolut yang sudah dinormalkan. */
    function resolveImport(source) {
      return resolve(dirname(context.filename), source);
    }

    /** Apakah jalur hasil resolusi masih berada di dalam akar zona? */
    function escapesZone(source) {
      if (zoneRoot === null) return false;
      const target = resolveImport(source);
      return target !== zoneRoot && !target.startsWith(`${zoneRoot}${sep}`);
    }

    /** Apakah identifier ini benar-benar merujuk ke global (bukan variabel lokal)? */
    function isGlobalReference(node) {
      let scope = context.sourceCode.getScope(node);
      while (scope) {
        if (scope.variables.some((variable) => variable.name === node.name)) return false;
        if (scope.through.some((ref) => ref.identifier === node)) return true;
        scope = scope.upper;
      }
      return true;
    }

    function checkImportSource(node, source) {
      if (source.startsWith('.')) {
        if (escapesZone(source)) {
          context.report({
            node,
            messageId: 'outsideZone',
            data: {
              source,
              // Ditampilkan relatif agar pesan dapat dibaca; nilainya absolut
              // untuk perbandingan, bukan untuk dibaca manusia.
              root: options.zoneRoot ?? String(zoneRoot),
              target: resolveImport(source).split(sep).slice(-4).join('/'),
            },
          });
        }
        return;
      }

      if (!(source in allowedNodeModules)) {
        context.report({ node, messageId: 'externalImport', data: { source } });
        return;
      }

      const allowed = allowedNodeModules[source] ?? [];

      if (
        node.type === 'ImportDeclaration' &&
        node.specifiers.some((specifier) => specifier.type === 'ImportNamespaceSpecifier')
      ) {
        context.report({ node, messageId: 'wildcardImport', data: { module: source } });
        return;
      }

      if (node.type !== 'ImportDeclaration') return;

      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportDefaultSpecifier') {
          context.report({
            node: specifier,
            messageId: 'unlistedMember',
            data: { module: source, member: 'default', allowed: allowed.join(', ') },
          });
          continue;
        }
        if (specifier.type === 'ImportSpecifier') {
          const imported =
            specifier.imported.type === 'Identifier'
              ? specifier.imported.name
              : specifier.imported.value;
          if (!allowed.includes(imported)) {
            context.report({
              node: specifier,
              messageId: 'unlistedMember',
              data: { module: source, member: imported, allowed: allowed.join(', ') },
            });
          }
        }
      }
    }

    /** Membaca rantai anggota, mis. `Math.random` → ['Math', 'random']. */
    function memberChain(node) {
      const parts = [];
      let current = node;
      while (current.type === 'MemberExpression' && !current.computed) {
        if (current.property.type !== 'Identifier') return null;
        parts.unshift(current.property.name);
        current = current.object;
      }
      if (current.type !== 'Identifier') return null;
      parts.unshift(current.name);
      return parts;
    }

    return {
      ImportDeclaration(node) {
        if (typeof node.source.value === 'string') checkImportSource(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source && typeof node.source.value === 'string') {
          checkImportSource(node, node.source.value);
        }
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
          checkImportSource(node, node.source.value);
        }
      },

      Identifier(node) {
        if (!denyGlobals.has(node.name)) return;

        const parent = node.parent;
        if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) {
          return;
        }
        if (
          (parent?.type === 'Property' || parent?.type === 'PropertyDefinition') &&
          parent.key === node &&
          !parent.computed
        ) {
          return;
        }
        if (parent?.type === 'LabeledStatement' || parent?.type === 'BreakStatement') return;

        if (isGlobalReference(node)) {
          context.report({ node, messageId: 'deniedGlobal', data: { name: node.name } });
        }
      },

      MemberExpression(node) {
        if (node.computed) return;
        const chain = memberChain(node);
        if (!chain || chain.length < 2) return;

        const name = memberName(chain);
        if (denyMembers.has(name)) {
          context.report({ node, messageId: 'deniedMember', data: { name } });
        }
      },
    };
  },
};
