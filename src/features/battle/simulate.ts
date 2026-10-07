/**
 * Penghubung antara data dan engine.
 *
 * Pembagian tanggung jawabnya sengaja tajam: engine tidak tahu apa pun tentang
 * database (dialah yang membuat hasilnya deterministik dan dapat diuji tanpa I/O),
 * dan modul ini tidak tahu apa pun tentang cara menghitung pemenang. Semua
 * keputusan pertarungan ada di `services/battle/*`; yang dilakukan di sini hanya
 * mengambil data dalam satu round-trip, memvalidasi bentuk input, lalu memanggil
 * `runBattle`.
 *
 * Kenapa satu round-trip: `battle_dataset` mengembalikan statistik, abilities,
 * resistances, dan metrik turunan untuk **dua** form sekaligus. Mengambilnya
 * per-bagian akan menghasilkan belasan query per simulasi — bentuk N+1 yang
 * persis dilarang PRD §29 dan §37.
 */

import type { SqlClient } from '../../lib/db/client.ts';
import { runBattle } from '../../services/battle/index.ts';
import type {
  BattleConditions,
  BattleInput,
  BattleResult,
  RuleSet,
  SideData,
} from '../../services/battle/types.ts';

/**
 * Bentuk baris `battle_dataset`.
 *
 * Tipe-nya adalah `SideData` itu sendiri, bukan salinan sejenis: fungsi RPC di
 * `docs/schema.sql` memang membangun jsonb dengan kunci yang persis sama
 * (`character`, `verse`, `form`, `tier`, `metrics`, `statistics`, `abilities`,
 * `resistances`, `traits`). Mendefinisikan tipe kembar di sini akan membuat dua
 * tempat yang wajib diperbarui bersamaan — dan itu jenis duplikasi yang diam-diam
 * berbeda setelah satu kali perubahan.
 * Kesamaan keduanya diverifikasi `scripts/validate-db-access.mjs`.
 */
export type BattleDatasetRow = SideData;

export class BattleInputError extends Error {
  override readonly name = 'BattleInputError';
}

/**
 * Simulasi dari dua `character_version_id` — jalur produksi.
 *
 * Form (bukan karakter) yang dipilih: PRD §11 menuntut engine hanya menerima
 * `character_version_id`, karena "Goku" tanpa era adalah pertanyaan yang tidak
 * punya jawaban tunggal.
 */
export async function simulateFromVersions(
  sql: SqlClient,
  params: {
    side_a_version_id: string;
    side_b_version_id: string;
    conditions: BattleConditions;
    rule_set: RuleSet;
  },
): Promise<BattleResult> {
  if (params.side_a_version_id === params.side_b_version_id) {
    throw new BattleInputError(
      'Kedua sisi memakai form yang sama. Pertarungan karakter dengan dirinya sendiri tidak menghasilkan analisis apa pun.',
    );
  }

  const rows = await sql.query<BattleDatasetRow>(
    `select * from public.battle_dataset(array[$1, $2]::uuid[])`,
    [params.side_a_version_id, params.side_b_version_id],
  );

  const [sideA, sideB] = rows;
  if (!sideA || !sideB) {
    throw new BattleInputError(
      'Salah satu form tidak ditemukan atau sudah dihapus. Dataset harus berisi dua sisi.',
    );
  }

  return runBattle({ side_a: sideA, side_b: sideB, conditions: params.conditions }, params.rule_set);
}

/**
 * Simulasi dari data yang sudah tersedia di memori.
 *
 * Dipakai oleh case library dan oleh endpoint pratinjau non-produksi, supaya
 * jalur request → engine dapat diuji tanpa database. Tidak dipakai untuk
 * melayani pertarungan karakter publik: data harus datang dari `battle_dataset`
 * agar setiap fakta tetap dapat ditelusuri ke sumbernya.
 */
export function simulateFromSides(input: BattleInput, ruleSet: RuleSet): BattleResult {
  return runBattle(input, ruleSet);
}
