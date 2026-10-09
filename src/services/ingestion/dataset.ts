/**
 * Bentuk dataset terkelola (impor terkelola §40 Sprint 2) + pembacaan bertahan.
 *
 * Dataset adalah **data**, bukan kode: satu berkas JSON mendeskripsikan satu verse
 * beserta karakter, form, statistik, ability, dan resistensinya. Karena itu satu
 * fungsi validasi di sini melayani tiga jalur sekaligus: `import_dataset` (admin
 * menempel dataset), `import_url` (adapter mengambil JSON yang sama dari sumber
 * allow-list), dan `reparse` (memproses ulang dari `ingestion_raw_pages`).
 *
 * Validasi tidak berhenti pada "apakah ini objek": setiap kendala yang punya
 * padanan di DDL diperiksa lebih dulu di sini (panjang `raw_text` ≤ 400 sesuai
 * LP-4, `confidence` 0..1, level resistensi 1..4, metrik dan kualifikasi yang
 * dikenal engine). Tujuannya sederhana — data yang pasti ditolak database
 * sebaiknya ditolak sebelum satu baris pun ditulis, sehingga job tidak
 * setengah jalan dan `records_failed` menjelaskan penyebabnya, bukan menyerahkan
 * pesan constraint Postgres ke admin.
 *
 * Modul ini murni terhadap bentuk masukan: tidak menyentuh database dan tidak
 * melakukan fetch. Ia dipanggil setelah `parse`, tepat sebelum `normalize`.
 */

import type { MediaType, Proficiency, Qualifier, StatMetric } from '../battle/types.ts';

import { stableContentHash } from '../../lib/stable-hash.ts';

/** Versi parser bawaan; ikut tersimpan di `ingestion_raw_pages.parser_version`. */
export const DATASET_PARSER_VERSION = 'dataset-json@1.0.0';

/** 13 metrik engine. Dijaga tetap sinkron dengan tipe engine lewat `satisfies`. */
export const DATASET_METRICS = [
  'tier',
  'attack_potency',
  'durability',
  'striking_strength',
  'lifting_strength',
  'speed',
  'reaction_speed',
  'combat_speed',
  'range',
  'stamina',
  'intelligence',
  'battle_iq',
  'experience',
] as const satisfies readonly StatMetric[];

export const DATASET_QUALIFIERS = [
  'exact',
  'at_least',
  'at_most',
  'possibly',
  'likely',
  'up_to',
  'higher_with',
  'far_higher_with',
  'varies',
  'unknown',
] as const satisfies readonly Qualifier[];

export const DATASET_MEDIA_TYPES = [
  'manga',
  'anime',
  'game',
  'novel',
  'comic',
  'movie',
  'mixed',
  'other',
] as const satisfies readonly MediaType[];

export const DATASET_PROFICIENCIES = [
  'novice',
  'intermediate',
  'advanced',
  'master',
  'godlike',
] as const satisfies readonly Proficiency[];

export interface DatasetStatistic {
  metric: StatMetric;
  /** Teks apa adanya dari sumber (mis. "Island level"); ≤ 400 karakter (LP-4). */
  raw_text: string;
  qualifier: Qualifier;
  confidence: number;
  /** Kode skala pada `stat_scales`; `null`/absen untuk metrik `tier` dan `experience`. */
  scale_code: string | null;
}

export interface DatasetAbility {
  /** Slug kategori pada `ability_categories` (mis. `time-manipulation`). */
  category_slug: string;
  /**
   * Slug baris katalog `abilities` (unik). Bila absen, diturunkan dari `name`
   * sehingga dua ability berbeda pada kategori yang sama tidak bertabrakan.
   */
  slug: string | null;
  /** Nama tampilan katalog; default = nama kategori bila absen. */
  name: string | null;
  proficiency: Proficiency;
  evidence_text: string | null;
  confidence: number;
}

export interface DatasetResistance {
  category_slug: string;
  /** 1..4 selaras `resist_level_label_consistent` di DDL (0 tidak masuk akal untuk impor). */
  level: 1 | 2 | 3 | 4;
  evidence_text: string | null;
  confidence: number;
}

export interface DatasetForm {
  slug: string;
  name: string;
  era: string | null;
  description: string | null;
  form_order: number;
  is_default: boolean;
  /** Kode tier (mis. `5-B`); dipetakan ke `tiers` lewat statistik `metric: 'tier'`. */
  tier_code: string | null;
  statistics: DatasetStatistic[];
  abilities: DatasetAbility[];
  resistances: DatasetResistance[];
}

export interface DatasetCharacter {
  slug: string;
  name: string;
  native_name: string | null;
  description: string | null;
  classification: string | null;
  origin: string | null;
  media_type: MediaType;
  source_url: string | null;
  forms: DatasetForm[];
}

export interface DatasetVerse {
  slug: string;
  name: string;
  description: string | null;
  origin_media: MediaType;
}

export interface DatasetEnvelope {
  parser_version: string;
  source_slug: string;
  /** Jejak asal untuk atribusi (`characters.source_url`, `ingestion_raw_pages.source_url`). */
  source_url: string | null;
  verse: DatasetVerse;
  characters: DatasetCharacter[];
}

export interface DatasetIssue {
  /** Jalur lokasi masalah, mis. `characters[2].forms[0].statistics[1].raw_text`. */
  path: string;
  message: string;
}

/**
 * Hasil parse: nilai bertipe atau daftar masalah. Tidak ada pengecualian yang
 * dilempar untuk masukan yang buruk — pemanggil memutuskan apakah masalahnya
 * fatal (envelope) atau per-record (`records_failed`).
 */
export type DatasetParseResult =
  | { ok: true; dataset: DatasetEnvelope }
  | { ok: false; issues: DatasetIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((entry) => (typeof entry === 'string' ? entry : '')).filter((entry) => entry !== '');
}

class Collector {
  issues: DatasetIssue[] = [];

  add(path: string, message: string): void {
    this.issues.push({ path, message });
  }
}

function readStatistic(collector: Collector, path: string, value: unknown): DatasetStatistic | null {
  if (!isRecord(value)) {
    collector.add(path, 'statistik harus berupa objek');
    return null;
  }
  const metric = asString(value.metric);
  if (metric === null || !(DATASET_METRICS as readonly string[]).includes(metric)) {
    collector.add(`${path}.metric`, `metrik tidak dikenal: ${String(value.metric)}`);
    return null;
  }
  const rawText = asString(value.raw_text);
  if (rawText === null || rawText.trim() === '') {
    collector.add(`${path}.raw_text`, 'raw_text wajib diisi');
    return null;
  }
  if (rawText.length > 400) {
    collector.add(`${path}.raw_text`, `raw_text ${rawText.length} karakter; batas 400 (LP-4)`);
    return null;
  }
  const qualifier = asString(value.qualifier ?? 'exact');
  if (qualifier === null || !(DATASET_QUALIFIERS as readonly string[]).includes(qualifier)) {
    collector.add(`${path}.qualifier`, `kualifikasi tidak dikenal: ${String(value.qualifier)}`);
    return null;
  }
  const confidence = typeof value.confidence === 'number' ? value.confidence : 0.5;
  if (!(confidence >= 0 && confidence <= 1)) {
    collector.add(`${path}.confidence`, 'confidence harus di antara 0 dan 1');
    return null;
  }
  const scaleCode = asString(value.scale_code);

  return {
    metric: metric as StatMetric,
    raw_text: rawText,
    qualifier: qualifier as Qualifier,
    confidence,
    scale_code: scaleCode,
  };
}

function readAbility(collector: Collector, path: string, value: unknown): DatasetAbility | null {
  if (!isRecord(value)) {
    collector.add(path, 'ability harus berupa objek');
    return null;
  }
  const categorySlug = asString(value.category_slug);
  if (categorySlug === null || categorySlug.trim() === '') {
    collector.add(`${path}.category_slug`, 'category_slug wajib diisi');
    return null;
  }
  const proficiency = asString(value.proficiency ?? 'intermediate');
  if (proficiency === null || !(DATASET_PROFICIENCIES as readonly string[]).includes(proficiency)) {
    collector.add(`${path}.proficiency`, `proficiency tidak dikenal: ${String(value.proficiency)}`);
    return null;
  }
  const evidence = asString(value.evidence_text);
  if (evidence !== null && evidence.length > 400) {
    collector.add(`${path}.evidence_text`, 'evidence_text melebihi 400 karakter (LP-4)');
    return null;
  }
  const confidence = typeof value.confidence === 'number' ? value.confidence : 0.5;
  if (!(confidence >= 0 && confidence <= 1)) {
    collector.add(`${path}.confidence`, 'confidence harus di antara 0 dan 1');
    return null;
  }
  const slug = asString(value.slug);
  if (slug !== null && !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    collector.add(`${path}.slug`, 'slug ability harus huruf kecil, angka, dan tanda hubung');
    return null;
  }

  return {
    category_slug: categorySlug,
    slug,
    name: asString(value.name),
    proficiency: proficiency as Proficiency,
    evidence_text: evidence,
    confidence,
  };
}

function readResistance(collector: Collector, path: string, value: unknown): DatasetResistance | null {
  if (!isRecord(value)) {
    collector.add(path, 'resistensi harus berupa objek');
    return null;
  }
  const categorySlug = asString(value.category_slug);
  if (categorySlug === null || categorySlug.trim() === '') {
    collector.add(`${path}.category_slug`, 'category_slug wajib diisi');
    return null;
  }
  const level = value.level;
  if (level !== 1 && level !== 2 && level !== 3 && level !== 4) {
    collector.add(`${path}.level`, 'level resistensi harus 1..4 (0 = tidak ada resistensi)');
    return null;
  }
  const evidence = asString(value.evidence_text);
  if (evidence !== null && evidence.length > 400) {
    collector.add(`${path}.evidence_text`, 'evidence_text melebihi 400 karakter (LP-4)');
    return null;
  }
  const confidence = typeof value.confidence === 'number' ? value.confidence : 0.5;
  if (!(confidence >= 0 && confidence <= 1)) {
    collector.add(`${path}.confidence`, 'confidence harus di antara 0 dan 1');
    return null;
  }

  return {
    category_slug: categorySlug,
    level,
    evidence_text: evidence,
    confidence,
  };
}

function readForm(collector: Collector, path: string, value: unknown): DatasetForm | null {
  if (!isRecord(value)) {
    collector.add(path, 'form harus berupa objek');
    return null;
  }
  const slug = asString(value.slug);
  const name = asString(value.name);
  if (slug === null || slug.trim() === '') {
    collector.add(`${path}.slug`, 'slug form wajib diisi');
    return null;
  }
  if (name === null || name.trim() === '') {
    collector.add(`${path}.name`, 'nama form wajib diisi');
    return null;
  }

  const statistics: DatasetStatistic[] = [];
  const rawStatistics = value.statistics ?? [];
  if (!Array.isArray(rawStatistics)) {
    collector.add(`${path}.statistics`, 'statistics harus berupa array');
  } else {
    rawStatistics.forEach((entry, index) => {
      const parsed = readStatistic(collector, `${path}.statistics[${index}]`, entry);
      if (parsed) statistics.push(parsed);
    });
  }

  const abilities: DatasetAbility[] = [];
  const rawAbilities = value.abilities ?? [];
  if (!Array.isArray(rawAbilities)) {
    collector.add(`${path}.abilities`, 'abilities harus berupa array');
  } else {
    rawAbilities.forEach((entry, index) => {
      const parsed = readAbility(collector, `${path}.abilities[${index}]`, entry);
      if (parsed) abilities.push(parsed);
    });
  }

  const resistances: DatasetResistance[] = [];
  const rawResistances = value.resistances ?? [];
  if (!Array.isArray(rawResistances)) {
    collector.add(`${path}.resistances`, 'resistances harus berupa array');
  } else {
    rawResistances.forEach((entry, index) => {
      const parsed = readResistance(collector, `${path}.resistances[${index}]`, entry);
      if (parsed) resistances.push(parsed);
    });
  }

  const formOrder = typeof value.form_order === 'number' ? value.form_order : 0;
  if (!Number.isInteger(formOrder) || formOrder < 0 || formOrder > 32767) {
    collector.add(`${path}.form_order`, 'form_order harus bilangan bulat 0..32767 (smallint)');
    return null;
  }

  return {
    slug,
    name,
    era: asString(value.era),
    description: asString(value.description),
    form_order: formOrder,
    is_default: value.is_default === true,
    tier_code: asString(value.tier_code),
    statistics,
    abilities,
    resistances,
  };
}

function readCharacter(collector: Collector, path: string, value: unknown): DatasetCharacter | null {
  if (!isRecord(value)) {
    collector.add(path, 'karakter harus berupa objek');
    return null;
  }
  const slug = asString(value.slug);
  const name = asString(value.name);
  if (slug === null || slug.trim() === '') {
    collector.add(`${path}.slug`, 'slug karakter wajib diisi');
    return null;
  }
  if (name === null || name.trim() === '') {
    collector.add(`${path}.name`, 'nama karakter wajib diisi');
    return null;
  }

  const mediaType = asString(value.media_type ?? 'other') ?? 'other';
  if (!(DATASET_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
    collector.add(`${path}.media_type`, `media_type tidak dikenal: ${String(value.media_type)}`);
    return null;
  }

  const forms: DatasetForm[] = [];
  const rawForms = value.forms;
  if (!Array.isArray(rawForms) || rawForms.length === 0) {
    collector.add(`${path}.forms`, 'setiap karakter wajib punya minimal satu form');
    return null;
  }
  rawForms.forEach((entry, index) => {
    const parsed = readForm(collector, `${path}.forms[${index}]`, entry);
    if (parsed) forms.push(parsed);
  });

  // Bila tidak ada satu pun form ditandai default, form pertama menjadi default.
  // Tanpa ini, karakter hasil impor tidak punya titik masuk yang jelas di UI.
  if (forms.length > 0 && !forms.some((form) => form.is_default)) {
    forms[0] = { ...forms[0], is_default: true };
  }
  const defaultCount = forms.filter((form) => form.is_default).length;
  if (defaultCount > 1) {
    collector.add(`${path}.forms`, `${defaultCount} form ditandai is_default; hanya satu yang boleh (FR-1)`);
  }

  return {
    slug,
    name,
    native_name: asString(value.native_name),
    description: asString(value.description),
    classification: asString(value.classification),
    origin: asString(value.origin),
    media_type: mediaType as MediaType,
    source_url: asString(value.source_url),
    forms,
  };
}

/**
 * Membaca nilai JSON apa pun menjadi `DatasetEnvelope`. Masalah dikumpulkan
 * semua (bukan berhenti pada yang pertama) supaya admin melihat seluruh
 * koreksi yang diperlukan dalam satu kali jalan.
 */
export function parseDatasetEnvelope(value: unknown): DatasetParseResult {
  const collector = new Collector();

  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: '$', message: 'dataset harus berupa objek JSON' }] };
  }

  const parserVersion = asString(value.parser_version) ?? DATASET_PARSER_VERSION;
  const sourceSlug = asString(value.source_slug);
  if (sourceSlug === null || sourceSlug.trim() === '') {
    collector.add('$.source_slug', 'source_slug wajib diisi (harus merujuk sumber allow-list)');
  }

  const verseValue = value.verse;
  let verse: DatasetVerse | null = null;
  if (!isRecord(verseValue)) {
    collector.add('$.verse', 'verse wajib diisi');
  } else {
    const slug = asString(verseValue.slug);
    const name = asString(verseValue.name);
    const originMedia = asString(verseValue.origin_media ?? 'other') ?? 'other';
    if (slug === null || slug.trim() === '') collector.add('$.verse.slug', 'slug verse wajib diisi');
    if (name === null || name.trim() === '') collector.add('$.verse.name', 'nama verse wajib diisi');
    if (!(DATASET_MEDIA_TYPES as readonly string[]).includes(originMedia)) {
      collector.add('$.verse.origin_media', `origin_media tidak dikenal: ${String(verseValue.origin_media)}`);
    }
    if (slug && name && (DATASET_MEDIA_TYPES as readonly string[]).includes(originMedia)) {
      verse = {
        slug,
        name,
        description: asString(verseValue.description),
        origin_media: originMedia as MediaType,
      };
    }
  }

  const characters: DatasetCharacter[] = [];
  if (!Array.isArray(value.characters) || value.characters.length === 0) {
    collector.add('$.characters', 'characters wajib berisi minimal satu karakter');
  } else {
    value.characters.forEach((entry, index) => {
      const parsed = readCharacter(collector, `$.characters[${index}]`, entry);
      if (parsed) characters.push(parsed);
    });
  }

  if (collector.issues.length > 0 || !verse || !sourceSlug) {
    return { ok: false, issues: collector.issues };
  }

  return {
    ok: true,
    dataset: {
      parser_version: parserVersion,
      source_slug: sourceSlug,
      source_url: asString(value.source_url),
      verse,
      characters,
    },
  };
}

/**
 * Hash isi untuk `ingestion_raw_pages.content_hash` (idempotensi staging).
 * Implementasinya tinggal di `src/lib/stable-hash.ts` supaya sisi request dan
 * sisi worker tidak pernah punya dua algoritma yang bisa berbeda.
 */
export function datasetContentHash(value: unknown): string {
  return stableContentHash(value);
}

/** Label unik per dataset untuk `source_url` staging (`dataset://<slug>/<hash8>`). */
export function datasetStagingUrl(sourceSlug: string, contentHashValue: string): string {
  return `dataset://${sourceSlug}/${contentHashValue.slice(0, 12)}`;
}
