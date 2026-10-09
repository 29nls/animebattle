/**
 * Penyedia data demo.
 *
 * Perannya sempit dan disengaja: **hanya** aktif bila `ALLOW_DEMO_DATA=1` **dan**
 * PostgreSQL tidak dikonfigurasi. Begitu `DATABASE_URL` diisi, seluruh halaman
 * memakai jalur database tanpa perubahan kode — data demo tidak pernah menimpa
 * data sungguhan, dan tidak pernah muncul di produksi secara tidak sengaja.
 *
 * Kalau database *dikonfigurasi* tetapi tidak dapat dihubungi, galatnya
 * diteruskan apa adanya: menyembunyikan gangguan infrastruktur di balik data
 * demo akan membuat operator mengejar masalah yang salah.
 *
 * Bentuk keluaran fungsi-fungsi di sini adalah view model yang sama dengan yang
 * dihasilkan query SQL (lihat `types` yang diimpor), sehingga halaman tidak tahu
 * (dan tidak perlu tahu) dari mana barisnya datang.
 */

import type { CharacterListItem } from '../characters/queries.ts';
import type {
  CharacterDetail,
  CharacterFormItem,
  CharacterSourceItem,
  FormAbility,
  FormResistance,
  FormStatistic,
} from '../characters/detail-queries.ts';
import type { VerseCharacterItem, VerseDetail, VerseListItem } from '../verses/queries.ts';
import type { BattleConditions, BattleInput, SideData } from '../../services/battle/types.ts';
import {
  DEMO_CHARACTERS,
  DEMO_FORM_RECORDS,
  DEMO_SOURCE,
  DEMO_VERSES,
  demoDefaultForm,
  demoForm,
} from './dataset.ts';

const DEMO_UPDATED_AT = '2026-10-09T00:00:00.000Z';

/** Nama tampilan untuk slug kategori ability/resistensi yang dipakai dataset. */
const CATEGORY_NAMES: Record<string, string> = {
  'time-manipulation': 'Time Manipulation',
  'existence-erasure': 'Existence Erasure',
  'reality-warping': 'Reality Warping',
  'forcefield-creation': 'Forcefield Creation',
  'statistics-amplification': 'Statistics Amplification',
  'regeneration': 'Regeneration',
  'immortality': 'Immortality',
  'aura': 'Aura',
};

function categoryName(slug: string): string {
  return CATEGORY_NAMES[slug] ?? slug.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Galat yang dapat diperbaiki pengguna (pilihan sisi tidak sah) — halaman menampilkannya, bukan 500. */
export class DemoDataError extends Error {
  override readonly name = 'DemoDataError';
}

/** Apakah data demo diizinkan? Opt-in eksplisit, bukan default. */
export function demoEnabled(): boolean {
  return process.env.ALLOW_DEMO_DATA === '1';
}

export const DEMO_LABEL = 'Data demo (sintetis)';
export const DEMO_NOTICE =
  'Halaman ini menampilkan dataset demo sintetis karena PostgreSQL belum dikonfigurasi. Semua nama, verse, dan angka dibuat untuk pengujian — bukan data kanon dan tidak dapat ditelusuri ke sumber (AC-09 belum berlaku di sini).';

export function demoCharacterListItems(query?: string): CharacterListItem[] {
  const q = (query ?? '').trim().toLowerCase();
  const matches = q === ''
    ? DEMO_CHARACTERS
    : DEMO_CHARACTERS.filter((character) => {
        const haystack = [character.name, character.native_name ?? '', character.origin, character.classification]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      });

  return matches
    .slice()
    .sort((a, b) => b.popularity_score - a.popularity_score || a.name.localeCompare(b.name))
    .map((character) => ({
      id: `demo-character-${character.slug}`,
      slug: character.slug,
      name: character.name,
      native_name: character.native_name,
      image_url: null,
      data_completeness: 'complete' as const,
      popularity_score: character.popularity_score,
      updated_at: DEMO_UPDATED_AT,
      tier_code: demoDefaultForm(character.slug)?.side.tier.code ?? null,
    }));
}

export function demoVerseListItems(): VerseListItem[] {
  return DEMO_VERSES.map((verse) => ({
    id: `demo-verse-${verse.slug}`,
    slug: verse.slug,
    name: verse.name,
    description: verse.description,
    image_url: null,
    character_count: DEMO_CHARACTERS.filter((character) => character.verse_slug === verse.slug).length,
    media_type: verse.media_type,
    updated_at: DEMO_UPDATED_AT,
  })).sort((a, b) => b.character_count - a.character_count || a.name.localeCompare(b.name));
}

export interface DemoCharacterDetailResult {
  character: CharacterDetail;
  forms: CharacterFormItem[];
  statistics: FormStatistic[];
  abilities: FormAbility[];
  resistances: FormResistance[];
  sources: CharacterSourceItem[];
}

export function demoCharacterDetail(
  slug: string,
  formSlug?: string,
): DemoCharacterDetailResult | null {
  const character = DEMO_CHARACTERS.find((candidate) => candidate.slug === slug);
  if (!character) return null;

  const verse = DEMO_VERSES.find((candidate) => candidate.slug === character.verse_slug);
  const records = DEMO_FORM_RECORDS.filter((record) => record.character.slug === slug);
  const selected = (formSlug ? demoForm(slug, formSlug) : null) ?? demoDefaultForm(slug);
  if (!verse || !selected) return null;

  const side = selected.side;

  return {
    character: {
      id: side.character.id,
      slug: character.slug,
      name: character.name,
      native_name: character.native_name,
      description: character.description,
      image_url: null,
      image_source: null,
      image_license: null,
      image_attribution: null,
      origin: character.origin,
      gender: character.gender,
      age: character.age,
      classification: character.classification,
      media_type: character.media_type,
      data_completeness: 'complete',
      verification_status: 'imported',
      popularity_score: character.popularity_score,
      verse_id: side.verse.id,
      verse_slug: verse.slug,
      verse_name: verse.name,
      updated_at: DEMO_UPDATED_AT,
    },
    forms: records.map((record) => ({
      id: record.side.version_id,
      slug: record.form.slug,
      name: record.form.name,
      era: record.form.era,
      description: record.form.description,
      is_default: record.form.is_default,
      form_order: record.form.form_order,
      tier_code: record.side.tier.code,
      tier_rank: record.side.tier.rank,
    })),
    statistics: side.statistics.map((entry) => ({
      metric: entry.metric,
      raw_text: entry.raw_text,
      qualifier: entry.qualifier,
      scale_rank: entry.scale_rank,
      confidence: entry.confidence,
      source_name: DEMO_SOURCE.name,
      source_url: DEMO_SOURCE.url,
      status: entry.status,
    })),
    abilities: side.abilities.map((entry) => ({
      id: entry.id,
      ability_id: entry.id,
      ability_name: entry.name,
      category_slug: entry.category_slug,
      category_name: categoryName(entry.category_slug),
      activation_speed: entry.activation_speed,
      proficiency: entry.proficiency,
      is_offensive: entry.is_offensive,
      is_passive: entry.is_passive,
      confidence: entry.confidence,
      evidence: null,
    })),
    resistances: side.resistances.map((entry) => ({
      id: entry.resistance_type_id,
      resistance_type_name: categoryName(entry.category_slug),
      category_slug: entry.category_slug,
      level: entry.level,
      level_label: entry.level_label,
      verification_status: entry.verification_status,
      confidence: entry.confidence,
      evidence: null,
    })),
    sources: [
      {
        source_id: DEMO_SOURCE.id,
        source_name: DEMO_SOURCE.name,
        source_url: DEMO_SOURCE.url,
        fetched_at: DEMO_UPDATED_AT,
        verification_status: 'imported',
      },
    ],
  };
}

export interface DemoVerseDetailResult {
  verse: VerseDetail;
  characters: VerseCharacterItem[];
}

export function demoVerseDetail(slug: string): DemoVerseDetailResult | null {
  const verse = DEMO_VERSES.find((candidate) => candidate.slug === slug);
  if (!verse) return null;

  const characters = DEMO_CHARACTERS.filter((character) => character.verse_slug === slug).sort(
    (a, b) => b.popularity_score - a.popularity_score || a.name.localeCompare(b.name),
  );

  return {
    verse: {
      id: `demo-verse-${verse.slug}`,
      slug: verse.slug,
      name: verse.name,
      description: verse.description,
      image_url: null,
      media_type: verse.media_type,
      character_count: characters.length,
      updated_at: DEMO_UPDATED_AT,
    },
    characters: characters.map((character) => {
      const defaultForm = demoDefaultForm(character.slug);
      return {
        id: `demo-character-${character.slug}`,
        slug: character.slug,
        name: character.name,
        native_name: character.native_name,
        image_url: null,
        tier_code: defaultForm?.side.tier.code ?? null,
        popularity_score: character.popularity_score,
      };
    }),
  };
}

/** Nilai `<select>` pada `/versus`: `karakter/form`, dibaca lagi oleh halaman hasil. */
export interface DemoBattleOption {
  value: string;
  label: string;
  characterName: string;
  formName: string;
  tierCode: string | null;
}

export interface DemoBattleOptionGroup {
  label: string;
  options: DemoBattleOption[];
}

export function demoBattleOptionGroups(): DemoBattleOptionGroup[] {
  return DEMO_CHARACTERS.map((character) => ({
    label: character.name,
    options: DEMO_FORM_RECORDS.filter((record) => record.character.slug === character.slug).map(
      (record) => ({
        value: `${character.slug}/${record.form.slug}`,
        label: `${record.form.name}${record.form.era ? ` — ${record.form.era}` : ''} (${record.side.tier.code ?? 'tanpa tier'})`,
        characterName: character.name,
        formName: record.form.name,
        tierCode: record.side.tier.code,
      }),
    ),
  }));
}

export function demoBattleDefaultValue(characterSlug: string): string | null {
  const record = demoDefaultForm(characterSlug);
  return record ? `${record.character.slug}/${record.form.slug}` : null;
}

/** Sisi engine dari satu nilai pilihan; melempar `DemoDataError` bila tidak dikenal. */
export function demoSideFromValue(value: string, sideLabel: string): SideData {
  const [characterSlug, formSlug] = value.split('/');
  if (!characterSlug || !formSlug) {
    throw new DemoDataError(`${sideLabel}: pilih karakter dan formnya.`);
  }

  const record = demoForm(characterSlug, formSlug);
  if (!record) {
    throw new DemoDataError(
      `${sideLabel}: pilihan "${value}" tidak ada di dataset demo. Muat ulang halaman /versus dan pilih kembali.`,
    );
  }

  return record.side;
}

/**
 * Input engine dari dua pilihan halaman. Pemeriksaan "form yang sama" dilakukan
 * di sini supaya pesannya menyebut apa yang salah, bukan gagal di dalam engine.
 */
export function demoBattleInput(
  valueA: string,
  valueB: string,
  conditions: BattleConditions,
): BattleInput {
  const sideA = demoSideFromValue(valueA, 'Sisi A');
  const sideB = demoSideFromValue(valueB, 'Sisi B');

  if (sideA.version_id === sideB.version_id) {
    throw new DemoDataError(
      'Kedua sisi memakai form yang sama. Pertarungan karakter dengan dirinya sendiri tidak menghasilkan analisis apa pun.',
    );
  }

  return { side_a: sideA, side_b: sideB, conditions };
}
