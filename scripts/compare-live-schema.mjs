#!/usr/bin/env node
/**
 * Apakah `docs/schema.sql` identik dengan database yang berjalan?
 *
 *   DATABASE_URL=... node --env-file=.env scripts/compare-live-schema.mjs
 *   npm run check:schema-drift        # memakai .env
 *
 * Kenapa ada: `docs/schema.sql` adalah sumber kebenaran skema, tetapi perubahan
 * padanya **tidak** otomatis sampai ke instance yang berjalan. Perubahan fungsi
 * (`create or replace function`) pernah tertinggal di produksi selama beberapa
 * hari — hasilnya tampak wajar, sehingga tidak ada yang mencurigainya. Skrip ini
 * menjawab pertanyaan itu secara langsung: muat berkasnya ke PGlite sebagai
 * baseline, ambil potret katalog yang sama dari baseline dan dari database live,
 * lalu bandingkan objek per objek.
 *
 * Yang dibandingkan (skema `public`): kolom tabel (tipe, nullability, default,
 * kolom generated/identity), tipe enum + labelnya, definisi fungsi
 * (`pg_get_functiondef`, minus anggota ekstensi), definisi view & materialized
 * view, index, trigger, constraint, **status RLS** (`enable`/`force row level
 * security`), dan **policy** RLS — dua yang terakhir ikut dibandingkan karena
 * keduanya ditetapkan berkas DDL dan berdampak pada keamanan, sehingga
 * "identik" tanpa keduanya tidak bermakna.
 *
 * Kolom dikunci berdasarkan NAMA, bukan nomor urut: produksi menambah kolom
 * lewat `alter table ... add column` (selalu menempel di akhir), sehingga urutan
 * fisik dapat berbeda dari berkas tanpa ada kolom yang hilang. Perbedaan urutan
 * dilaporkan terpisah sebagai informasi, bukan sebagai drift.
 *
 * Objek ekstra dipisahkan menjadi "tambahan pada relasi aplikasi" (drift: kolom/
 * index/trigger/constraint pada tabel yang didefinisikan berkas) dan "objek
 * aplikasi lain" (tabel di `public` yang tidak ada di berkas — bukan drift berkas
 * ini, tetapi perlu diketahui karena menandakan database dipakai bersama).
 *
 * Yang **tidak** dibandingkan dengan sengaja: baris data, kepemilikan/ACL,
 * `search_path` sesi, dan schema lain (`auth`, `extensions`).
 *
 * Keluar 1 bila ada objek yang hilang, berbeda, atau tambahan pada tabel
 * aplikasi — sehingga layak dijalankan sebagai gerbang sebelum/sesudah rilis.
 * Tidak ikut `npm test`/CI: ia butuh database yang benar-benar berjalan.
 */
import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import postgres from 'postgres';

import { databaseSslOptions } from '../src/lib/db/client.ts';

const SNAPSHOTS = {
  tables: `select c.relname as relation, c.relkind as kind
             from pg_class c
             join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'p', 'm')
            order by c.relname`,
  columns: `select c.relname as relation, a.attnum as ordinal, a.attname as column_name,
                   format_type(a.atttypid, a.atttypmod) as data_type,
                   a.attnotnull as not_null,
                   pg_get_expr(d.adbin, d.adrelid) as default_expr,
                   a.attgenerated as generated, a.attidentity as identity
              from pg_attribute a
              join pg_class c on c.oid = a.attrelid
              join pg_namespace n on n.oid = c.relnamespace
              left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
             where n.nspname = 'public' and c.relkind in ('r', 'p', 'm')
               and a.attnum > 0 and not a.attisdropped
             order by c.relname, a.attnum`,
  enums: `select t.typname as type_name,
                 string_agg(e.enumlabel, ',' order by e.enumsortorder) as labels
            from pg_type t
            join pg_enum e on e.enumtypid = t.oid
            join pg_namespace n on n.oid = t.typnamespace
           where n.nspname = 'public'
           group by t.typname
           order by t.typname`,
  functions: `select p.proname as function_name,
                     pg_get_function_identity_arguments(p.oid) as args,
                     pg_get_function_result(p.oid) as result,
                     l.lanname as language, p.provolatile as volatility,
                     pg_get_functiondef(p.oid) as definition
                from pg_proc p
                join pg_namespace n on n.oid = p.pronamespace
                join pg_language l on l.oid = p.prolang
               where n.nspname = 'public'
                 and not exists (select 1 from pg_depend d
                                  where d.objid = p.oid and d.deptype = 'e')
               order by p.proname, args`,
  relations: `select c.relname as relation, c.relkind as kind, pg_get_viewdef(c.oid, true) as definition
                from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relkind in ('v', 'm')
               order by c.relname`,
  indexes: `select c.relname as relation, i.relname as index_name, pg_get_indexdef(x.indexrelid) as definition
              from pg_index x
              join pg_class i on i.oid = x.indexrelid
              join pg_class c on c.oid = x.indrelid
              join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public'
             order by c.relname, i.relname`,
  triggers: `select c.relname as relation, t.tgname as trigger_name, pg_get_triggerdef(t.oid) as definition
               from pg_trigger t
               join pg_class c on c.oid = t.tgrelid
               join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and not t.tgisinternal
              order by c.relname, t.tgname`,
  constraints: `select con.conname as constraint_name, con.conrelid::regclass::text as relation,
                       con.contype as kind, pg_get_constraintdef(con.oid) as definition
                  from pg_constraint con
                  join pg_namespace n on n.oid = con.connamespace
                 where n.nspname = 'public'
                 order by relation, con.conname`,
  // RLS dan policy ikut dibandingkan: keduanya ditetapkan berkas DDL dan
  // berdampak pada keamanan, jadi "identik" tanpa keduanya tidak bermakna.
  rls: `select c.relname as relation, c.relrowsecurity as enabled,
               c.relforcerowsecurity as forced
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p', 'm')
         order by c.relname`,
  policies: `select tablename as relation, policyname, cmd, roles::text as roles, qual, with_check
               from pg_policies
              where schemaname = 'public'
              order by tablename, policyname`,
};

/** Potret yang objeknya menempel pada sebuah relasi (kunci diawali nama relasi). */
const RELATION_SCOPED = new Set(['columns', 'indexes', 'triggers', 'constraints', 'rls', 'policies']);

const KEYS = {
  tables: (row) => row.relation,
  columns: (row) => `${row.relation}.${row.column_name}`,
  enums: (row) => row.type_name,
  functions: (row) => `${row.function_name}(${row.args})`,
  relations: (row) => `${row.relation} (${row.kind})`,
  indexes: (row) => `${row.relation}.${row.index_name}`,
  triggers: (row) => `${row.relation}.${row.trigger_name}`,
  constraints: (row) => `${row.relation}.${row.constraint_name}`,
  rls: (row) => row.relation,
  policies: (row) => `${row.relation}.${row.policyname}`,
};

const VALUES = {
  tables: (row) => row.kind,
  columns: (row) =>
    `type=${row.data_type} notnull=${row.not_null} default=${row.default_expr} generated=${row.generated} identity=${row.identity}`,
  enums: (row) => row.labels,
  functions: (row) =>
    `returns=${row.result} language=${row.language} volatility=${row.volatility} def=${collapse(row.definition)}`,
  relations: (row) => collapse(row.definition),
  indexes: (row) => collapse(row.definition),
  triggers: (row) => collapse(row.definition),
  constraints: (row) => `kind=${row.kind} ${collapse(row.definition)}`,
  rls: (row) => `enabled=${row.enabled} forced=${row.forced}`,
  policies: (row) =>
    `cmd=${row.cmd} roles=${collapse(row.roles)} using=${collapse(row.qual)} check=${collapse(row.with_check)}`,
};

function collapse(text) {
  return String(text ?? '')
    .split('\r')
    .join('')
    .split('\n')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toMap(rows, kind) {
  return new Map(rows.map((row) => [KEYS[kind](row), VALUES[kind](row)]));
}

function firstDifference(a, b) {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  return {
    left: a.slice(Math.max(0, index - 30), index + 70),
    right: b.slice(Math.max(0, index - 30), index + 70),
  };
}

/** Nama relasi dari kunci, atau `null` bila potret itu tidak menempel pada relasi. */
function relationOf(kind, key) {
  if (!RELATION_SCOPED.has(kind)) return null;
  const at = key.indexOf('.');
  return at === -1 ? key : key.slice(0, at);
}

if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === '') {
  console.error(
    'DATABASE_URL belum diisi. Jalankan dengan `npm run check:schema-drift` (membaca .env) ' +
      'atau `DATABASE_URL=postgres://... node scripts/compare-live-schema.mjs`.',
  );
  process.exit(2);
}

const schema = readFileSync(new URL('../docs/schema.sql', import.meta.url), 'utf8');

const baselineDb = await PGlite.create({ extensions: { pg_trgm, unaccent, pgcrypto } });
await baselineDb.exec(schema);
await baselineDb.exec(`set search_path = public`);

const liveDb = postgres(process.env.DATABASE_URL, { max: 2, ...databaseSslOptions() });
await liveDb.unsafe(`set search_path = public`);

const liveVersion = (await liveDb.unsafe(`select version() as version`))[0].version;
const baselineVersion = (await baselineDb.query(`select version() as version`)).rows[0].version;

const missing = [];
const different = [];
const extraOnAppTables = [];
const foreignObjects = new Map();
const columnOrder = [];
const counts = [];

try {
  const baselineByKind = new Map();
  const liveByKind = new Map();

  for (const [kind, query] of Object.entries(SNAPSHOTS)) {
    const baselineRows = (await baselineDb.query(query)).rows;
    const liveRows = await liveDb.unsafe(query);
    baselineByKind.set(kind, baselineRows);
    liveByKind.set(kind, liveRows);

    const baseline = toMap(baselineRows, kind);
    const live = toMap(liveRows, kind);
    counts.push(`${kind} ${live.size}/${baseline.size}`);

    for (const [key, value] of baseline) {
      if (!live.has(key)) {
        missing.push(`${kind}: ${key}`);
      } else if (live.get(key) !== value) {
        const diff = firstDifference(value, live.get(key));
        different.push(
          `${kind}: ${key}\n      berkas : …${diff.left}…\n      live   : …${diff.right}…`,
        );
      }
    }
  }

  const appRelations = new Set(baselineByKind.get('tables').map((row) => row.relation));
  for (const row of baselineByKind.get('relations')) appRelations.add(row.relation);

  for (const [kind, liveRows] of liveByKind) {
    const baseline = toMap(baselineByKind.get(kind), kind);
    for (const row of liveRows) {
      const key = KEYS[kind](row);
      if (baseline.has(key)) continue;

      const relation = relationOf(kind, key);
      if (relation !== null && appRelations.has(relation)) {
        extraOnAppTables.push(`${kind}: ${key}`);
        continue;
      }
      const owner = relation ?? (kind === 'tables' || kind === 'relations' ? key : `(${kind})`);
      foreignObjects.set(owner, (foreignObjects.get(owner) ?? 0) + 1);
    }
  }

  // Urutan kolom: informasi, bukan drift — `alter table add column` menempel di akhir.
  const baselineColumns = baselineByKind.get('columns');
  const liveColumns = liveByKind.get('columns');
  const orderIn = (rows, relation) =>
    rows
      .filter((row) => row.relation === relation)
      .sort((a, b) => Number(a.ordinal) - Number(b.ordinal))
      .map((row) => row.column_name)
      .join(', ');

  for (const relation of appRelations) {
    const baselineOrder = orderIn(baselineColumns, relation);
    const liveOrder = orderIn(liveColumns, relation);
    if (baselineOrder !== '' && liveOrder !== '' && baselineOrder !== liveOrder) {
      columnOrder.push(
        `${relation}\n      berkas : ${baselineOrder}\n      live   : ${liveOrder}`,
      );
    }
  }
} finally {
  await liveDb.end();
  await baselineDb.close();
}

console.log('=== Drift skema: docs/schema.sql vs database berjalan ===');
console.log(`baseline (berkas) : ${String(baselineVersion).split(' on ')[0]}`);
console.log(`live              : ${String(liveVersion).split(' on ')[0]}`);
console.log(`dibandingkan      : ${counts.join(' | ')}  (live/berkas)`);
console.log();

const section = (title, rows) => {
  console.log(`${title} (${rows.length}):`);
  for (const row of rows.slice(0, 40)) console.log(`  - ${row}`);
  if (rows.length > 40) console.log(`  … dan ${rows.length - 40} lagi`);
  if (rows.length === 0) console.log('  (tidak ada)');
  console.log();
};

section('ADA DI BERKAS, TIDAK ADA DI DATABASE', missing);
section('ADA DI KEDUANYA, ISINYA BERBEDA', different);
section('TAMBAHAN PADA RELASI APLIKASI', extraOnAppTables);
section('URUTAN KOLOM BERBEDA (informasi)', columnOrder);

const foreign = [...foreignObjects.entries()].sort((a, b) => b[1] - a[1]);
console.log(`OBJEK DI LUAR BERKAS (aplikasi lain) (${foreign.length} relasi/objek):`);
for (const [owner, count] of foreign.slice(0, 25)) console.log(`  - ${owner}: ${count} objek`);
if (foreign.length > 25) console.log(`  … dan ${foreign.length - 25} lagi`);
console.log();

const drifted = missing.length > 0 || different.length > 0 || extraOnAppTables.length > 0;
console.log(
  `KESIMPULAN: ${drifted ? 'ADA DRIFT pada objek milik berkas' : 'objek yang didefinisikan docs/schema.sql cocok dengan database'}`,
);
if (foreign.length > 0) {
  console.log(
    `CATATAN   : ${foreign.length} relasi/objek di schema public tidak didefinisikan docs/schema.sql.`,
  );
}
process.exit(drifted ? 1 : 0);
