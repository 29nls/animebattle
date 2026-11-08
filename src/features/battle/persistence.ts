/**
 * Cache hasil battle di PostgreSQL.
 *
 * Kenapa ada: `battle_results.input_hash` sudah unik sejak skema pertama, dan
 * `battle_cache_get()` sudah tersedia — tetapi tidak ada satu pun kode aplikasi
 * yang menulis atau membacanya. Akibatnya setiap kunjungan ke halaman hasil
 * menghitung ulang pertarungan yang sama, dan "Popular Battles" tidak pernah
 * terisi karena `mv_battle_popularity` dihitung dari `battles`/`battle_results`.
 *
 * Aturan yang dijaga modul ini:
 *
 * 1. **Baca dulu, hitung kemudian.** `readCachedBattle()` dipanggil sebelum
 *    engine; hasil yang masih dalam `cached_until` dipakai apa adanya.
 * 2. **Idempoten.** Dua permintaan bersamaan untuk pertarungan yang sama tidak
 *    boleh gagal: setiap insert memakai `on conflict do nothing`, lalu baris
 *    yang sudah ada dibaca kembali. `battle_results.input_hash` yang unik adalah
 *    kuncinya, bukan id yang dibuat aplikasi.
 * 3. **Tidak mengarang nilai.** Kolom-kolom `battle_results` tidak memuat
 *    seluruh keluaran engine (`weighted_score`, `dominance`, `coverage`,
 *    `ability_outcomes`, `disclaimer`). Merekonstruksi `BattleResult` dari kolom
 *    akan mengisi bidang itu dengan nol/kosong — angka palsu yang tampil di
 *    halaman. Karena itu keluaran utuh disimpan di `battle_results.result_payload`
 *    (migrasi 0005) dan dibaca kembali apa adanya.
 *
 * Modul ini hanya berbicara SQL — tidak tahu cara menghitung pemenang dan tidak
 * tahu apa itu halaman. Itu membuatnya dapat diuji dengan PGlite.
 */

import type { SqlClient } from '../../lib/db/client.ts';
import { hashValue } from '../../services/battle/stable-json.ts';
import type {
  BattleConditions,
  BattleResult,
  RuleSet,
} from '../../services/battle/types.ts';

/** Umur cache hasil battle — sama dengan default `cached_until` di skema Postgres. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Hasil cache beserta id barisnya. */
export interface CachedBattle {
  result: BattleResult;
  rowId: string;
  battleId: string;
}

/**
 * Baca hasil yang masih berlaku untuk `inputHash`.
 *
 * Memakai RPC `battle_cache_get` yang sudah ada (bukan query baru): definisi
 * "masih berlaku" (`cached_until > now()`) tinggal di satu tempat, dan grant-nya
 * sudah diatur skema.
 *
 * Baris lama tanpa `result_payload` diperlakukan sebagai cache miss: engine
 * menghitung ulang dan menulis payload, sehingga tidak ada halaman yang
 * menampilkan angka hasil rekonstruksi.
 */
export async function readCachedBattle(
  sql: SqlClient,
  inputHash: string,
): Promise<CachedBattle | null> {
  // SQLite tidak punya RPC, jadi definisi "masih berlaku" ditulis langsung.
  // Perbandingan teks sah karena `cached_until` selalu ISO 8601 UTC — bentuk
  // yang urutannya sama dengan urutan waktu.
  const rows =
    sql.dialect === 'sqlite'
      ? await sql.query<{ id: string; battle_id: string; result_payload: BattleResult | null }>(
          `select id, battle_id, result_payload
             from battle_results
            where input_hash = $1
              and cached_until > strftime('%Y-%m-%dT%H:%M:%fZ','now')
            limit 1`,
          [inputHash],
        )
      : await sql.query<{ id: string; battle_id: string; result_payload: BattleResult | null }>(
          `select id, battle_id, result_payload
             from battle_cache_get($1)`,
          [inputHash],
        );

  const row = rows[0];
  if (!row || row.result_payload === null) return null;
  return { result: row.result_payload, rowId: row.id, battleId: row.battle_id };
}

/**
 * Kunci baris `battle_conditions`.
 *
 * Isinya hanya kondisi pertarungan — bukan rule set. Dua rule set berbeda untuk
 * kondisi yang sama tetap berbagi satu baris kondisi; yang membedakan hasilnya
 * adalah `input_hash` (yang sudah memuat versi rule set).
 */
export function conditionsHash(conditions: BattleConditions): string {
  return hashValue(conditions);
}

/** `battle_rule_sets.id` untuk versi tertentu; `null` bila versi itu tidak ada. */
async function ruleSetId(sql: SqlClient, version: string): Promise<string | null> {
  const rows = await sql.query<{ id: string }>(
    `select id from battle_rule_sets where version = $1`,
    [version],
  );
  return rows[0]?.id ?? null;
}

/**
 * Pastikan baris kondisi ada, lalu kembalikan id-nya.
 *
 * `on conflict (conditions_hash) do update` dipakai supaya `returning id` selalu
 * menghasilkan baris — `do nothing` akan mengembalikan nol baris saat kondisi
 * sudah ada, dan itu justru kasus yang paling sering.
 */
async function ensureConditions(sql: SqlClient, conditions: BattleConditions): Promise<string> {
  const rows = await sql.query<{ id: string }>(
    `insert into battle_conditions
       (mode, speed_equalized, battlefield, knowledge_level, prep_time, win_condition, conditions_hash)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (conditions_hash) do update set conditions_hash = excluded.conditions_hash
     returning id`,
    [
      conditions.mode,
      conditions.speed_equalized,
      conditions.battlefield,
      conditions.knowledge_level,
      conditions.prep_time,
      conditions.win_condition,
      conditionsHash(conditions),
    ],
  );
  return rows[0].id;
}

export interface SaveBattleParams {
  /** Slug kanonik matchup (`a/form-vs-b/form`) — juga `matchup_key` MV popularitas. */
  slug: string;
  sideAVersionId: string;
  sideBVersionId: string;
  conditions: BattleConditions;
  ruleSet: RuleSet;
  result: BattleResult;
}

/** Hasil penyimpanan: id baris dan `battle_id`, baik baris baru maupun lama. */
export interface SavedBattle {
  rowId: string;
  battleId: string;
  inserted: boolean;
}

/**
 * Simpan hasil secara idempoten.
 *
 * Tiga langkah, semuanya `on conflict`:
 * 1. `battle_conditions` — unik pada `conditions_hash`.
 * 2. `battles` — unik pada `(side_a_version_id, side_b_version_id, conditions_id)`.
 * 3. `battle_results` — unik pada `input_hash`.
 *
 * Langkah 3 yang menentukan: bila dua request bersamaan menghitung hash yang
 * sama, yang kalah balapan mendapat `inserted: false` dan membaca baris pemenang.
 * Tidak ada galat yang dilempar ke pengguna, dan tidak ada hasil ganda.
 *
 * Mengembalikan `null` bila rule set versi ini tidak ada di database: hasil itu
 * tidak dapat dirujuk balik ke aturan yang menghasilkannya (AC-34), jadi lebih
 * baik tidak disimpan daripada menyimpan baris yang tidak dapat diaudit.
 */
export async function saveBattle(
  sql: SqlClient,
  params: SaveBattleParams,
): Promise<SavedBattle | null> {
  const ruleSetRowId = await ruleSetId(sql, params.ruleSet.version);
  if (ruleSetRowId === null) return null;

  const conditionsId = await ensureConditions(sql, params.conditions);

  const battleRows = await sql.query<{ id: string }>(
    `insert into battles (slug, side_a_version_id, side_b_version_id, conditions_id)
     values ($1, $2, $3, $4)
     on conflict (side_a_version_id, side_b_version_id, conditions_id)
       do update set slug = excluded.slug
     returning id`,
    [params.slug, params.sideAVersionId, params.sideBVersionId, conditionsId],
  );
  const battleId = battleRows[0].id;

  const { result } = params;
  const rows = await sql.query<{ id: string }>(
    `insert into battle_results
       (battle_id, winner, win_probability_a, win_probability_b, confidence,
        difficulty, battle_length, score_breakdown, decisive_edges,
        primary_reason, secondary_factors, critical_counter, potential_scenario,
        limitations, assumptions, reasoning_refs, input_hash,
        engine_version, rule_set_version, rule_set_id, result_payload, cached_until)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb,
             $10, $11::jsonb, $12, $13, $14::jsonb, $15::jsonb, $16::jsonb, $17,
             $18, $19, $20, $21::jsonb, $22)
     on conflict (input_hash) do nothing
     returning id`,
    [
      battleId,
      result.winner,
      result.win_probability.a,
      result.win_probability.b,
      result.confidence,
      result.difficulty,
      result.battle_length,
      JSON.stringify(result.score_breakdown),
      JSON.stringify(result.decisive_edges),
      result.primary_reason,
      JSON.stringify(result.secondary_factors),
      result.critical_counter,
      result.potential_scenario,
      JSON.stringify(result.limitations),
      JSON.stringify(result.assumptions),
      JSON.stringify({
        primary: result.reasoning.primary,
        secondary: result.reasoning.secondary,
        critical_counter: result.reasoning.critical_counter,
        scenario: result.reasoning.scenario,
      }),
      result.input_hash,
      result.engine_version,
      result.rule_set_version,
      ruleSetRowId,
      JSON.stringify(result),
      // Ditulis eksplisit: default `now() + interval '7 days'` milik Postgres
      // tidak ada di D1, dan nilai ini juga yang dibandingkan `readCachedBattle`.
      new Date(Date.now() + CACHE_TTL_MS).toISOString(),
    ],
  );

  if (rows[0]) {
    return { rowId: rows[0].id, battleId, inserted: true };
  }

  // Kalah balapan: baris sudah ditulis permintaan lain. Baca id-nya, jangan
  // menganggap ini kegagalan.
  const existing = await sql.query<{ id: string; battle_id: string }>(
    `select id, battle_id from battle_results where input_hash = $1`,
    [result.input_hash],
  );
  const row = existing[0];
  if (!row) return null;
  return { rowId: row.id, battleId: row.battle_id, inserted: false };
}
