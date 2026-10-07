/**
 * `no-select-star` — melarang `select *` pada tabel besar (PRD §39).
 *
 * Tiga bentuk yang ditangkap, karena ketiganya benar-benar muncul di kode:
 *
 * 1. SQL mentah: ``sql.query(`select * from characters ...`)``
 * 2. Rantai builder: `.from('characters').select('*')`
 * 3. Bintang yang disembunyikan lewat konstanta lokal:
 *    `const columns = '*'; sql.query(\`select ${columns} from characters\`)`
 *
 * Bentuk ketiga ada di sini karena bentuk pertama dan kedua saja tidak cukup:
 * memindahkan `'*'` ke sebuah konstanta adalah satu baris suntingan yang membuat
 * aturannya lewat sepenuhnya — terukur, bukan hipotetis (uji mutasi
 * `scripts/check-architecture.mjs` sempat melaporkan `M2 exit=0` untuk tepat
 * celah ini). Pelacakannya dibatasi pada nilai yang **terlihat di berkas yang
 * sama**: konstanta yang berisi `*` pada posisi daftar kolom. Analisis alir data
 * penuh bukan urusan lint sintaks, dan berpura-pura melakukannya akan menuduh
 * kode yang benar.
 *
 * Yang tetap **tidak** ditangkap — dan tidak diklaim:
 * - Daftar kolom yang datang dari luar berkas (impor, argumen fungsi, hasil
 *   kueri lain). Untuk itu, aturan ini berhenti pada hal yang dapat dilihat, dan
 *   `select *` yang tabelnya tidak dapat ditentukan tetap dilaporkan
 *   (`unverifiable`) supaya ketidakpastiannya tidak berubah menjadi izin.
 */

const SELECT_LIST = /\bselect\b([^;]*?)\bfrom\b/is;
// Diankur ke awal teks setelah daftar kolom, supaya yang dibaca adalah `from`
// milik query ini — bukan `from` milik subquery di dalamnya.
const FROM_TARGET = /^from\s+(?:only\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/i;
const FROM_SUBQUERY = /^from\s*\(/i;
const BUILDER_FROM = /\.from\(\s*['"`]([a-z_][a-z0-9_]*)['"`]\s*\)/;

/**
 * Bintang dalam daftar kolom — `*` di posisi daftar, bukan operator atau argumen
 * fungsi:
 *
 *   `select * from t`        → terdeteksi
 *   `select t.* from t`      → terdeteksi
 *   `select id, * from t`    → terdeteksi
 *   `select count(*) from t` → TIDAK (tidak ada kolom yang diambil)
 *   `select a * b from t`    → TIDAK (perkalian, bukan kolom)
 */
const COLUMN_STAR = /(?:^|,)\s*(?:[a-z_][a-z0-9_]*\.)?\*\s*(?=,|\bfrom\b|$)/i;

/** Menggabungkan bagian statis literal; bagian ekspresi diganti pemisah. */
function staticText(node) {
  if (node.type === 'TemplateLiteral') {
    return node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join('\u0000');
  }
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  return null;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Melarang select * pada tabel besar (PRD §39). Daftar tabel besar ada di tools/architecture/large-tables.mjs.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          /** Nama tabel → alasan. Alasan dicetak di pesan supaya pelanggar tahu biayanya. */
          largeTables: { type: 'object', additionalProperties: { type: 'string' } },
        },
        required: ['largeTables'],
        additionalProperties: false,
      },
    ],
    messages: {
      largeTable:
        '`select *` pada tabel besar "{{table}}" dilarang. {{reason}} Tulis kolom yang dipakai saja.',
      unverifiable:
        'Ditemukan `select *` tetapi tabelnya tidak dapat ditentukan dari kode, sehingga biayanya tidak dapat dinilai. Sebutkan nama tabelnya secara eksplisit.',
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const largeTables = options.largeTables ?? {};

    /** Nama variabel yang nilainya adalah bintang di posisi daftar kolom. */
    const starConstants = new Set();
    const textCandidates = [];
    const chainCandidates = [];
    const reportedNodes = new Set();

    function report(node, messageId, data) {
      if (reportedNodes.has(node)) return;
      reportedNodes.add(node);
      context.report({ node, messageId, data });
    }

    /** Posisi setiap interpolasi di dalam teks statis yang digabung. */
    function interpolationOffsets(node) {
      const offsets = [];
      let cursor = 0;
      node.quasis.forEach((quasi, index) => {
        cursor += (quasi.value.cooked ?? quasi.value.raw).length;
        if (node.expressions[index]) {
          offsets.push({ offset: cursor, expression: node.expressions[index] });
          cursor += 1; // pemisah \u0000
        }
      });
      return offsets;
    }

    function evaluate(node) {
      const text = staticText(node);
      if (text === null) return;

      const select = SELECT_LIST.exec(text);
      if (!select) return;

      const listStart = select.index + select[0].indexOf('select') + 'select'.length;
      const listEnd = select.index + select[0].lastIndexOf('from');
      const afterList = text.slice(listEnd);

      /**
       * `select * from (subquery)`: bintangnya memilih seluruh kolom tabel
       * turunan, yang daftar kolomnya ditentukan proyeksi di dalam subquery.
       * Atribusi ke tabel yang disebut di dalam subquery akan salah — mis.
       * `select * from (select id from characters) t` hanya mengambil satu kolom.
       * Karena itu bentuk ini dilaporkan sebagai tidak dapat diverifikasi, dan
       * pencarian tabel dihentikan alih-alih melompat ke `from` berikutnya.
       */
      if (FROM_SUBQUERY.test(afterList)) {
        report(node, 'unverifiable');
        return;
      }

      const target = FROM_TARGET.exec(afterList);
      const table = target?.[1] ?? null;
      const isFunctionCall =
        target !== null && afterList.slice(target[0].length).trimStart().startsWith('(');
      const reason = table !== null && !isFunctionCall ? largeTables[table] : undefined;

      if (COLUMN_STAR.test(select[1])) {
        // `select * from public.fungsi(...)`: kolomnya ditetapkan tanda tangan
        // fungsi di DDL, bukan oleh tabel yang dapat bertambah kolom tanpa
        // sepengetahuan pemanggil. Bentuk ini sengaja dibiarkan lolos — dan
        // dibiarkan secara eksplisit, karena versi pertama aturan ini
        // melaporkannya sebagai `unverifiable` dan menuduh pemanggilan RPC yang
        // sah di repo ini sendiri.
        if (isFunctionCall) return;
        if (table === null) {
          report(node, 'unverifiable');
          return;
        }
        if (reason === undefined) return;
        report(node, 'largeTable', { table, reason });
        return;
      }

      if (node.type !== 'TemplateLiteral') return;

      // Bintang tersembunyi: variabel yang isinya bintang dipakai di posisi
      // daftar kolom.
      const tainted = interpolationOffsets(node).find(
        ({ offset, expression }) =>
          offset > listStart &&
          offset < listEnd &&
          expression.type === 'Identifier' &&
          starConstants.has(expression.name),
      );

      if (!tainted || table === null || isFunctionCall || reason === undefined) return;
      report(node, 'largeTable', { table, reason });
    }

    return {
      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier' || !node.init) return;
        const value = staticText(node.init);
        if (value === null) return;
        // Nilai diuji dengan pola daftar kolom yang sama seperti SQL.
        const asList = value.trimStart().startsWith(',') ? value : `,${value}`;
        if (COLUMN_STAR.test(asList)) starConstants.add(node.id.name);
      },

      Literal(node) {
        textCandidates.push(node);
      },

      TemplateLiteral(node) {
        textCandidates.push(node);
      },

      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.property.type !== 'Identifier' ||
          callee.property.name !== 'select'
        ) {
          return;
        }
        const first = node.arguments[0];
        if (!first) return;
        chainCandidates.push({ node, columns: first });
      },

      // Dievaluasi setelah seluruh berkas terbaca, supaya konstanta yang
      // dideklarasikan setelah pemakaiannya tetap tertangkap.
      'Program:exit'() {
        for (const node of textCandidates) evaluate(node);

        for (const { node, columns } of chainCandidates) {
          const value = staticText(columns);

          // Nilai `null` berarti argumennya bukan literal (mis. sebuah identifier)
          // — justru kasus yang harus diperiksa terhadap konstanta berbintang.
          // Versi sebelumnya keluar lebih dulu di sini, sehingga hanya bentuk
          // literal yang tertangkap pada rantai builder sementara bentuk yang
          // sama pada SQL template tertangkap: aturan yang tidak konsisten dengan
          // dirinya sendiri.
          const columnsAreStar =
            value !== null &&
            COLUMN_STAR.test(value.trimStart().startsWith(',') ? value : `,${value}`);
          const tainted =
            !columnsAreStar && columns.type === 'Identifier' && starConstants.has(columns.name);
          if (!columnsAreStar && !tainted) continue;

          let current = node;
          while (
            current.parent &&
            (current.parent.type === 'MemberExpression' ||
              (current.parent.type === 'CallExpression' && current.parent.callee === current))
          ) {
            current = current.parent;
          }

          const from = BUILDER_FROM.exec(context.sourceCode.getText(current));
          if (!from) {
            report(columns, 'unverifiable');
            continue;
          }

          const reason = largeTables[from[1]];
          if (reason === undefined) continue;
          report(columns, 'largeTable', { table: from[1], reason });
        }
      },
    };
  },
};
