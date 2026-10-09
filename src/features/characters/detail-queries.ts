/**
 * Query halaman detail karakter. Mendukung pemilihan form via slug.
 * Semua data diambil di server; browser hanya menerima HTML yang sudah dirender.
 *
 * Pola: kolom eksplisit, join terkecil, pagination/limit pada subquery.
 */

import { demoCharacterDetail, demoEnabled } from '../demo/provider.ts';
import { getSqlClient, isDatabaseConfigured, type SqlClient } from '../../lib/db/client.ts';

export interface CharacterDetail {
  id: string;
  slug: string;
  name: string;
  native_name: string | null;
  description: string | null;
  image_url: string | null;
  image_source: string | null;
  image_license: string | null;
  image_attribution: string | null;
  origin: string | null;
  gender: string | null;
  age: string | null;
  classification: string | null;
  media_type: string;
  data_completeness: string;
  verification_status: string;
  popularity_score: number;
  verse_id: string;
  verse_slug: string;
  verse_name: string;
  updated_at: string;
}

export async function getCharacterBySlug(
  sql: SqlClient,
  slug: string,
): Promise<CharacterDetail | null> {
  const rows = await sql.query<CharacterDetail>(
    `select c.id, c.slug, c.name, c.native_name, c.description,
            c.image_url, c.image_source, c.image_license, c.image_attribution,
            c.origin, c.gender, c.age, c.classification, c.media_type,
            c.data_completeness, c.verification_status, c.popularity_score,
            c.verse_id,
            v.slug as verse_slug, v.name as verse_name,
            c.updated_at
       from characters c
       join verses v on v.id = c.verse_id
      where c.slug = $1
      limit 1`,
    [slug],
  );
  return rows[0] ?? null;
}

export interface CharacterFormItem {
  id: string;
  slug: string;
  name: string;
  era: string | null;
  description: string | null;
  is_default: boolean;
  form_order: number;
  tier_code: string | null;
  tier_rank: number | null;
}

export async function listCharacterForms(
  sql: SqlClient,
  characterId: string,
): Promise<CharacterFormItem[]> {
  return sql.query<CharacterFormItem>(
    `select cv.id, cv.slug, cv.name, cv.era, cv.description,
            cv.is_default, cv.form_order,
            t.tier_code, t.numerical_rank as tier_rank
       from character_versions cv
       left join tiers t on t.id = cv.tier_id
      where cv.character_id = $1
        and cv.deleted_at is null
      order by cv.form_order asc, cv.name asc`,
    [characterId],
  );
}

export interface FormStatistic {
  metric: string;
  raw_text: string;
  qualifier: string;
  scale_rank: number | null;
  confidence: number;
  source_name: string | null;
  source_url: string | null;
  status: string;
}

export async function listFormStatistics(
  sql: SqlClient,
  versionId: string,
): Promise<FormStatistic[]> {
  return sql.query<FormStatistic>(
    `select s.metric, s.raw_text, s.qualifier,
            s.scale_rank, s.confidence,
            src.name as source_name, src.url as source_url,
            s.status
       from statistics s
       left join sources src on src.id = s.source_id
      where s.character_version_id = $1
        and s.status = 'current'
      order by s.metric asc`,
    [versionId],
  );
}

export interface FormAbility {
  id: string;
  ability_id: string;
  ability_name: string;
  category_slug: string;
  category_name: string;
  activation_speed: string;
  proficiency: string;
  is_offensive: boolean;
  is_passive: boolean;
  confidence: number;
  evidence: string | null;
}

export async function listFormAbilities(
  sql: SqlClient,
  versionId: string,
): Promise<FormAbility[]> {
  return sql.query<FormAbility>(
    `select ca.id, ca.ability_id,
            a.name as ability_name,
            ac.slug as category_slug, ac.name as category_name,
            ca.activation_speed, ca.proficiency,
            ca.is_offensive, ca.is_passive,
            ca.confidence, ca.evidence
       from character_abilities ca
       join abilities a on a.id = ca.ability_id
       join ability_categories ac on ac.id = a.category_id
      where ca.character_version_id = $1
      order by ac.name asc, a.name asc`,
    [versionId],
  );
}

export interface FormResistance {
  id: string;
  resistance_type_name: string;
  category_slug: string;
  level: number;
  level_label: string;
  verification_status: string;
  confidence: number;
  evidence: string | null;
}

export async function listFormResistances(
  sql: SqlClient,
  versionId: string,
): Promise<FormResistance[]> {
  return sql.query<FormResistance>(
    `select cr.id,
            rt.name as resistance_type_name,
            ac.slug as category_slug,
            cr.level, cr.level_label,
            cr.verification_status, cr.confidence,
            cr.evidence
       from character_resistances cr
       join resistance_types rt on rt.id = cr.resistance_type_id
       join ability_categories ac on ac.id = rt.category_id
      where cr.character_version_id = $1
      order by cr.level desc, rt.name asc`,
    [versionId],
  );
}

export interface CharacterSourceItem {
  source_id: string;
  source_name: string;
  source_url: string | null;
  fetched_at: string | null;
  verification_status: string;
}

export async function listCharacterSources(
  sql: SqlClient,
  characterId: string,
): Promise<CharacterSourceItem[]> {
  return sql.query<CharacterSourceItem>(
    `select distinct cs.source_id,
            s.name as source_name, s.url as source_url,
            cs.fetched_at, cs.verification_status
       from character_sources cs
       join sources s on s.id = cs.source_id
      where cs.character_id = $1
      order by cs.fetched_at desc nulls last`,
    [characterId],
  );
}

/** Dari mana data detail berasal — halaman menampilkan penanda bila `demo`. */
export type CharacterDetailSource = 'database' | 'demo';

export interface CharacterDetailBundle {
  character: CharacterDetail;
  forms: CharacterFormItem[];
  /** Form yang sedang dipilih (default = `is_default`, atau form pertama). */
  activeForm: CharacterFormItem | null;
  statistics: FormStatistic[];
  abilities: FormAbility[];
  resistances: FormResistance[];
  sources: CharacterSourceItem[];
  source: CharacterDetailSource;
}

/**
 * Pemilih sumber data untuk `/character/[slug]`.
 *
 * Aturan prioritas sama dengan daftar karakter: database dulu; dataset demo hanya
 * bila database belum dikonfigurasi dan `ALLOW_DEMO_DATA=1`. Form aktif dipilih
 * sekali di sini supaya halaman tidak menebak-nebak urutan prioritasnya.
 */
export async function loadCharacterDetail(
  slug: string,
  formSlug?: string,
): Promise<CharacterDetailBundle | null> {
  if (demoEnabled() && !isDatabaseConfigured()) {
    const demo = demoCharacterDetail(slug, formSlug);
    if (!demo) return null;
    const activeForm =
      demo.forms.find((form) => form.slug === formSlug) ??
      demo.forms.find((form) => form.is_default) ??
      demo.forms[0] ??
      null;
    return { ...demo, activeForm, source: 'demo' };
  }

  const sql = getSqlClient();
  const character = await getCharacterBySlug(sql, slug);
  if (!character) return null;

  const forms = await listCharacterForms(sql, character.id);
  const activeForm =
    forms.find((form) => form.slug === formSlug) ??
    forms.find((form) => form.is_default) ??
    forms[0] ??
    null;

  const [statistics, abilities, resistances, sources] = await Promise.all([
    activeForm ? listFormStatistics(sql, activeForm.id) : Promise.resolve([]),
    activeForm ? listFormAbilities(sql, activeForm.id) : Promise.resolve([]),
    activeForm ? listFormResistances(sql, activeForm.id) : Promise.resolve([]),
    listCharacterSources(sql, character.id),
  ]);

  return { character, forms, activeForm, statistics, abilities, resistances, sources, source: 'database' };
}
