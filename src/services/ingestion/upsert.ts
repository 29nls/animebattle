/**
 * Lapisan upsert idempoten (PRD §18.1 poin 3, §18.3 "Upsert layer", AC-08).
 *
 * Kontrak yang dipegang modul ini:
 *
 * 1. **Idempoten.** Menjalankan dataset yang sama dua kali tidak menambah
 *    karakter, verse, form, statistik, ability, atau resistensi — jumlahnya
 *    tetap, dan `records_created` pada eksekusi kedua bernilai 0. Statistik
 *    dibandingkan nilai per nilai sebelum ditulis; yang identik dilewati, bukan
 *    disuperseded tanpa alasan.
 * 2. **Tidak menimpa sumber yang lebih kuat.** Prioritas kecil = lebih kuat
 *    (`sources.priority`). Nilai dari sumber berprioritas lebih lemah dicatat
 *    sebagai catatan (notes), bukan ditulis.
 * 3. **Atribusi lengkap.** Setiap baris yang ditulis membawa `source_id`, dan
 *    baris kanonik yang punya kolom jejak (`characters.source_url`,
 *    `characters.source_name`) ikut diisi — inilah yang membuat AC-09 tetap
 *    benar setelah impor, bukan hanya sebelum.
 * 4. **Kegagalan per record.** Satu karakter rusak tidak boleh membatalkan
 *    seluruh job. Kegagalannya dicatat di laporan dan diteruskan ke
 *    `ingestion_errors`, sehingga panel admin menyebut record mana dan kenapa
 *    (AC-10).
 *
 * Tidak ada transaksi di sini: `SqlClient` sengaja hanya punya `query`, dan
 * menjaga kontrak itu lebih penting daripada kenyamanan. Konsekuensinya
 * didokumentasikan di runbook: job yang gagal di tengah dapat dijalankan ulang
 * — dan karena idempoten, menjalankan ulang adalah pemulihannya.
 */

import type { SqlClient } from '../../lib/db/client.ts';

import type {
  DatasetAbility,
  DatasetCharacter,
  DatasetEnvelope,
  DatasetForm,
  DatasetResistance,
  DatasetStatistic,
  DatasetVerse,
} from './dataset.ts';
import type { IngestionErrorType } from '../queue/job-lifecycle.ts';
import type { IngestionSource } from './sources.ts';

export interface RecordFailure {
  error_type: IngestionErrorType;
  message: string;
  source_url: string | null;
  payload: unknown;
  http_status: number | null;
}

export interface UpsertReport {
  found: number;
  created: number;
  updated: number;
  failed: number;
  failures: RecordFailure[];
  notes: string[];
}

export interface UpsertContext {
  sql: SqlClient;
  source: IngestionSource;
  jobId: string;
  parserVersion: string;
  /** Dry-run: semua pemeriksaan dan pembacaan berjalan, tidak ada penulisan. */
  dryRun: boolean;
  /**
   * URL asal yang ditulis ke kolom jejak (`verses.source_url`,
   * `characters.source_url`, `statistics.source_url`). Untuk impor terkelola
   * nilainya `dataset://…` dari envelope; untuk fetch nilainya URL halaman.
   */
  provenanceUrl: string | null;
}

interface LookupMaps {
  tiers: Map<string, string>;
  scales: Map<string, string>;
  categories: Map<string, { id: string; name: string; is_offensive: boolean }>;
  resistanceTypes: Map<string, string>;
}

const RESISTANCE_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: 'limited',
  2: 'moderate',
  3: 'high',
  4: 'absolute',
};

/**
 * Slug katalog ability. Dataset boleh menyebut `slug` eksplisit; bila tidak,
 * slug diturunkan dari nama sehingga dua ability berbeda pada kategori yang
 * sama tidak saling menimpa di katalog `abilities` (yang `slug`-nya unik).
 */
function abilitySlugFor(categorySlug: string, name: string | null): string {
  if (name === null || name.trim() === '') return categorySlug;
  const suffix = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return suffix === '' ? categorySlug : `${categorySlug}--${suffix}`;
}

function payloadSlice(payload: unknown): string {
  const serialized = JSON.stringify(payload);
  return serialized.length > 3500 ? `${serialized.slice(0, 3500)}…` : serialized;
}

function errorTypeFor(error: unknown): IngestionErrorType {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (code === '23505') return 'DuplicateCharacter';
  if (code === '23503') return 'MissingRequiredField';
  if (code === '23514' || code === '22P02') return 'InvalidData';
  return 'InvalidData';
}

async function loadLookupMaps(sql: SqlClient): Promise<LookupMaps> {
  const tiers = await sql.query<{ tier_code: string; id: string }>('select tier_code, id from tiers');
  const scales = await sql.query<{ metric: string; scale_code: string; id: string }>(
    `select m.metric, s.scale_code, s.id
       from stat_scales s
       join stat_scale_metrics m on m.id = s.metric_id`,
  );
  const categories = await sql.query<{ slug: string; id: string; name: string; is_offensive: boolean }>(
    'select slug, id, name, is_offensive from ability_categories',
  );
  const resistanceTypes = await sql.query<{ category_slug: string; id: string }>(
    `select c.slug as category_slug, rt.id
       from resistance_types rt
       join ability_categories c on c.id = rt.category_id`,
  );

  return {
    tiers: new Map(tiers.map((row) => [row.tier_code, row.id])),
    scales: new Map(scales.map((row) => [`${row.metric}|${row.scale_code}`, row.id])),
    categories: new Map(categories.map((row) => [row.slug, { id: row.id, name: row.name, is_offensive: row.is_offensive }])),
    resistanceTypes: new Map(resistanceTypes.map((row) => [row.category_slug, row.id])),
  };
}

/** Apakah nilai baru boleh menimpa baris yang sumbernya berprioritas `existing`? */
function canOverwrite(incoming: number, existing: number | null | undefined): boolean {
  return incoming <= (existing ?? 5);
}

function noteSkipped(report: UpsertReport, what: string, existingPriority: number | null): void {
  report.notes.push(
    `${what} dilewati: sumber baru berprioritas ${existingPriority ?? 'lebih kuat'} (PRD §18.3, upsert tidak menurunkan mutu).`,
  );
}

async function upsertVerse(
  context: UpsertContext,
  verse: DatasetVerse,
  report: UpsertReport,
): Promise<string | null> {
  report.found += 1;
  const { sql, source, dryRun } = context;

  const rows = await sql.query<{
    id: string;
    name: string;
    description: string | null;
    origin_media: string;
    priority: number | null;
  }>(
    `select v.id, v.name, v.description, v.origin_media, s.priority
       from verses v
       left join sources s on s.id = v.source_id
      where v.slug = $1`,
    [verse.slug],
  );
  const existing = rows[0] ?? null;

  if (existing === null) {
    if (dryRun) {
      report.created += 1;
      return null;
    }
    const inserted = await sql.query<{ id: string }>(
      `insert into verses (slug, name, description, origin_media, source_id, source_url, imported_at)
       values ($1, $2, $3, $4, $5, $6, now())
       returning id`,
      [verse.slug, verse.name, verse.description, verse.origin_media, source.id, context.provenanceUrl],
    );
    report.created += 1;
    return inserted[0]?.id ?? null;
  }

  if (!canOverwrite(source.priority, existing.priority)) {
    noteSkipped(report, `verse ${verse.slug}`, existing.priority);
    return existing.id;
  }

  const changed =
    existing.name !== verse.name ||
    existing.description !== verse.description ||
    existing.origin_media !== verse.origin_media;
  if (changed && !dryRun) {
    await sql.query(
      `update verses
          set name = $2, description = $3, origin_media = $4,
              source_id = $5, source_url = $6, imported_at = now(), updated_at = now()
        where id = $1`,
      [existing.id, verse.name, verse.description, verse.origin_media, source.id, context.provenanceUrl],
    );
    report.updated += 1;
  }
  return existing.id;
}

interface CharacterState {
  id: string;
  name: string;
  native_name: string | null;
  description: string | null;
  classification: string | null;
  origin: string | null;
  media_type: string;
  source_url: string | null;
  source_name: string | null;
  priority: number | null;
}

/**
 * Atribusi per karakter (G3: setiap record punya ≥ 1 baris `character_sources`;
 * panel *Data Traceability* di halaman karakter membaca tabel ini, bukan kolom
 * jejak di `characters`).
 *
 * Satu baris berperan `identity`: sumber yang mendokumentasikan identitas
 * karakter. Untuk impor dataset, statistik/ability/resistensi juga berasal dari
 * sumber yang sama, tetapi baris per peran (`stats`, `abilities`, …) baru
 * berguna ketika satu karakter boleh datang dari beberapa sumber sekaligus.
 *
 * Idempoten lewat `unique (character_id, source_id, role)`: menjalankan dataset
 * yang sama lagi tidak menambah baris. Tidak dihitung ke `report` karena bukan
 * record kanonik — AC-08 menghitung baris karakter/form/statistik.
 */
async function recordCharacterSource(
  context: UpsertContext,
  characterId: string,
  sourceUrl: string,
): Promise<void> {
  if (context.dryRun) return;
  await context.sql.query(
    `insert into character_sources (character_id, source_id, source_url, role)
     values ($1, $2, $3, 'identity')
     on conflict (character_id, source_id, role) do nothing`,
    [characterId, context.source.id, sourceUrl],
  );
}

async function upsertCharacter(
  context: UpsertContext,
  character: DatasetCharacter,
  verseId: string | null,
  report: UpsertReport,
): Promise<string | null> {
  report.found += 1;
  const { sql, source, dryRun } = context;

  const rows = await sql.query<CharacterState>(
    `select ch.id, ch.name, ch.native_name, ch.description, ch.classification, ch.origin,
            ch.media_type, ch.source_url, ch.source_name, s.priority
       from characters ch
       left join sources s on s.id = ch.source_id
      where ch.slug = $1`,
    [character.slug],
  );
  const existing = rows[0] ?? null;
  const sourceUrl = character.source_url ?? context.provenanceUrl ?? source.base_url;

  if (existing === null) {
    if (dryRun) {
      report.created += 1;
      return null;
    }
    if (verseId === null) {
      throw new Error(`Karakter ${character.slug} tidak punya verse tujuan; impor dihentikan.`);
    }
    const inserted = await sql.query<{ id: string }>(
      `insert into characters
         (slug, name, native_name, description, origin, verse_id, classification, media_type,
          source_id, source_url, source_name, verification_status, imported_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'imported',now())
       returning id`,
      [
        character.slug,
        character.name,
        character.native_name,
        character.description,
        character.origin,
        verseId,
        character.classification,
        character.media_type,
        source.id,
        sourceUrl,
        source.name,
      ],
    );
    report.created += 1;
    const createdId = inserted[0]?.id ?? null;
    if (createdId !== null) {
      // G3: atribusi dicatat bersama barisnya, bukan di akhir job — job yang
      // berhenti di tengah tetap meninggalkan jejak sumber untuk karakter yang
      // sudah masuk. (Dry-run sudah keluar lebih awal di atas.)
      await recordCharacterSource(context, createdId, sourceUrl);
    }
    return createdId;
  }

  if (!canOverwrite(source.priority, existing.priority)) {
    noteSkipped(report, `karakter ${character.slug}`, existing.priority);
    return existing.id;
  }

  const changed =
    existing.name !== character.name ||
    existing.native_name !== character.native_name ||
    existing.description !== character.description ||
    existing.classification !== character.classification ||
    existing.origin !== character.origin ||
    existing.media_type !== character.media_type ||
    existing.source_url !== sourceUrl ||
    existing.source_name !== source.name;
  if (changed && !dryRun) {
    await sql.query(
      `update characters
          set name = $2, native_name = $3, description = $4, classification = $5, origin = $6,
              media_type = $7, source_id = $8, source_url = $9, source_name = $10,
              imported_at = now(), updated_at = now()
        where id = $1`,
      [
        existing.id,
        character.name,
        character.native_name,
        character.description,
        character.classification,
        character.origin,
        character.media_type,
        source.id,
        sourceUrl,
        source.name,
      ],
    );
    report.updated += 1;
  }
  // G3: juga untuk baris yang sudah ada — atribusi tidak bergantung pada apakah
  // nilai berubah, karena re-run dataset yang sama harus tetap meninggalkan
  // jejak sumbernya (idempoten lewat unique index).
  await recordCharacterSource(context, existing.id, sourceUrl);
  return existing.id;
}

interface FormState {
  id: string;
  name: string;
  era: string | null;
  description: string | null;
  form_order: number;
  is_default: boolean;
}

async function upsertForm(
  context: UpsertContext,
  characterId: string,
  characterMediaType: string,
  form: DatasetForm,
  report: UpsertReport,
): Promise<string | null> {
  report.found += 1;
  const { sql, dryRun } = context;

  const rows = await sql.query<FormState>(
    `select id, name, era, description, form_order, is_default
       from character_versions
      where character_id = $1 and slug = $2`,
    [characterId, form.slug],
  );
  const existing = rows[0] ?? null;

  if (existing === null) {
    if (dryRun) {
      report.created += 1;
      return null;
    }
    const inserted = await sql.query<{ id: string }>(
      `insert into character_versions
         (character_id, slug, name, era, description, form_order, is_default, media_type, verification_status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'imported')
       returning id`,
      [
        characterId,
        form.slug,
        form.name,
        form.era,
        form.description,
        form.form_order,
        form.is_default,
        characterMediaType,
      ],
    );
    const id = inserted[0]?.id ?? null;
    if (id && form.is_default) {
      await sql.query(
        `update character_versions set is_default = false, updated_at = now()
          where character_id = $1 and is_default and id <> $2`,
        [characterId, id],
      );
    }
    report.created += 1;
    return id;
  }

  const changed =
    existing.name !== form.name ||
    existing.era !== form.era ||
    existing.description !== form.description ||
    existing.form_order !== form.form_order ||
    existing.is_default !== form.is_default;
  if (changed && !dryRun) {
    if (form.is_default && !existing.is_default) {
      await sql.query(
        `update character_versions set is_default = false, updated_at = now()
          where character_id = $1 and is_default and id <> $2`,
        [characterId, existing.id],
      );
    }
    await sql.query(
      `update character_versions
          set name = $2, era = $3, description = $4, form_order = $5, is_default = $6, updated_at = now()
        where id = $1`,
      [existing.id, form.name, form.era, form.description, form.form_order, form.is_default],
    );
    report.updated += 1;
  }
  return existing.id;
}

async function upsertStatistic(
  context: UpsertContext,
  versionId: string | null,
  statistic: DatasetStatistic,
  maps: LookupMaps,
  report: UpsertReport,
  sourceUrl: string | null,
): Promise<void> {
  report.found += 1;
  const { sql, source, dryRun } = context;

  let scaleId: string | null = null;
  if (statistic.scale_code !== null) {
    const key = `${statistic.metric}|${statistic.scale_code}`;
    const found = maps.scales.get(key);
    if (!found) {
      report.failed += 1;
      report.failures.push({
        error_type: 'InvalidData',
        message: `Skala "${statistic.scale_code}" tidak dikenal untuk metrik ${statistic.metric} (stat_scales).`,
        source_url: sourceUrl,
        payload: statistic,
        http_status: null,
      });
      return;
    }
    scaleId = found;
  }

  // Dry-run pada form yang belum ada: tidak ada baris untuk dibandingkan, jadi
  // nilainya dihitung sebagai "akan dibuat" setelah skalanya lolos validasi.
  if (versionId === null) {
    report.created += 1;
    return;
  }

  const current = await sql.query<{
    id: string;
    raw_text: string;
    qualifier: string;
    confidence: number;
    scale_id: string | null;
  }>(
    `select id, raw_text, qualifier, confidence::float8 as confidence, scale_id
       from statistics
      where character_version_id = $1 and metric = $2 and source_id = $3 and status = 'current'
      order by created_at desc
      limit 1`,
    [versionId, statistic.metric, source.id],
  );

  const row = current[0] ?? null;
  if (
    row &&
    row.raw_text === statistic.raw_text &&
    row.qualifier === statistic.qualifier &&
    Number(row.confidence) === Number(statistic.confidence) &&
    row.scale_id === scaleId
  ) {
    // Nilai identik: tidak ada yang berubah. Menulis ulang di sini akan
    // membuat `superseded` menumpuk tanpa alasan dan membuat AC-08 tidak
    // bermakna pada statistik.
    return;
  }

  if (dryRun) {
    if (row) report.updated += 1;
    else report.created += 1;
    return;
  }

  await sql.query(
    `insert into statistics
       (character_version_id, metric, scale_id, raw_text, qualifier, confidence, source_id, source_url, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'current')`,
    [
      versionId,
      statistic.metric,
      scaleId,
      statistic.raw_text,
      statistic.qualifier,
      statistic.confidence,
      source.id,
      sourceUrl,
    ],
  );
  report.created += 1;
}

async function upsertAbility(
  context: UpsertContext,
  versionId: string | null,
  ability: DatasetAbility,
  maps: LookupMaps,
  report: UpsertReport,
  sourceUrl: string | null,
): Promise<void> {
  report.found += 1;
  const { sql, source, dryRun } = context;

  const category = maps.categories.get(ability.category_slug);
  if (!category) {
    report.failed += 1;
    report.failures.push({
      error_type: 'MissingRequiredField',
      message: `Kategori ability "${ability.category_slug}" tidak ada di katalog ability_categories.`,
      source_url: sourceUrl,
      payload: ability,
      http_status: null,
    });
    return;
  }

  const catalogName = ability.name ?? category.name;
  const abilitySlug = ability.slug ?? abilitySlugFor(ability.category_slug, ability.name);
  const catalogRows = await sql.query<{ id: string; name: string; priority: number | null }>(
    `select a.id, a.name, s.priority
       from abilities a
       left join sources s on s.id = a.source_id
      where a.slug = $1`,
    [abilitySlug],
  );

  if (versionId === null) {
    // Dry-run pada form baru: katalog tidak ditulis, tetapi validasinya tetap
    // berjalan sehingga diff dry-run tidak menghitung ability tak dikenal.
    report.created += 1;
    return;
  }
  let abilityId = catalogRows[0]?.id ?? null;
  if (abilityId === null) {
    if (dryRun) {
      report.created += 1;
      return;
    }
    const inserted = await sql.query<{ id: string }>(
      `insert into abilities (slug, name, category_id, source_id, is_offensive)
       values ($1,$2,$3,$4,$5)
       returning id`,
      [abilitySlug, catalogName, category.id, source.id, category.is_offensive],
    );
    abilityId = inserted[0]?.id ?? null;
    report.created += 1;
  } else if (
    catalogRows[0]!.name !== catalogName &&
    canOverwrite(source.priority, catalogRows[0]!.priority) &&
    !dryRun
  ) {
    await sql.query(`update abilities set name = $2, updated_at = now() where id = $1`, [abilityId, catalogName]);
    report.updated += 1;
  }

  if (abilityId === null) return;

  const linkRows = await sql.query<{
    id: string;
    proficiency: string;
    evidence_text: string | null;
    confidence: number;
    source_id: string;
  }>(
    `select id, proficiency, evidence_text, confidence::float8 as confidence, source_id
       from character_abilities
      where character_version_id = $1 and ability_id = $2`,
    [versionId, abilityId],
  );
  const link = linkRows[0] ?? null;
  const sameSource = link?.source_id === source.id;

  if (
    link &&
    sameSource &&
    link.proficiency === ability.proficiency &&
    link.evidence_text === ability.evidence_text &&
    Number(link.confidence) === Number(ability.confidence)
  ) {
    return;
  }

  if (dryRun) {
    if (link) report.updated += 1;
    else report.created += 1;
    return;
  }

  await sql.query(
    `insert into character_abilities
       (character_version_id, ability_id, proficiency, evidence_text, source_id, source_url, verification_status, confidence)
     values ($1,$2,$3,$4,$5,$6,'imported',$7)
     on conflict (character_version_id, ability_id) do update
        set proficiency = excluded.proficiency,
            evidence_text = excluded.evidence_text,
            source_id = excluded.source_id,
            source_url = excluded.source_url,
            confidence = excluded.confidence,
            updated_at = now()`,
    [versionId, abilityId, ability.proficiency, ability.evidence_text, source.id, sourceUrl, ability.confidence],
  );
  report.created += 1;
}

async function upsertResistance(
  context: UpsertContext,
  versionId: string | null,
  resistance: DatasetResistance,
  maps: LookupMaps,
  report: UpsertReport,
  sourceUrl: string | null,
): Promise<void> {
  report.found += 1;
  const { sql, source, dryRun } = context;

  const resistanceTypeId = maps.resistanceTypes.get(resistance.category_slug);
  if (!resistanceTypeId) {
    report.failed += 1;
    report.failures.push({
      error_type: 'MissingRequiredField',
      message: `Tipe resistensi untuk kategori "${resistance.category_slug}" tidak ada di resistance_types.`,
      source_url: sourceUrl,
      payload: resistance,
      http_status: null,
    });
    return;
  }

  // RS-3: level `absolute` hanya sah dengan bukti terverifikasi. Menolak di
  // sini membuat pesannya dapat dibaca admin, bukan pesan constraint Postgres.
  if (resistance.level === 4 && (resistance.evidence_text === null || resistance.evidence_text.trim() === '')) {
    report.failed += 1;
    report.failures.push({
      error_type: 'InvalidData',
      message: 'Resistensi level absolute (4) wajib menyertakan evidence_text (RS-3).',
      source_url: sourceUrl,
      payload: resistance,
      http_status: null,
    });
    return;
  }

  if (versionId === null) {
    report.created += 1;
    return;
  }

  const existingRows = await sql.query<{
    id: string;
    level: number;
    evidence_text: string | null;
    confidence: number;
    source_id: string;
  }>(
    `select id, level, evidence_text, confidence::float8 as confidence, source_id
       from character_resistances
      where character_version_id = $1 and resistance_type_id = $2`,
    [versionId, resistanceTypeId],
  );
  const existing = existingRows[0] ?? null;
  const sameSource = existing?.source_id === source.id;

  if (
    existing &&
    sameSource &&
    existing.level === resistance.level &&
    existing.evidence_text === resistance.evidence_text &&
    Number(existing.confidence) === Number(resistance.confidence)
  ) {
    return;
  }

  if (dryRun) {
    if (existing) report.updated += 1;
    else report.created += 1;
    return;
  }

  await sql.query(
    `insert into character_resistances
       (character_version_id, resistance_type_id, level, level_label, evidence_text,
        source_id, source_url, verification_status, confidence)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (character_version_id, resistance_type_id) do update
        set level = excluded.level,
            level_label = excluded.level_label,
            evidence_text = excluded.evidence_text,
            source_id = excluded.source_id,
            source_url = excluded.source_url,
            verification_status = excluded.verification_status,
            confidence = excluded.confidence,
            updated_at = now()`,
    [
      versionId,
      resistanceTypeId,
      resistance.level,
      RESISTANCE_LABELS[resistance.level],
      resistance.evidence_text,
      source.id,
      sourceUrl,
      resistance.level === 4 ? 'verified' : 'imported',
      resistance.confidence,
    ],
  );
  report.created += 1;
}

async function applyForm(
  context: UpsertContext,
  characterId: string,
  characterMediaType: string,
  form: DatasetForm,
  maps: LookupMaps,
  report: UpsertReport,
): Promise<void> {
  // `versionId === null` hanya terjadi pada dry-run untuk form yang belum ada;
  // statistik/ability/resistensi tetap divalidasi terhadap katalog, dan
  // ditampilkan sebagai "akan dibuat" — bukan langsung menghitung semua item
  // tanpa memeriksa apa pun.
  const versionId = await upsertForm(context, characterId, characterMediaType, form, report);
  const sourceUrl = context.provenanceUrl;

  if (form.tier_code !== null && !form.statistics.some((statistic) => statistic.metric === 'tier')) {
    if (!maps.tiers.has(form.tier_code)) {
      report.found += 1;
      report.failed += 1;
      report.failures.push({
        error_type: 'InvalidData',
        message: `Kode tier "${form.tier_code}" tidak ada di tabel tiers.`,
        source_url: sourceUrl,
        payload: { form: form.slug, tier_code: form.tier_code },
        http_status: null,
      });
    } else {
      await upsertStatistic(
        context,
        versionId,
        { metric: 'tier', raw_text: form.tier_code, qualifier: 'exact', confidence: 0.9, scale_code: null },
        maps,
        report,
        sourceUrl,
      );
    }
  }

  for (const statistic of form.statistics) {
    try {
      await upsertStatistic(context, versionId, statistic, maps, report, sourceUrl);
    } catch (error) {
      report.failed += 1;
      report.failures.push({
        error_type: errorTypeFor(error),
        message: error instanceof Error ? error.message : String(error),
        source_url: sourceUrl,
        payload: payloadSlice(statistic),
        http_status: null,
      });
    }
  }

  for (const ability of form.abilities) {
    try {
      await upsertAbility(context, versionId, ability, maps, report, sourceUrl);
    } catch (error) {
      report.failed += 1;
      report.failures.push({
        error_type: errorTypeFor(error),
        message: error instanceof Error ? error.message : String(error),
        source_url: sourceUrl,
        payload: payloadSlice(ability),
        http_status: null,
      });
    }
  }

  for (const resistance of form.resistances) {
    try {
      await upsertResistance(context, versionId, resistance, maps, report, sourceUrl);
    } catch (error) {
      report.failed += 1;
      report.failures.push({
        error_type: errorTypeFor(error),
        message: error instanceof Error ? error.message : String(error),
        source_url: sourceUrl,
        payload: payloadSlice(resistance),
        http_status: null,
      });
    }
  }
}

/**
 * Menjalankan seluruh tahap tulis untuk satu dataset. Mengembalikan laporan —
 * tidak melempar untuk kegagalan per record; melempar hanya bila pemeriksaan
 * dasar (lookup map) tidak dapat dijalankan, karena itu berarti masalah
 * database, bukan masalah data.
 */
export async function applyDataset(
  context: UpsertContext,
  dataset: DatasetEnvelope,
): Promise<UpsertReport> {
  const report: UpsertReport = { found: 0, created: 0, updated: 0, failed: 0, failures: [], notes: [] };
  const maps = await loadLookupMaps(context.sql);

  const verseId = await upsertVerse(context, dataset.verse, report);
  if (verseId === null && !context.dryRun) {
    throw new Error('Verse tidak dapat dibuat; karakter tidak punya tempat berpijak.');
  }

  for (const character of dataset.characters) {
    try {
      const characterId = await upsertCharacter(context, character, verseId, report);
      if (characterId === null) continue;
      for (const form of character.forms) {
        await applyForm(context, characterId, character.media_type, form, maps, report);
      }
    } catch (error) {
      report.failed += 1;
      report.failures.push({
        error_type: errorTypeFor(error),
        message: error instanceof Error ? error.message : String(error),
        source_url: character.source_url ?? context.provenanceUrl,
        payload: payloadSlice(character),
        http_status: null,
      });
    }
  }

  if (!context.dryRun && report.created + report.updated > 0) {
    try {
      await context.sql.query('select public.recompute_completeness()');
    } catch (error) {
      report.notes.push(
        `recompute_completeness tidak dijalankan: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return report;
}
