/**
 * Query data pertarungan untuk `/versus` dan `/versus/result`, sekaligus
 * pemilih sumber datanya (database dulu, dataset demo hanya bila database belum
 * dikonfigurasi).
 *
 * Kenapa modul ini ada: sampai 2026-10-11 pemilih di `/versus` hanya menyediakan
 * satu opsi stub ("Default Form (Auto-selected)"), dan halaman hasil menolak
 * berjalan tanpa `ALLOW_DEMO_DATA=1` — pada deployment ber-`DATABASE_URL` pun.
 * Verdict produksi karena itu hanya terlihat lewat `POST /api/battle/simulate`,
 * bukan lewat UI publik. Di sini opsi picker dibaca dari `character_versions`,
 * dan simulasinya dijalankan dari `battle_dataset` lewat `simulateFromVersions`
 * (satu round-trip, lihat catatan di `simulate.ts`).
 *
 * Aturan sumber data sama persis dengan fitur lain (lihat
 * `features/characters/detail-queries.ts`): **database dulu**; dataset demo hanya
 * bila `ALLOW_DEMO_DATA=1` **dan** `DATABASE_URL` belum diisi. Database yang
 * dikonfigurasi tetapi tidak dapat dihubungi tidak pernah ditutupi data demo —
 * galatnya diteruskan supaya gangguan infrastruktur terlihat, bukan tersamar.
 *
 * Nilai `<select>` berformat `karakter/form`. Format itu sudah dipakai tautan
 * masuk yang ada (`/character/[slug]` dan `/compare` mengirim `a=slug/form`), dan
 * `character_versions.slug` hanya unik per karakter — sehingga pasangan slug
 * adalah kunci stabil untuk URL yang dapat dibagikan.
 */

import {
  DemoDataError,
  demoBattleInput,
  demoBattleOptionGroups,
  demoEnabled,
  type DemoBattleOptionGroup,
} from '../demo/provider.ts';
import { getSqlClient, isDatabaseConfigured, type SqlClient } from '../../lib/db/client.ts';
import { BattleInputError, simulateFromSides, simulateFromVersionsWithSides } from './simulate.ts';
import type {
  BattleConditions,
  BattleResult,
  RuleSet,
  SideData,
} from '../../services/battle/types.ts';

/**
 * Opsi picker — bentuknya sama untuk jalur database dan demo.
 *
 * Tipenya tidak didefinisikan ulang di sini melainkan memakai tipe demo sebagai
 * sumbernya, supaya `demoBattleOptionGroups()` tetap lolos tanpa salinan tipe
 * yang wajib diperbarui bersamaan.
 */
export type BattleOptionGroup = DemoBattleOptionGroup;
export type BattleOption = DemoBattleOptionGroup['options'][number];

/** Dari mana data pertarungan berasal — halaman menampilkan penanda bila `demo`. */
export type BattleDataOrigin = 'database' | 'demo';

export interface BattleSelection {
  characterSlug: string;
  formSlug: string;
}

/**
 * Urai nilai `<select>` / query string: tepat dua bagian, `karakter/form`.
 *
 * Ketat dengan sengaja: `a/b/c` bukan pilihan yang sah. Pemakaian `split('/')`
 * lalu mengambil dua bagian pertama akan menerima bentuk itu selama `a/b` ada
 * di database — dan URL yang "hampir benar" lebih membingungkan daripada
 * penolakan yang jelas.
 */
export function parseBattleSelection(value: string): BattleSelection | null {
  const parts = value.split('/');
  if (parts.length !== 2) return null;

  const [characterSlug, formSlug] = parts.map((part) => part.trim());
  if (characterSlug === '' || formSlug === '') return null;

  return { characterSlug, formSlug };
}

/**
 * Label opsi, identik dengan jalur demo supaya kedua sumber tidak berbeda
 * tampilan.
 *
 * Era yang sama dengan nama form tidak diulang: sebagian dataset memakai nama
 * arc sebagai `era` sekaligus `name`, sehingga tanpa penjagaan ini opsi terbaca
 * "Post-Balding — Post-Balding (4-A)".
 */
function optionLabel(formName: string, era: string | null, tierCode: string | null): string {
  const eraPart =
    era && era.trim().toLowerCase() !== formName.trim().toLowerCase() ? ` — ${era}` : '';
  return `${formName}${eraPart} (${tierCode ?? 'tanpa tier'})`;
}

export interface BattleOptionRow {
  character_slug: string;
  character_name: string;
  form_slug: string;
  form_name: string;
  era: string | null;
  tier_code: string | null;
}

/**
 * Opsi picker dari database: satu grup per karakter, satu opsi per form aktif.
 *
 * Tanpa pagination: picker memang harus memuat seluruh karakter/form yang ada —
 * membatasinya akan menyembunyikan form yang tidak berurutan awal dan membuat
 * pertarungan tertentu tidak dapat dipilih. Urutannya popularitas lalu nama,
 * sama dengan `listCharacters`, supaya karakter populer muncul lebih dulu.
 */
export async function listBattleOptionGroups(sql: SqlClient): Promise<BattleOptionGroup[]> {
  const rows = await sql.query<BattleOptionRow>(
    `select c.slug as character_slug, c.name as character_name,
            cv.slug as form_slug, cv.name as form_name, cv.era,
            t.tier_code
       from character_versions cv
       join characters c on c.id = cv.character_id
       left join tiers t on t.id = cv.tier_id
      where cv.deleted_at is null
      order by c.popularity_score desc, c.name asc, cv.form_order asc, cv.name asc`,
  );

  const groups: BattleOptionGroup[] = [];
  const byCharacter = new Map<string, BattleOptionGroup>();

  for (const row of rows) {
    let group = byCharacter.get(row.character_slug);
    if (!group) {
      group = { label: row.character_name, options: [] };
      byCharacter.set(row.character_slug, group);
      groups.push(group);
    }

    group.options.push({
      value: `${row.character_slug}/${row.form_slug}`,
      label: optionLabel(row.form_name, row.era, row.tier_code),
      characterName: row.character_name,
      formName: row.form_name,
      tierCode: row.tier_code,
    });
  }

  return groups;
}

/**
 * `karakter/form` → `character_versions.id`, untuk beberapa nilai sekaligus.
 *
 * Satu query untuk semua nilai, bukan satu query per sisi: halaman hasil butuh
 * dua id, dan dua panggilan terpisah menambah satu round-trip tanpa manfaat
 * (PRD §29/§37: hindari N+1 dan kurangi round-trip). Kuncinya nilai asli yang
 * diminta, sehingga pemanggil dapat memetakan kembali tanpa mengurai ulang.
 *
 * Join ke `characters` bukan pilihan gaya: `character_versions.slug` unik per
 * karakter (`unique (character_id, slug)`), jadi slug form saja tidak menunjuk
 * satu baris. `deleted_at is null` menahan form yang sudah dihapus tetap dapat
 * dipakai dari URL lama. Nilai yang tidak sah atau tidak ada cukup tidak muncul
 * di peta — pemanggil yang memutuskan pesannya.
 */
export async function resolveBattleVersionIds(
  sql: SqlClient,
  values: readonly string[],
): Promise<Map<string, string>> {
  const selections = new Map<string, BattleSelection>();
  for (const value of values) {
    const selection = parseBattleSelection(value);
    if (selection) {
      selections.set(`${selection.characterSlug}/${selection.formSlug}`, selection);
    }
  }

  const resolved = new Map<string, string>();
  if (selections.size === 0) return resolved;

  const pairs = [...selections.values()];
  const placeholders = pairs.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`).join(', ');
  const params = pairs.flatMap((pair) => [pair.characterSlug, pair.formSlug]);

  const rows = await sql.query<{ character_slug: string; form_slug: string; id: string }>(
    `select c.slug as character_slug, cv.slug as form_slug, cv.id
       from character_versions cv
       join characters c on c.id = cv.character_id
      where (c.slug, cv.slug) in (${placeholders})
        and cv.deleted_at is null`,
    params,
  );

  const found = new Map(
    rows.map((row) => [`${row.character_slug}/${row.form_slug}`, row.id] as const),
  );

  for (const value of values) {
    const selection = parseBattleSelection(value);
    if (!selection) continue;
    const id = found.get(`${selection.characterSlug}/${selection.formSlug}`);
    if (id) resolved.set(value, id);
  }

  return resolved;
}

export interface BattleOptionsResult {
  groups: BattleOptionGroup[];
  source: BattleDataOrigin;
}

/** Opsi picker untuk `/versus`: database dulu, demo hanya bila belum dikonfigurasi. */
export async function loadBattleOptions(): Promise<BattleOptionsResult> {
  if (demoEnabled() && !isDatabaseConfigured()) {
    return { groups: demoBattleOptionGroups(), source: 'demo' };
  }

  const sql = getSqlClient();
  return { groups: await listBattleOptionGroups(sql), source: 'database' };
}

export interface BattleResultBundle {
  result: BattleResult;
  sideA: SideData;
  sideB: SideData;
  source: BattleDataOrigin;
}

/**
 * Hasil simulasi untuk halaman, atau penolakan yang dapat diperbaiki pengguna.
 *
 * Pilihan yang tidak sah **tidak** dilempar sebagai galat: halaman harus
 * membedakan "pilihanmu salah, pilih lagi" dari "database tidak dapat
 * dihubungi", dan pembedaan itu diputuskan di sini — bukan dengan menebak dari
 * isi pesan di dalam JSX yang tidak dapat diuji Node (lihat
 * `features/data-source.ts`). Galat infrastruktur sengaja dibiarkan naik.
 */
export type BattleLoadOutcome =
  | { status: 'ok'; bundle: BattleResultBundle }
  | { status: 'invalid'; message: string };

/**
 * Jalankan simulasi untuk dua pilihan halaman.
 *
 * Urutan pemeriksaan disengaja: nilai kosong → bentuk nilai → dua sisi sama →
 * sumber data. Akibatnya permintaan yang jelas salah dijawab tanpa menyentuh
 * database sama sekali, sehingga pesannya tidak pernah menyalahkan konfigurasi
 * server atas kesalahan pemanggil.
 */
export async function loadBattleResult(params: {
  valueA: string;
  valueB: string;
  conditions: BattleConditions;
  /**
   * Rule set aktif. Sengaja diteruskan pemanggil, bukan dimuat di sini: berkas
   * ini juga dijalankan `node --test`, dan modul `rule-set.ts` mengimpor JSON
   * yang hanya dapat dimuat bundler. Halaman tetap memakai `defaultRuleSet()`
   * yang sama dengan route API, jadi bobotnya tidak dapat berbeda.
   */
  rule_set: RuleSet;
}): Promise<BattleLoadOutcome> {
  const valueA = params.valueA.trim();
  const valueB = params.valueB.trim();

  if (valueA === '' || valueB === '') {
    return {
      status: 'invalid',
      message: 'Pilih Character A dan Character B terlebih dahulu di halaman Battle Builder.',
    };
  }

  if (!parseBattleSelection(valueA) || !parseBattleSelection(valueB)) {
    return {
      status: 'invalid',
      message:
        'Pilihan form tidak dikenal. Muat ulang halaman Battle Builder dan pilih kembali kedua sisi.',
    };
  }

  if (valueA === valueB) {
    return {
      status: 'invalid',
      message:
        'Kedua sisi memakai form yang sama. Pertarungan karakter dengan dirinya sendiri tidak menghasilkan analisis apa pun.',
    };
  }

  if (demoEnabled() && !isDatabaseConfigured()) {
    try {
      const input = demoBattleInput(valueA, valueB, params.conditions);
      return {
        status: 'ok',
        bundle: {
          result: simulateFromSides(input, params.rule_set),
          sideA: input.side_a,
          sideB: input.side_b,
          source: 'demo',
        },
      };
    } catch (error) {
      // Pemilihan sisi yang tidak ada di dataset demo adalah kesalahan pengguna.
      if (error instanceof DemoDataError) return { status: 'invalid', message: error.message };
      throw error;
    }
  }

  const sql = getSqlClient();
  const versions = await resolveBattleVersionIds(sql, [valueA, valueB]);
  const versionA = versions.get(valueA);
  const versionB = versions.get(valueB);

  if (!versionA || !versionB) {
    const missing = versionA ? valueB : valueA;
    return {
      status: 'invalid',
      message: `Form "${missing}" tidak ditemukan di database. Muat ulang halaman Battle Builder dan pilih kembali kedua sisi.`,
    };
  }

  try {
    const { result, side_a, side_b } = await simulateFromVersionsWithSides(sql, {
      side_a_version_id: versionA,
      side_b_version_id: versionB,
      conditions: params.conditions,
      rule_set: params.rule_set,
    });
    return { status: 'ok', bundle: { result, sideA: side_a, sideB: side_b, source: 'database' } };
  } catch (error) {
    // Form dihapus antara resolver dan `battle_dataset`: masih kesalahan pilihan,
    // bukan gangguan database — jangan tampilkan panel "Database belum terhubung".
    if (error instanceof BattleInputError) return { status: 'invalid', message: error.message };
    throw error;
  }
}
