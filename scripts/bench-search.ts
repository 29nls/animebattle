/**
 * Benchmark §Phase 6 — 10.000 record **sintetis**, terisolasi.
 *
 * Kenapa berkas ini ada: target PRD ("`goku` < 200 ms") tidak boleh diklaim dari
 * dataset produksi yang berisi 3 karakter, dan tidak boleh diklaim dari unit test
 * yang tidak pernah menyentuh index. Skrip ini membuat database PGlite baru,
 * memuat `docs/schema.sql` sungguhan, mengisi 10.000 karakter sintetis yang
 * **diberi label eksplisit** (slug `bench-*`, sumber `bench-synthetic`), lalu
 * menjalankan query halaman yang sesungguhnya dari `src/features/**`.
 *
 * Batas kejujuran hasil — dua hal yang tidak boleh disimpulkan dari keluaran ini:
 *   1. PGlite berjalan di proses Node yang sama (tanpa jaringan, tanpa buffer
 *      pool terpisah), jadi angkanya **bukan** prediksi latency Supabase. Yang
 *      valid di sini: bentuk query, rencana eksekusi, dan pemakaian index.
 *   2. Data sintetis bukan karakter nyata dan tidak pernah masuk katalog
 *      produksi; semuanya hidup di memori proses ini saja.
 *
 * Pemakaian: npm run bench:search [-- --runs 20 --out docs/benchmarks/search-10k.md]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

import type { SqlClient } from '../src/lib/db/client.ts';
import {
  countCharacters,
  listCharacters,
  searchCharacterPage,
} from '../src/features/characters/queries.ts';
import {
  getCharacterBySlug,
  listCharacterForms,
  listFormAbilities,
  listFormResistances,
  listFormStatistics,
} from '../src/features/characters/detail-queries.ts';
import { listVerseCharacters, listVerses } from '../src/features/verses/queries.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = resolve(ROOT, 'docs/schema.sql');

const CHARACTERS = 10_000;
const VERSES = 20;

/** Nama yang dipakai tes pencarian; jumlahnya kecil supaya selective. */
const FAMILY = 'Gokuto Bench';
const FAMILY_ROWS = 3;
/** Alias pendek: jalur typo (`kakarotp`) hanya masuk bila kandidatnya sependek query. */
const FAMILY_ALIAS = 'Kakarotto';
const FAMILY_NATIVE = 'ベンチゴクト';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}

const RUNS = Number.parseInt(arg('runs', '20'), 10);
const OUT = arg('out', '');
/** `--only <regex>` menyaring kasus; `--plans-only` hanya mencetak rencana eksekusi. */
const ONLY = arg('only', '');
const PLANS_ONLY = process.argv.includes('--plans-only');

// --- 1. Database bersih + skema sungguhan ------------------------------------

const db = await PGlite.create({ extensions: { pg_trgm, unaccent, pgcrypto } });
const sql: SqlClient = {
  async query<T>(text: string, params?: readonly unknown[]): Promise<T[]> {
    const result = await db.query(text, params as unknown[]);
    return result.rows as T[];
  },
};

await db.exec(readFileSync(SCHEMA, 'utf8'));

// --- 2. Isi sintetis (berlabel) ----------------------------------------------

const seedStart = performance.now();

await db.exec(`
insert into sources (slug, name, base_url, source_type, legal_status, license,
                     legal_reviewed_by, legal_reviewed_at)
values ('bench-synthetic', 'Benchmark Synthetic (DATA SINTETIS, bukan katalog)', 'about:benchmark',
        'dataset', 'allowed', 'benchmark-only', 'benchmark-harness', now());

insert into verses (slug, name, description, origin_media, popularity_score, data_completeness, source_id)
select 'bench-verse-' || lpad(i::text, 2, '0'),
       'Benchmark Verse ' || lpad(i::text, 2, '0'),
       'Verse sintetis untuk benchmark; tidak mewakili karya nyata.',
       'manga', 1000 - i * 7, 'partial',
       (select id from sources where slug = 'bench-synthetic')
from generate_series(1, ${VERSES}) i;

insert into stat_scale_metrics (metric, label, unit, normalization_span)
values ('attack_potency', 'Attack Potency', 'log10_joule', 6),
       ('speed', 'Speed', 'log10_m_s', 6),
       ('durability', 'Durability', 'log10_joule', 6);

insert into stat_scales (metric_id, scale_code, label, rank, log_value, band)
select m.id, 'bench-' || m.metric::text || '-' || r, 'Bench scale ' || r, r, r::numeric, 'none'
from stat_scale_metrics m cross join generate_series(1, 10) r;

insert into tiers (tier_code, tier_name, band, display_order, numerical_rank)
select 'B-' || lpad(i::text, 2, '0'), 'Bench Tier ' || i, 'none', i, i
from generate_series(1, 12) i;

insert into characters (slug, name, native_name, description, origin, verse_id, classification,
                        media_type, popularity_score, data_completeness, verification_status,
                        source_id, source_url, source_name, imported_at)
select 'bench-unit-' || lpad(g.i::text, 5, '0'),
       'Benchmark Unit ' || lpad(g.i::text, 5, '0'),
       case when g.i % 4 = 0 then 'ベンチ ' || lpad(g.i::text, 5, '0') else null end,
       'Baris sintetis untuk benchmark performa. Bukan karakter nyata.',
       v.name,
       v.id, 'synthetic', 'manga', (g.i * 37) % 1000, 'partial', 'imported',
       s.id, 'dataset://benchmark/' || g.i, 'Benchmark Synthetic',
       now() - ((g.i % 400) * interval '1 hour')
from generate_series(1, ${CHARACTERS}) as g(i)
join verses v on v.slug = 'bench-verse-' || lpad((1 + (g.i % ${VERSES}))::text, 2, '0')
cross join (select id from sources where slug = 'bench-synthetic') s;

-- Keluarga kecil dengan nama pendek: dipakai untuk uji exact/typo/alias/unicode.
update characters
   set name = '${FAMILY}',
       native_name = '${FAMILY_NATIVE}',
       description = 'Tiga baris sintetis dengan nama pendek untuk uji pencarian.'
 where slug in ('bench-unit-00001', 'bench-unit-00002', 'bench-unit-00003');

insert into character_aliases (character_id, alias, script, is_primary, source_id)
select c.id, '${FAMILY_ALIAS}', 'latin', true, s.id
from characters c cross join (select id from sources where slug = 'bench-synthetic') s
where c.slug in ('bench-unit-00001', 'bench-unit-00002', 'bench-unit-00003');

-- Satu form default per karakter + form kedua untuk setiap karakter ke-5.
insert into character_versions (character_id, slug, name, era, form_order, is_default, media_type,
                                tier_id, data_completeness, verification_status)
select c.id, c.slug || '-form-1', c.name, 'Benchmark arc 1', 1, true, 'manga',
       t.id, 'partial', 'imported'
from characters c
join lateral (select id from tiers where tier_code = 'B-' || lpad((1 + (abs(hashtext(c.slug)) % 12))::text, 2, '0')) t on true;

insert into character_versions (character_id, slug, name, era, form_order, is_default, media_type,
                                tier_id, data_completeness, verification_status)
select c.id, c.slug || '-form-2', c.name || ' (Form 2)', 'Benchmark arc 2', 2, false, 'manga',
       t.id, 'partial', 'imported'
from characters c
join lateral (select id from tiers where tier_code = 'B-' || lpad((1 + (abs(hashtext(c.slug || '2')) % 12))::text, 2, '0')) t on true
where (('x' || substr(md5(c.slug), 1, 6))::bit(24)::int % 5) = 0;

-- Alias untuk setiap karakter ke-3 (jumlah besar: ikut membebani index trigram).
insert into character_aliases (character_id, alias, script, source_id)
select c.id, 'Bench Alias ' || substr(c.slug, 12), 'latin', s.id
from characters c cross join (select id from sources where slug = 'bench-synthetic') s
where (('x' || substr(md5(c.slug), 1, 6))::bit(24)::int % 3) = 0;
`);

// Statistik/ability/resistensi hanya untuk sebagian form: relasi 1:N ini tidak
// perlu menutupi 12.000 form untuk mengukur bentuk query-nya, dan menahan waktu
// seeding tetap wajar di PGlite.
await db.exec(`
with picked as (
  select cv.id, row_number() over (order by cv.slug) as rn
    from character_versions cv
   where cv.is_default
   order by cv.slug
   limit 2000
)
insert into statistics (character_version_id, metric, scale_id, raw_text, qualifier, confidence,
                        source_id, source_url, status)
select p.id, m.metric, sc.id, 'Bench raw value ' || p.rn, 'exact', 0.8, s.id,
       'dataset://benchmark/stat/' || p.rn, 'current'
from picked p
cross join (select id, metric from stat_scale_metrics) m
join lateral (select id from stat_scales where metric_id = m.id order by rank limit 1) sc on true
cross join (select id from sources where slug = 'bench-synthetic') s;

insert into ability_categories (slug, name, is_offensive, is_defensive)
values ('bench-category', 'Bench Category', true, false);

insert into abilities (slug, name, category_id, activation_speed, source_id)
select 'bench-ability-' || i, 'Bench Ability ' || i, ac.id, 'fast', s.id
from generate_series(1, 8) i
cross join (select id from ability_categories where slug = 'bench-category') ac
cross join (select id from sources where slug = 'bench-synthetic') s;

insert into resistance_types (slug, name, category_id)
select 'bench-resistance', 'Bench Resistance', ac.id
from ability_categories ac where ac.slug = 'bench-category';

with picked as (
  select cv.id from character_versions cv where cv.is_default order by cv.slug limit 500
)
insert into character_abilities (character_version_id, ability_id, proficiency, source_id, source_url, evidence_text, confidence)
select p.id, a.id, 'advanced', s.id, 'dataset://benchmark/ability', 'Bukti sintetis untuk benchmark.', 0.7
from picked p cross join (select id from abilities a where a.slug in ('bench-ability-1','bench-ability-2','bench-ability-3')) a
cross join (select id from sources where slug = 'bench-synthetic') s;

with picked as (
  select cv.id from character_versions cv where cv.is_default order by cv.slug limit 500
)
insert into character_resistances (character_version_id, resistance_type_id, level, level_label,
                                   source_id, source_url, evidence_text, verification_status, confidence)
select p.id, rt.id, 2, 'moderate', s.id, 'dataset://benchmark/resistance', 'Bukti sintetis untuk benchmark.', 'imported', 0.7
from picked p cross join (select id from resistance_types where slug = 'bench-resistance') rt
cross join (select id from sources where slug = 'bench-synthetic') s;
`);

const seedMs = performance.now() - seedStart;

const counts = (await db.query<{
  characters: number; versions: number; aliases: number; statistics: number;
  abilities: number; resistances: number; verses: number;
}>(
  `select (select count(*)::int from characters) as characters,
          (select count(*)::int from character_versions) as versions,
          (select count(*)::int from character_aliases) as aliases,
          (select count(*)::int from statistics) as statistics,
          (select count(*)::int from character_abilities) as abilities,
          (select count(*)::int from character_resistances) as resistances,
          (select count(*)::int from verses) as verses`,
)).rows;
const shape = counts[0]!;

// --- 3. Query yang diukur (modul produksi, bukan SQL tulis ulang) -------------

interface Case {
  name: string;
  note: string;
  /** Dijalankan berulang; nilai baliknya dipakai untuk assert bentuk hasil. */
  run: () => Promise<{ rows: number; top?: string | null; detail?: string }>;
}

const familySlug = 'bench-unit-00001';
const family = (await sql.query<{ id: string }>(`select id from characters where slug = $1`, [familySlug]))[0]!;
const familyForms = await listCharacterForms(sql, family.id);
const familyForm = familyForms[0]!;
const secondForm = familyForms[1] ?? familyForms[0]!;

const cases: Case[] = [
  {
    name: 'search selektif (nama)',
    note: `"${FAMILY.toLowerCase()}" — ${FAMILY_ROWS} dari ${CHARACTERS.toLocaleString('id-ID')} baris`,
    run: async () => {
      const page = await searchCharacterPage(sql, { query: FAMILY.toLowerCase(), perPage: 20 });
      return { rows: page.rows.length, top: page.rows[0]?.slug ?? null, detail: `total=${page.total}` };
    },
  },
  {
    name: 'search alias',
    note: `"kakarotto" → record kanonik`,
    run: async () => {
      const page = await searchCharacterPage(sql, { query: 'kakarotto', perPage: 20 });
      return { rows: page.rows.length, top: page.rows[0]?.slug ?? null, detail: `total=${page.total}` };
    },
  },
  {
    name: 'search typo',
    note: `"kakarotp" → toleransi trigram pada alias`,
    run: async () => {
      const page = await searchCharacterPage(sql, { query: 'kakarotp', perPage: 20 });
      return { rows: page.rows.length, top: page.rows[0]?.slug ?? null, detail: `total=${page.total}` };
    },
  },
  {
    name: 'search prefiks',
    note: `"goku" → awalan nama`,
    run: async () => {
      const page = await searchCharacterPage(sql, { query: 'goku', perPage: 20 });
      return { rows: page.rows.length, top: page.rows[0]?.slug ?? null, detail: `total=${page.total}` };
    },
  },
  {
    name: 'search unicode (CJK)',
    note: `"${FAMILY_NATIVE}" → native_name`,
    run: async () => {
      const page = await searchCharacterPage(sql, { query: FAMILY_NATIVE, perPage: 20 });
      return { rows: page.rows.length, top: page.rows[0]?.slug ?? null, detail: `total=${page.total}` };
    },
  },
  {
    name: 'search luas',
    note: `"benchmark" — cocok dengan seluruh ${CHARACTERS.toLocaleString('id-ID')} baris (kasus terburuk)`,
    run: async () => {
      const page = await searchCharacterPage(sql, { query: 'benchmark', perPage: 20 });
      return { rows: page.rows.length, top: page.rows[0]?.slug ?? null, detail: `total=${page.total}` };
    },
  },
  {
    name: 'search + filter verse',
    note: 'query "benchmark" dibatasi satu verse',
    run: async () => {
      const page = await searchCharacterPage(sql, { query: 'benchmark', verseSlug: 'bench-verse-03', perPage: 20 });
      return { rows: page.rows.length, top: page.rows[0]?.slug ?? null, detail: `total=${page.total}` };
    },
  },
  {
    name: 'search + filter media',
    note: 'query "benchmark" dibatasi media manga',
    run: async () => {
      const page = await searchCharacterPage(sql, { query: 'benchmark', media: 'manga', perPage: 20 });
      return { rows: page.rows.length, top: page.rows[0]?.slug ?? null, detail: `total=${page.total}` };
    },
  },
  {
    name: 'autocomplete (perPage 10)',
    note: 'RPC yang sama dengan /api/search/suggest',
    run: async () => {
      const page = await searchCharacterPage(sql, { query: 'goku', perPage: 10 });
      return { rows: page.rows.length, top: page.rows[0]?.slug ?? null, detail: `total=${page.total}` };
    },
  },
  {
    name: 'daftar karakter hal. 1',
    note: 'limit 24, urut popularitas+nama',
    run: async () => {
      const rows = await listCharacters(sql, { limit: 24, offset: 0 });
      return { rows: rows.length, top: rows[0]?.slug ?? null };
    },
  },
  {
    name: 'daftar karakter hal. 209 (offset jauh)',
    note: 'offset 5.000 — biaya OFFSET',
    run: async () => {
      const rows = await listCharacters(sql, { limit: 24, offset: 5_000 });
      return { rows: rows.length, top: rows[0]?.slug ?? null };
    },
  },
  {
    name: 'count karakter',
    note: 'dipakai header daftar',
    run: async () => ({ rows: 1, detail: String(await countCharacters(sql)) }),
  },
  {
    name: 'detail karakter',
    note: 'getCharacterBySlug',
    run: async () => {
      const row = await getCharacterBySlug(sql, familySlug);
      return { rows: row ? 1 : 0, top: row?.slug ?? null };
    },
  },
  {
    name: 'pemilih form',
    note: 'listCharacterForms (form kedua ada)',
    run: async () => {
      const rows = await listCharacterForms(sql, family.id);
      return { rows: rows.length, detail: `form=${rows.length}` };
    },
  },
  {
    name: 'statistik form',
    note: 'listFormStatistics',
    run: async () => {
      const rows = await listFormStatistics(sql, familyForm.id);
      return { rows: rows.length };
    },
  },
  {
    name: 'ability form',
    note: 'listFormAbilities (join katalog + sumber)',
    run: async () => {
      const rows = await listFormAbilities(sql, familyForm.id);
      return { rows: rows.length };
    },
  },
  {
    name: 'resistensi form',
    note: 'listFormResistances',
    run: async () => {
      const rows = await listFormResistances(sql, secondForm.id);
      return { rows: rows.length };
    },
  },
  {
    name: 'daftar verse',
    note: `listVerses — ${VERSES} verse, dihitung per verse`,
    run: async () => {
      const rows = await listVerses(sql, { limit: 50 });
      return { rows: rows.length, top: rows[0]?.slug ?? null };
    },
  },
  {
    name: 'karakter per verse',
    note: 'listVerseCharacters (500 baris per verse)',
    run: async () => {
      const verse = (await sql.query<{ id: string }>(
        `select id from verses where slug = 'bench-verse-03'`,
      ))[0]!;
      const rows = await listVerseCharacters(sql, verse.id, { limit: 50 });
      return { rows: rows.length, top: rows[0]?.slug ?? null };
    },
  },
  {
    name: 'dataset battle (RPC)',
    note: 'battle_dataset untuk 2 form — satu round-trip simulasi',
    run: async () => {
      const rows = await sql.query<{ payload: unknown }>(
        `select public.battle_dataset($1::uuid[]) as payload`,
        [[familyForm.id, secondForm.id]],
      );
      const payload = rows[0]?.payload;
      const size = Array.isArray(payload) ? payload.length : 0;
      return { rows: size, detail: `entries=${size}` };
    },
  },
];

// --- 4. Ukur ------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

interface Measurement {
  name: string;
  note: string;
  p50: number;
  p95: number;
  max: number;
  rows: number;
  top: string | null;
  detail: string;
  ok: boolean;
  problem: string | null;
}

const measurements: Measurement[] = [];

for (const c of cases) {
  if (ONLY !== '' && !new RegExp(ONLY).test(c.name)) continue;
  if (PLANS_ONLY) continue;
  let last: { rows: number; top?: string | null; detail?: string } = { rows: 0 };
  for (let i = 0; i < 3; i += 1) last = await c.run();

  const samples: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const t0 = performance.now();
    last = await c.run();
    samples.push(performance.now() - t0);
  }
  const sorted = [...samples].sort((a, b) => a - b);

  let problem: string | null = null;
  if (/^search/.test(c.name) && last.rows === 0) problem = 'tidak ada baris hasil';
  if (c.name.includes('detail karakter') && last.top !== familySlug) problem = `top=${last.top}`;
  // Tiga baris keluarga punya nama identik; peringkat pertama ditentukan
  // tie-breaker popularitas, jadi yang benar adalah salah satu dari ketiganya.
  if (c.name.includes('selektif') && !/^bench-unit-0000[123]$/.test(last.top ?? '')) {
    problem = `top=${last.top}`;
  }

  measurements.push({
    name: c.name,
    note: c.note,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1]!,
    rows: last.rows,
    top: last.top ?? null,
    detail: last.detail ?? '',
    ok: problem === null,
    problem,
  });
}

// --- 5. Rencana eksekusi untuk query yang paling berat -----------------------

const PLANS: { label: string; text: string; params: unknown[] }[] = [
  {
    label: `search karakter luas ("benchmark")`,
    text: `explain (analyze, buffers) select * from public.search_characters_page('benchmark', null, null, 20, 0, true)`,
    params: [],
  },
  {
    label: `search luas + filter media ("benchmark", manga)`,
    text: `explain (analyze, buffers) select * from public.search_characters_page('benchmark', null, 'manga', 20, 0, true)`,
    params: [],
  },
  {
    label: `search selektif ("gokuto bench")`,
    text: `explain (analyze, buffers) select * from public.search_characters_page('gokuto bench', null, null, 20, 0, true)`,
    params: [],
  },
  {
    label: `search berhalaman + filter verse ("benchmark")`,
    text: `explain (analyze, buffers) select public.search_characters_page('benchmark', 'bench-verse-03', null, 20, 0, true)`,
    params: [],
  },
  {
    label: 'probe index trigram pada characters (name + native)',
    text: `explain (analyze, buffers)
             select id from characters where public.f_normalize_name(name) % 'gokuto'
             union all
             select id from characters where coalesce(native_name, '') % 'ベンチゴクト'`,
    params: [],
  },
  {
    label: 'daftar karakter offset 5.000',
    text: `explain (analyze, buffers)
             select id, slug, name, native_name, image_url, data_completeness, popularity_score, updated_at
               from characters order by popularity_score desc, name asc limit 24 offset 5000`,
    params: [],
  },
];

const planText: string[] = [];
for (const p of PLANS) {
  console.error(`[plan] ${p.label}`);
  const result = await db.query<Record<string, string>>(p.text, p.params);
  const lines = result.rows.map((r) => Object.values(r)[0] ?? '');
  planText.push(`### ${p.label}\n\n\`\`\`\n${lines.slice(0, 24).join('\n')}\n\`\`\`\n`);
}

// --- 6. Keluaran --------------------------------------------------------------

const fmt = (n: number): string => `${n.toFixed(1).padStart(8)} ms`;

const lines: string[] = [];
lines.push('## Benchmark pencarian — dataset sintetis ' + CHARACTERS.toLocaleString('id-ID') + ' karakter');
lines.push('');
lines.push(
  `Bentuk dataset: ${shape.characters.toLocaleString('id-ID')} karakter, ` +
    `${shape.versions.toLocaleString('id-ID')} form, ${shape.aliases.toLocaleString('id-ID')} alias, ` +
    `${shape.statistics.toLocaleString('id-ID')} statistik, ${shape.abilities.toLocaleString('id-ID')} ability, ` +
    `${shape.resistances.toLocaleString('id-ID')} resistensi, ${shape.verses} verse. Seeding ${seedMs.toFixed(0)} ms.`,
);
lines.push('');
lines.push('| Query | p50 | p95 | max | baris | catatan |');
lines.push('| --- | ---: | ---: | ---: | ---: | --- |');
for (const m of measurements) {
  lines.push(
    `| ${m.name} | ${fmt(m.p50)} | ${fmt(m.p95)} | ${fmt(m.max)} | ${m.rows} | ${m.note}${m.rows ? ` → ${m.rows} baris` : ''}${m.detail ? ` (${m.detail})` : ''}${m.ok ? '' : ` ⚠ ${m.problem}`} |`,
  );
}
lines.push('');
lines.push(
  'Semua angka dari PGlite dalam proses yang sama (tanpa jaringan/SSL ke Supabase), jadi ini batas bawah ' +
    'relatif: yang diukur adalah bentuk query, pemakaian index, dan biaya relatif antar query — bukan latency produksi.',
);
lines.push('');
lines.push(...planText);

const report = lines.join('\n');
console.log(report);

if (OUT) {
  const outPath = resolve(ROOT, OUT);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${report}\n`, 'utf8');
  console.log(`\nDitulis ke ${OUT}`);
}

const failures = measurements.filter((m) => !m.ok);
await db.close();
if (failures.length > 0) {
  console.error(`\n${failures.length} query tidak mengembalikan bentuk yang diharapkan:`);
  for (const f of failures) console.error(` - ${f.name}: ${f.problem}`);
  process.exit(1);
}
console.log('\nSemua query mengembalikan hasil yang diharapkan pada dataset sintetis.');
