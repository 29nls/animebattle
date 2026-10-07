/**
 * `POST /api/battle/simulate`
 *
 * Dua jalur, dan perbedaannya penting:
 *
 * 1. **Produksi** — body berisi `side_a_version_id` + `side_b_version_id`. Server
 *    yang mengambil statistiknya lewat RPC `battle_dataset`. Klien tidak pernah
 *    mengirim angka, sehingga hasil tidak dapat dipalsukan dengan mengarang
 *    statistik (PRD §36: user tidak boleh mengendalikan query maupun data).
 * 2. **Pratinjau** — body berisi `sides` secara langsung. Hanya aktif bila
 *    `NODE_ENV !== 'production'` **dan** `ALLOW_BATTLE_PREVIEW=1`. Dipakai untuk
 *    menguji jalur request → engine tanpa database. Dua gerbang, bukan satu,
 *    supaya staging yang keliru menyetel satu variabel pun tidak membuka jalur
 *    ini untuk publik.
 *
 * Rate limit (AC-26) belum dipasang; lihat catatan di Sprint 4.
 */

import { simulateFromSides, simulateFromVersions } from '@/features/battle/simulate.ts';
import { getSqlClient } from '@/lib/db/client.ts';
import { validateRuleSet } from '@/services/battle/index.ts';
import type {
  BattleConditions,
  BattleInput,
  RuleSet,
} from '@/services/battle/types.ts';
import ruleSetFixture from '@/services/battle/fixtures/rule-set.default.json';

export const dynamic = 'force-dynamic';

/**
 * Rule set default dari berkas seed.
 *
 * Sementara: produksi harus memuat `battle_rule_sets` versi aktif dari database
 * (PRD §16, BC-4) agar mengubah bobot tidak menuntut deploy. Nilai fixture
 * diverifikasi dengan validator engine **saat modul dimuat**, sehingga berkas
 * yang rusak gagal cepat alih-alih menghasilkan hasil yang tampak wajar.
 */
const DEFAULT_RULE_SET: RuleSet = (() => {
  const candidate = ruleSetFixture as unknown as RuleSet;
  const problems = validateRuleSet(candidate);
  if (problems.length > 0) {
    throw new Error(`Rule set default tidak sah: ${problems.join('; ')}`);
  }
  return candidate;
})();

// Daftar ini cermin dari tipe `BattleMode` di engine. Kalau engine menambah mode
// baru dan daftar ini tidak diperbarui, mode itu diam-diam jatuh ke default —
// karena itu daftarnya dijaga uji di scripts/check-architecture.mjs.
const MODES = ['standard', 'equal_speed', 'in_character', 'bloodlusted', 'random_encounter'] as const;
const BATTLEFIELDS = ['neutral', 'open', 'enclosed', 'urban', 'void'] as const;
const KNOWLEDGE = ['none', 'partial', 'full'] as const;
const PREP = ['none', 'short', 'extended'] as const;
const WIN_CONDITIONS = ['ko', 'death', 'incapacitation', 'bfr', 'submission', 'any'] as const;

function pick<T extends readonly string[]>(
  allowed: T,
  value: unknown,
  fallback: T[number],
): T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : fallback;
}

/**
 * Kondisi pertarungan dibangun **di sini**, bukan diteruskan apa adanya dari
 * body: field tak dikenal tidak pernah sampai ke engine, dan nilai yang tidak
 * sah jatuh ke default yang terdokumentasi (PRD §16.2).
 */
export function parseConditions(raw: unknown): BattleConditions {
  const input = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const distance = input.starting_distance_rank;

  return {
    mode: pick(MODES, input.mode, 'standard'),
    speed_equalized: input.speed_equalized === true,
    starting_distance_rank:
      typeof distance === 'number' && Number.isFinite(distance) ? Math.trunc(distance) : null,
    battlefield: pick(BATTLEFIELDS, input.battlefield, 'neutral'),
    knowledge_level: pick(KNOWLEDGE, input.knowledge_level, 'partial'),
    prep_time: pick(PREP, input.prep_time, 'none'),
    win_condition: pick(WIN_CONDITIONS, input.win_condition, 'incapacitation'),
  };
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body harus berupa JSON.' }, { status: 400 });
  }

  const payload = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const conditions = parseConditions(payload.conditions);

  const previewAllowed =
    process.env.NODE_ENV !== 'production' && process.env.ALLOW_BATTLE_PREVIEW === '1';

  // Jalur pratinjau: klien memasok datanya sendiri.
  if (payload.sides !== undefined) {
    if (!previewAllowed) {
      return Response.json(
        {
          error:
            'Jalur pratinjau tidak aktif. Kirim side_a_version_id/side_b_version_id, atau set ALLOW_BATTLE_PREVIEW=1 pada lingkungan non-produksi.',
        },
        { status: 403 },
      );
    }

    const sides = payload.sides as BattleInput;
    try {
      return Response.json(simulateFromSides({ ...sides, conditions }, DEFAULT_RULE_SET));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Response.json({ error: message }, { status: 400 });
    }
  }

  // Jalur produksi: hanya id, data diambil server.
  const a = payload.side_a_version_id;
  const b = payload.side_b_version_id;
  if (typeof a !== 'string' || typeof b !== 'string') {
    return Response.json(
      { error: 'Butuh side_a_version_id dan side_b_version_id (string UUID).' },
      { status: 400 },
    );
  }

  // Divalidasi SEBELUM menyentuh database. Sebelumnya pemeriksaan ini ada di
  // dalam `simulateFromVersions`, tetapi klien database sudah diambil lebih dulu
  // oleh pemanggil — sehingga request yang jelas salah dijawab 503 "database
  // belum dikonfigurasi", dan pesan itu menyalahkan konfigurasi server atas
  // kesalahan pemanggil.
  if (a === b) {
    return Response.json(
      {
        error:
          'Kedua sisi memakai form yang sama. Pertarungan karakter dengan dirinya sendiri tidak menghasilkan analisis apa pun.',
      },
      { status: 400 },
    );
  }

  try {
    const result = await simulateFromVersions(getSqlClient(), {
      side_a_version_id: a,
      side_b_version_id: b,
      conditions,
      rule_set: DEFAULT_RULE_SET,
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('Database belum dikonfigurasi') ? 503 : 400;
    return Response.json({ error: message }, { status });
  }
}
