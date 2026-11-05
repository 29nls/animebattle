/**
 * Query ringan untuk combobox pemilih form di `/versus`.
 *
 * Kenapa modul terpisah: sampai sekarang halaman memuat **seluruh** karakter dan
 * form dalam satu query hanya untuk mengisi `<select>`. Itu tidak dapat diskalakan
 * — setiap pengunjung mengangkut katalog penuh sebelum dapat memilih apa pun —
 * dan bertentangan dengan aturan repo bahwa daftar panjang dipaginasi di server.
 *
 * Combobox memilih **karakter** lewat `/api/search/suggest` (fungsi pencarian yang
 * sama dengan halaman `/characters`), lalu mengambil form karakter itu saja lewat
 * `/api/characters/:slug/versions`. Jadi payload per permintaan sebanding dengan
 * form satu karakter, bukan seluruh katalog.
 *
 * Modul ini hanya SQL; keputusan 404/503 ada di route.
 */

import { getSqlClient, isDatabaseConfigured, type SqlClient } from '../../lib/db/client.ts';
import { demoBattleOptionGroups, demoEnabled, type DemoBattleOptionGroup } from '../demo/provider.ts';
import { parseBattleSelection } from './queries.ts';

/** Satu form yang dapat dipilih, dengan nilai `karakter/form` yang stabil. */
export interface PickerFormOption {
  value: string;
  label: string;
  tier_code: string | null;
}

/** Label opsi; bentuknya sama dengan picker lama supaya tidak ada perubahan tampilan. */
function optionLabel(formName: string, era: string | null, tierCode: string | null): string {
  const eraPart =
    era && era.trim().toLowerCase() !== formName.trim().toLowerCase() ? ` — ${era}` : '';
  return `${formName}${eraPart} (${tierCode ?? 'tanpa tier'})`;
}

/**
 * Form aktif milik satu karakter, urut `form_order`.
 *
 * `null` berarti karakternya tidak ada (atau sudah dihapus) — bukan "tidak punya
 * form". Route memakai beda itu untuk menjawab 404, bukan daftar kosong yang
 * membuat pengguna mengira karakternya ada tetapi kosong.
 */
export async function listPickerForms(
  sql: SqlClient,
  characterSlug: string,
): Promise<{ characterName: string; options: PickerFormOption[] } | null> {
  const rows = await sql.query<{
    character_name: string;
    form_slug: string;
    form_name: string;
    era: string | null;
    tier_code: string | null;
  }>(
    `select c.name as character_name,
            cv.slug as form_slug,
            cv.name as form_name,
            cv.era,
            t.tier_code
       from characters c
       join character_versions cv on cv.character_id = c.id
       left join tiers t on t.id = cv.tier_id
      where c.slug = $1
        and cv.deleted_at is null
      order by cv.form_order asc, cv.name asc`,
    [characterSlug],
  );

  const first = rows[0];
  if (!first) return null;

  return {
    characterName: first.character_name,
    options: rows.map((row) => ({
      value: `${characterSlug}/${row.form_slug}`,
      label: optionLabel(row.form_name, row.era, row.tier_code),
      tier_code: row.tier_code,
    })),
  };
}

/** Satu pilihan yang sudah diketahui labelnya — dipakai mengisi combobox awal. */
export interface PickerSelection {
  value: string;
  label: string;
}

/** Data awal halaman `/versus`: sumber, jumlah form, dan label dua sisi dari URL. */
export interface PickerBootstrap {
  source: 'database' | 'demo';
  totalForms: number;
  /** Hanya terisi pada jalur demo; jalur database tidak mengangkut katalog. */
  groups: DemoBattleOptionGroup[];
  initialA: PickerSelection | null;
  initialB: PickerSelection | null;
}

/** Cari label satu nilai `karakter/form` tanpa memuat katalog penuh. */
async function resolveSelection(
  sql: SqlClient,
  value: string,
): Promise<PickerSelection | null> {
  const parsed = parseBattleSelection(value);
  if (!parsed) return null;

  const forms = await listPickerForms(sql, parsed.characterSlug);
  const option = forms?.options.find((candidate) => candidate.value === value);
  return option ? { value: option.value, label: `${forms?.characterName} — ${option.label}` } : null;
}

/**
 * Data awal halaman `/versus`.
 *
 * Jalur database hanya mengembalikan **jumlah** form dan label dua sisi yang
 * diminta URL — bukan seluruh katalog. Combobox mengambil sisanya sendiri lewat
 * `/api/search/suggest` + `/api/characters/:slug/versions`, jadi HTML halaman
 * tidak lagi tumbuh mengikuti ukuran katalog.
 *
 * Jalur demo tetap mengirim seluruh grup karena datasetnya memang kecil dan
 * tidak ada database yang dapat ditanyai endpoint saran.
 */
export async function loadPickerBootstrap(
  requestedA: string,
  requestedB: string,
): Promise<PickerBootstrap> {
  if (demoEnabled() && !isDatabaseConfigured()) {
    const groups = demoBattleOptionGroups();
    const all = groups.flatMap((group) =>
      group.options.map((option) => ({
        value: option.value,
        label: `${group.label} — ${option.label}`,
      })),
    );
    const find = (value: string) => all.find((option) => option.value === value) ?? null;
    return {
      source: 'demo',
      totalForms: all.length,
      groups,
      initialA: find(requestedA),
      initialB: find(requestedB),
    };
  }

  const sql = getSqlClient();
  const [totalForms, initialA, initialB] = await Promise.all([
    countPickerForms(sql),
    requestedA === '' ? Promise.resolve(null) : resolveSelection(sql, requestedA),
    requestedB === '' ? Promise.resolve(null) : resolveSelection(sql, requestedB),
  ]);

  return { source: 'database', totalForms, groups: [], initialA, initialB };
}

/**
 * Jumlah form aktif di katalog.
 *
 * Halaman hanya perlu tahu apakah ada yang dapat dipertarungkan; menghitung
 * baris jauh lebih murah daripada mengangkut seluruh daftar.
 */
export async function countPickerForms(sql: SqlClient): Promise<number> {
  const rows = await sql.query<{ n: number | string }>(
    `select count(*)::int as n
       from character_versions cv
       join characters c on c.id = cv.character_id
      where cv.deleted_at is null`,
  );
  return Number(rows[0]?.n ?? 0);
}
