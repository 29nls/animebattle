/**
 * Dataset demo **SINTETIS** — bukan data kanon, bukan hasil ingestion.
 *
 * Kenapa ada: PRD §39 menetapkan produk ini berjalan dari PostgreSQL, tetapi
 * pengembangan UI, halaman karakter/verse, dan alur battle harus dapat
 * dijalankan dan diuji tanpa infrastruktur. Dataset ini mengisi celah itu:
 * bentuk datanya **persis** `SideData` yang dihasilkan RPC `battle_dataset`,
 * sehingga engine, halaman, dan alur request memakai jalur yang sama seperti
 * produksi — yang berbeda hanya sumber barisnya.
 *
 * Aturan yang dipegang berkas ini:
 *
 * 1. **Tidak ada karakter atau statistik nyata.** Semua nama, verse, dan angka
 *    dibuat untuk pengujian. Aturan PRD "setiap fakta harus punya sumber"
 *    (AC-09) tidak dapat dipenuhi oleh data karangan, jadi data ini hanya sah
 *    ketika `ALLOW_DEMO_DATA=1` dan setiap halaman yang memakainya menampilkan
 *    penanda "data demo". Jalur database tetap satu-satunya jalur produksi.
 * 2. **Angka rank mengikuti skala `docs/seed.sql`** supaya latihan engine
 *    realistis: `attack_potency` island=14, country=16, moon=19, star=24,
 *    solar_system=26, galaxy=28, universal=30; `speed` sub_relativistic=10,
 *    ftl_plus=15, mftl_plus=17; dan seterusnya.
 * 3. **Tidak ada nilai acak dan tidak ada waktu "sekarang".** Semua id, angka,
 *    dan tanggal tetap, sehingga hasil simulasi deterministik dan dapat diuji
 *    (AC-35/§16.5).
 */

import type {
  ActivationSpeed,
  CharacterTrait,
  DataCompleteness,
  MediaType,
  MetricValues,
  Proficiency,
  ResistanceLevelLabel,
  SideAbility,
  SideData,
  SideResistance,
  SideStatistics,
  StatMetric,
} from '../../services/battle/types.ts';

/** Sumber sintetis. Diberi label eksplisit supaya tidak menyamar sebagai sumber nyata. */
export const DEMO_SOURCE = {
  id: 'demo-source-0000',
  name: 'Dataset demo (sintetis)',
  url: null,
} as const;

/** Tanggal tetap: kebijakan determinisme yang sama dengan case library. */
const DEMO_UPDATED_AT = '2026-10-09T00:00:00.000Z';

const METRIC_LABELS: Record<StatMetric, string> = {
  tier: 'Tier',
  attack_potency: 'Attack Potency',
  durability: 'Durability',
  striking_strength: 'Striking Strength',
  lifting_strength: 'Lifting Strength',
  speed: 'Speed',
  reaction_speed: 'Reaction Speed',
  combat_speed: 'Combat Speed',
  range: 'Range',
  stamina: 'Stamina',
  intelligence: 'Intelligence',
  battle_iq: 'Battle IQ',
  experience: 'Experience',
};

const RESISTANCE_LABELS: ResistanceLevelLabel[] = ['none', 'limited', 'moderate', 'high', 'absolute'];

function resistanceLabel(level: number): ResistanceLevelLabel {
  return RESISTANCE_LABELS[Math.max(0, Math.min(4, Math.trunc(level)))] ?? 'none';
}

/** Semua metrik hadir sebagai kunci; `null` berarti tidak terdokumentasikan. */
function metrics(values: Partial<Record<StatMetric, number | null>>): MetricValues {
  return {
    tier: null,
    attack_potency: null,
    durability: null,
    striking_strength: null,
    lifting_strength: null,
    speed: null,
    reaction_speed: null,
    combat_speed: null,
    range: null,
    stamina: null,
    intelligence: null,
    battle_iq: null,
    experience: null,
    ...values,
  };
}

interface AbilitySpec {
  name: string;
  category: string;
  /** Kategori bersifat negasi (mis. Existence Erasure) → attack level `absolute`. */
  negation?: boolean;
  activation?: ActivationSpeed;
  proficiency?: Proficiency;
  offensive?: boolean;
  passive?: boolean;
  prep?: boolean;
  range?: number | null;
  confidence?: number;
}

function ability(characterSlug: string, formSlug: string, index: number, spec: AbilitySpec): SideAbility {
  return {
    id: `demo-${characterSlug}-${formSlug}-ab${index + 1}`,
    name: spec.name,
    category_slug: spec.category,
    category_is_negation: spec.negation ?? false,
    activation_speed: spec.activation ?? 'instant',
    is_offensive: spec.offensive ?? true,
    is_passive: spec.passive ?? false,
    is_prep_required: spec.prep ?? false,
    proficiency: spec.proficiency ?? 'advanced',
    confidence: spec.confidence ?? 0.85,
    effective_range_rank: spec.range ?? null,
  };
}

interface ResistanceSpec {
  category: string;
  level: 0 | 1 | 2 | 3 | 4;
  /** `verified` = ada bukti; `unknown` = tanpa bukti (engine memberi penalti). */
  verified?: boolean;
  confidence?: number;
}

function resistance(spec: ResistanceSpec): SideResistance {
  return {
    resistance_type_id: `demo-rt-${spec.category}`,
    category_slug: spec.category,
    level: spec.level,
    level_label: resistanceLabel(spec.level),
    verification_status: (spec.verified ?? true) ? 'verified' : 'unknown',
    confidence: spec.confidence ?? (spec.verified ?? true ? 0.85 : 0.35),
  };
}

export interface DemoVerseSpec {
  slug: string;
  name: string;
  description: string;
  media_type: MediaType;
}

export interface DemoFormSpec {
  slug: string;
  name: string;
  era: string | null;
  description: string;
  is_default: boolean;
  form_order: number;
  tier: { code: string; rank: number };
  values: Partial<Record<StatMetric, number | null>>;
  /** Label terbaca untuk metrik penting; sisanya diisi dari `METRIC_LABELS`. */
  raw?: Partial<Record<StatMetric, string>>;
  nonphysical?: StatMetric[];
  abilities?: AbilitySpec[];
  resistances?: ResistanceSpec[];
  traits?: CharacterTrait[];
  data_completeness?: DataCompleteness;
}

export interface DemoCharacterSpec {
  slug: string;
  name: string;
  native_name: string | null;
  description: string;
  origin: string;
  gender: string;
  age: string;
  classification: string;
  verse_slug: string;
  media_type: MediaType;
  popularity_score: number;
  forms: DemoFormSpec[];
}

export const DEMO_VERSES: DemoVerseSpec[] = [
  {
    slug: 'aetherion-saga',
    name: 'Aetherion Saga',
    description:
      'Semesta demo dengan hukum sihir terikat jaringan aether. Kekuatan puncaknya bersifat kosmologis, sehingga perbandingan angka murni sering menyesatkan (data demo).',
    media_type: 'manga',
  },
  {
    slug: 'emberfall-chronicles',
    name: 'Emberfall Chronicles',
    description:
      'Semesta demo pasca-bencana: energi Ember menggantikan listrik. Fokusnya pertarungan jarak dekat, regenerasi, dan kecepatan ekstrem (data demo).',
    media_type: 'anime',
  },
  {
    slug: 'voidspire',
    name: 'Voidspire',
    description:
      'Semesta demo dengan celah menuju kehampaan. Kemampuan konseptual dan penghapusan eksistensi lazim di sini, sehingga resistensi berbukti menentukan hasil (data demo).',
    media_type: 'novel',
  },
];

export const DEMO_CHARACTERS: DemoCharacterSpec[] = [
  {
    slug: 'aster-vale',
    name: 'Aster Vale',
    native_name: 'Astér Vale',
    description:
      'Protagonis Aetherion Saga. Profilnya sengaja seimbang: tidak menonjol di satu metrik, tetapi tidak punya lubang yang mudah dieksploitasi (data demo).',
    origin: 'Aetherion Saga',
    gender: 'Male',
    age: '19',
    classification: 'Aether Knight',
    verse_slug: 'aetherion-saga',
    media_type: 'manga',
    popularity_score: 940,
    forms: [
      {
        slug: 'base',
        name: 'Squire Form',
        era: 'Prologue Arc',
        description: 'Bentuk awal sebelum aether-nya terkunci sepenuhnya (data demo).',
        is_default: true,
        form_order: 1,
        tier: { code: '6-A', rank: 18 },
        values: {
          attack_potency: 15,
          durability: 16,
          striking_strength: 15,
          lifting_strength: 13,
          speed: 12,
          reaction_speed: 10,
          combat_speed: 8,
          range: 8,
          stamina: 8,
          intelligence: 7,
          battle_iq: 6,
          experience: 25,
        },
        raw: {
          attack_potency: 'Large Island level',
          durability: 'Country level',
          speed: 'Relativistic+',
          range: 'Tens of kilometres',
          intelligence: 'Gifted tactician',
        },
        traits: ['measured'],
      },
      {
        slug: 'ascendant',
        name: 'Ascendant Form',
        era: 'Aether War Arc',
        description: 'Aether terkunci penuh; pertahanan lapis aether aktif (data demo).',
        is_default: false,
        form_order: 2,
        tier: { code: '5-B', rank: 20 },
        values: {
          attack_potency: 18,
          durability: 18,
          striking_strength: 17,
          lifting_strength: 15,
          speed: 15,
          reaction_speed: 11,
          combat_speed: 9,
          range: 10,
          stamina: 9,
          intelligence: 8,
          battle_iq: 7,
          experience: 40,
        },
        raw: {
          attack_potency: 'Multi-Continental level',
          durability: 'Multi-Continental level',
          speed: 'FTL+',
          combat_speed: '1e7 actions/second',
        },
        abilities: [{ name: 'Aether Aegis', category: 'forcefield-creation', offensive: false, passive: true, proficiency: 'master' }],
        traits: ['tactical'],
      },
    ],
  },
  {
    slug: 'seris-kaal',
    name: 'Seris Kaal',
    native_name: null,
    description:
      'Ahli kronomansi Aetherion Saga. Statistiknya rata-rata, tetapi penghentian waktu membuat selisih statistik menjadi tidak relevan (data demo).',
    origin: 'Aetherion Saga',
    gender: 'Female',
    age: '27',
    classification: 'Chronomancer',
    verse_slug: 'aetherion-saga',
    media_type: 'manga',
    popularity_score: 880,
    forms: [
      {
        slug: 'base',
        name: 'Chronomancer Form',
        era: 'Aether War Arc',
        description: 'Penghentian waktu instan dengan jangkauan terbatas (data demo).',
        is_default: true,
        form_order: 1,
        tier: { code: '5-B', rank: 20 },
        values: {
          attack_potency: 14,
          durability: 14,
          striking_strength: 14,
          lifting_strength: 12,
          speed: 11,
          reaction_speed: 9,
          combat_speed: 7,
          range: 8,
          stamina: 7,
          intelligence: 8,
          battle_iq: 6,
          experience: 30,
        },
        raw: {
          attack_potency: 'Island level',
          durability: 'Island level',
          speed: 'Relativistic',
          range: 'Kilometres (time field)',
        },
        abilities: [
          {
            name: 'Kronostasis',
            category: 'time-manipulation',
            activation: 'instant',
            proficiency: 'master',
            range: 5,
          },
        ],
        resistances: [{ category: 'time-manipulation', level: 1, verified: false }],
        traits: ['tactical'],
      },
    ],
  },
  {
    slug: 'rhun-dross',
    name: 'Rhun Dross',
    native_name: null,
    description:
      'Tank Emberfall Chronicles. Daya tahannya jauh di atas tingkat tier-nya, tetapi kecepatannya tertinggal (data demo).',
    origin: 'Emberfall Chronicles',
    gender: 'Male',
    age: '41',
    classification: 'Ember Colossus',
    verse_slug: 'emberfall-chronicles',
    media_type: 'anime',
    popularity_score: 810,
    forms: [
      {
        slug: 'base',
        name: 'Colossus Form',
        era: 'Emberfall Arc',
        description: 'Regenerasi cepat dan tubuh yang sulit dihancurkan (data demo).',
        is_default: true,
        form_order: 1,
        tier: { code: '4-C', rank: 22 },
        values: {
          attack_potency: 18,
          durability: 24,
          striking_strength: 20,
          lifting_strength: 17,
          speed: 10,
          reaction_speed: 8,
          combat_speed: 6,
          range: 7,
          stamina: 9,
          intelligence: 6,
          battle_iq: 5,
          experience: 40,
        },
        raw: {
          attack_potency: 'Multi-Continental level',
          durability: 'Star level',
          speed: 'Sub-relativistic',
        },
        abilities: [
          { name: 'Ember Reconstitution', category: 'regeneration', offensive: false, passive: true, activation: 'triggered', proficiency: 'master' },
          { name: 'Undying Cinder', category: 'immortality', offensive: false, passive: true, activation: 'triggered' },
        ],
        traits: ['aggressive'],
      },
    ],
  },
  {
    slug: 'nyx-ardor',
    name: 'Nyx Ardor',
    native_name: null,
    description:
      'Penyerang cepat Emberfall Chronicles. Unggul dalam kecepatan, tetapi rapuh bila terpaksa bertukar pukulan (data demo).',
    origin: 'Emberfall Chronicles',
    gender: 'Female',
    age: '23',
    classification: 'Ember Runner',
    verse_slug: 'emberfall-chronicles',
    media_type: 'anime',
    popularity_score: 860,
    forms: [
      {
        slug: 'base',
        name: 'Runner Form',
        era: 'Emberfall Arc',
        description: 'Kecepatan gerak ekstrem dengan daya tahan terbatas (data demo).',
        is_default: true,
        form_order: 1,
        tier: { code: '5-B', rank: 20 },
        values: {
          attack_potency: 14,
          durability: 13,
          striking_strength: 13,
          lifting_strength: 11,
          speed: 18,
          reaction_speed: 12,
          combat_speed: 11,
          range: 6,
          stamina: 7,
          intelligence: 7,
          battle_iq: 7,
          experience: 28,
        },
        raw: {
          attack_potency: 'Island level',
          speed: 'Massively FTL+',
          combat_speed: '1e11 actions/second',
        },
        abilities: [{ name: 'Ember Surge', category: 'statistics-amplification', offensive: false, passive: true }],
        traits: ['reckless'],
      },
      {
        slug: 'blaze',
        name: 'Blaze Form',
        era: 'Ashen Sky Arc',
        description: 'Ember di dalam tubuh dibakar sekaligus; lebih kuat, tetap rapuh (data demo).',
        is_default: false,
        form_order: 2,
        tier: { code: '4-B', rank: 23 },
        values: {
          attack_potency: 17,
          durability: 16,
          striking_strength: 16,
          lifting_strength: 13,
          speed: 20,
          reaction_speed: 13,
          combat_speed: 12,
          range: 7,
          stamina: 8,
          intelligence: 7,
          battle_iq: 7,
          experience: 35,
        },
        raw: {
          attack_potency: 'Large Country level',
          speed: 'Immeasurable (blaze regime)',
        },
        nonphysical: ['speed'],
        abilities: [
          { name: 'Blaze Overdrive', category: 'statistics-amplification', offensive: false, passive: true },
          { name: 'Cinder Aura', category: 'aura', offensive: false, passive: true },
        ],
        traits: ['reckless'],
      },
    ],
  },
  {
    slug: 'ilya-morn',
    name: 'Ilya Morn',
    native_name: null,
    description:
      'Spesialis penghapusan eksistensi Voidspire. Kemampuan hax-nya menembus pertahanan fisika, sehingga resistensi berbukti menjadi penentu (data demo).',
    origin: 'Voidspire',
    gender: 'Female',
    age: '31',
    classification: 'Void Warden',
    verse_slug: 'voidspire',
    media_type: 'novel',
    popularity_score: 900,
    forms: [
      {
        slug: 'base',
        name: 'Warden Form',
        era: 'Voidspire Arc',
        description: 'Sentuhan yang menghapus keberadaan target, wajib kontak (data demo).',
        is_default: true,
        form_order: 1,
        tier: { code: '5-B', rank: 20 },
        values: {
          attack_potency: 15,
          durability: 15,
          striking_strength: 15,
          lifting_strength: 12,
          speed: 12,
          reaction_speed: 10,
          combat_speed: 8,
          range: 9,
          stamina: 7,
          intelligence: 8,
          battle_iq: 7,
          experience: 30,
        },
        raw: {
          attack_potency: 'Large Island level',
          durability: 'Large Island level',
          speed: 'Relativistic+',
          range: 'Kilometres (void reach)',
        },
        abilities: [
          {
            name: 'Unbeing Touch',
            category: 'existence-erasure',
            negation: true,
            activation: 'instant',
            proficiency: 'master',
            range: 6,
          },
        ],
        resistances: [{ category: 'existence-erasure', level: 1, verified: false }],
        traits: ['measured'],
      },
    ],
  },
  {
    slug: 'kael-vantor',
    name: 'Kael Vantor',
    native_name: null,
    description:
      'Entitas puncak Voidspire. Statistiknya berada di rezim kosmologis, dan perang realitas membuat perbandingan energi murni tidak bermakna (data demo).',
    origin: 'Voidspire',
    gender: 'Male',
    age: 'Tidak diketahui',
    classification: 'Void Sovereign',
    verse_slug: 'voidspire',
    media_type: 'novel',
    popularity_score: 970,
    forms: [
      {
        slug: 'warden',
        name: 'Sovereign Form',
        era: 'Voidspire Arc',
        description: 'Perang realitas instan dengan resistensi konseptual berbukti (data demo).',
        is_default: true,
        form_order: 1,
        tier: { code: '4-B', rank: 23 },
        values: {
          attack_potency: 22,
          durability: 22,
          striking_strength: 21,
          lifting_strength: 18,
          speed: 16,
          reaction_speed: 12,
          combat_speed: 10,
          range: 14,
          stamina: 10,
          intelligence: 10,
          battle_iq: 8,
          experience: 60,
        },
        raw: {
          attack_potency: 'Large Planet level',
          durability: 'Large Planet level',
          speed: 'FTL++',
          range: 'Interplanetary',
          intelligence: 'Supergenius',
        },
        abilities: [
          {
            name: 'Sovereign Rewrite',
            category: 'reality-warping',
            activation: 'instant',
            proficiency: 'godlike',
            range: 12,
          },
        ],
        resistances: [
          { category: 'reality-warping', level: 3 },
          { category: 'time-manipulation', level: 2 },
        ],
        traits: ['tactical'],
      },
      {
        slug: 'sealed',
        name: 'Sealed Form',
        era: 'Voidspire Arc',
        description: 'Sebagian besar kekuatan disegel oleh kontrak void (data demo).',
        is_default: false,
        form_order: 2,
        tier: { code: '4-C', rank: 22 },
        values: {
          attack_potency: 18,
          durability: 18,
          striking_strength: 17,
          lifting_strength: 15,
          speed: 13,
          reaction_speed: 10,
          combat_speed: 8,
          range: 10,
          stamina: 8,
          intelligence: 9,
          battle_iq: 7,
          experience: 55,
        },
        raw: {
          attack_potency: 'Multi-Continental level',
          durability: 'Multi-Continental level',
        },
        abilities: [
          {
            name: 'Partial Rewrite',
            category: 'reality-warping',
            activation: 'fast',
            proficiency: 'master',
            range: 8,
          },
        ],
        resistances: [{ category: 'reality-warping', level: 1, verified: false }],
        traits: ['holds_back'],
      },
    ],
  },
];

/** Ringkasan yang telah diperluas: satu baris per form, siap dipakai engine atau halaman. */
export interface DemoFormRecord {
  character: DemoCharacterSpec;
  form: DemoFormSpec;
  /** Baris `SideData` — bentuk yang sama dengan keluaran RPC `battle_dataset`. */
  side: SideData;
}

function buildStatistics(form: DemoFormSpec, values: MetricValues): SideStatistics[] {
  const entries: SideStatistics[] = [];
  for (const [metric, rank] of Object.entries(values) as [StatMetric, number | null][]) {
    if (rank === null) continue;
    entries.push({
      metric,
      raw_text: form.raw?.[metric] ?? `${METRIC_LABELS[metric]} (data demo, rank ${rank})`,
      qualifier: 'exact',
      scale_rank: rank,
      confidence: 0.85,
      source_id: DEMO_SOURCE.id,
      status: 'current',
    });
  }
  return entries.sort((a, b) => a.metric.localeCompare(b.metric));
}

function buildSide(character: DemoCharacterSpec, form: DemoFormSpec, verse: DemoVerseSpec): SideData {
  const values = metrics({ tier: form.tier.rank, ...form.values });
  return {
    version_id: `demo-version-${character.slug}-${form.slug}`,
    character: {
      id: `demo-character-${character.slug}`,
      slug: character.slug,
      name: character.name,
    },
    verse: { id: `demo-verse-${verse.slug}`, slug: verse.slug, name: verse.name },
    form: {
      id: `demo-version-${character.slug}-${form.slug}`,
      slug: form.slug,
      name: form.name,
      era: form.era,
      data_completeness: form.data_completeness ?? 'complete',
      media_type: character.media_type,
    },
    tier: { code: form.tier.code, rank: form.tier.rank, rankable: true },
    metrics: values,
    nonphysical_metrics: form.nonphysical ?? [],
    statistics: buildStatistics(form, values),
    abilities: (form.abilities ?? []).map((spec, index) => ability(character.slug, form.slug, index, spec)),
    resistances: (form.resistances ?? []).map(resistance),
    traits: form.traits ?? [],
  };
}

/**
 * Ekspansi dataset. Dijalankan sekali saat modul dimuat; keluarannya deterministik
 * sehingga test dapat membandingkan isinya tanpa database.
 */
export const DEMO_FORM_RECORDS: DemoFormRecord[] = DEMO_CHARACTERS.flatMap((character) => {
  const verse = DEMO_VERSES.find((candidate) => candidate.slug === character.verse_slug);
  if (!verse) {
    throw new Error(`Dataset demo tidak konsisten: verse "${character.verse_slug}" tidak ada.`);
  }
  return character.forms.map((form) => ({ character, form, side: buildSide(character, form, verse) }));
});

/** Indeks cepat `characterSlug/formSlug` → record. */
export const DEMO_FORM_INDEX: ReadonlyMap<string, DemoFormRecord> = new Map(
  DEMO_FORM_RECORDS.map((record) => [`${record.character.slug}/${record.form.slug}`, record]),
);

/** Form default tiap karakter (dipakai tautan `/versus` dan kartu daftar). */
export function demoDefaultForm(characterSlug: string): DemoFormRecord | null {
  const records = DEMO_FORM_RECORDS.filter((record) => record.character.slug === characterSlug);
  if (records.length === 0) return null;
  return records.find((record) => record.form.is_default) ?? records[0];
}

export function demoForm(characterSlug: string, formSlug: string): DemoFormRecord | null {
  return DEMO_FORM_INDEX.get(`${characterSlug}/${formSlug}`) ?? null;
}
