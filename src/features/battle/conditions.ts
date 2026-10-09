/**
 * Normalisasi kondisi pertarungan dari input yang tidak dipercaya.
 *
 * Satu-satunya tempat daftar enum kondisi hidup. Sebelumnya daftar ini berada di
 * `app/api/battle/simulate/route.ts`; ia dipindah ke sini ketika halaman
 * `/versus/result` juga perlu membangun kondisi dari query string. Alasannya
 * sederhana: dua salinan daftar akan berbeda pendapat cepat atau lambat, dan
 * bedanya halus — mode tak dikenal yang diam-diam jatuh ke default.
 *
 * Invarian tetap ditegakkan tooling: `scripts/check-architecture.mjs` membandingkan
 * setiap daftar di berkas ini dengan tipe padanannya di `services/battle/types.ts`
 * (invarian "daftar enum route = tipe engine").
 *
 * Prinsipnya sama seperti sebelumnya: field tak dikenal tidak pernah sampai ke
 * engine, dan nilai tak sah jatuh ke default yang terdokumentasi (PRD §16.2).
 */

import type { BattleConditions } from '../../services/battle/types.ts';

// Daftar ini cermin dari tipe engine. Kalau engine menambah nilai baru dan daftar
// ini tidak diperbarui, nilai itu diam-diam jatuh ke default — karena itu
// daftarnya dijaga `scripts/check-architecture.mjs`.
export const MODES = ['standard', 'equal_speed', 'in_character', 'bloodlusted', 'random_encounter'] as const;
export const BATTLEFIELDS = ['neutral', 'open', 'enclosed', 'urban', 'void'] as const;
export const KNOWLEDGE = ['none', 'partial', 'full'] as const;
export const PREP = ['none', 'short', 'extended'] as const;
export const WIN_CONDITIONS = ['ko', 'death', 'incapacitation', 'bfr', 'submission', 'any'] as const;

function pick<T extends readonly string[]>(
  allowed: T,
  value: unknown,
  fallback: T[number],
): T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : fallback;
}

/** Bentuk kanonik: nama field sama dengan `BattleConditions` (dan `battle_dataset`). */
export function parseBattleConditions(raw: unknown): BattleConditions {
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

/**
 * Bentuk query string halaman `/versus` memakai nama pendek (`knowledge`, `prep`)
 * karena itu yang muncul di URL. Pemetaannya dikumpulkan di satu tempat supaya
 * nama pendek dan nama kanonik tidak pernah tertukar tanpa disadari.
 */
export function parseBattleConditionsFromQuery(
  params: Readonly<Record<string, string | string[] | undefined>>,
): BattleConditions {
  const single = (value: string | string[] | undefined): unknown =>
    Array.isArray(value) ? value[0] : value;

  return parseBattleConditions({
    mode: single(params.mode),
    speed_equalized: single(params.speed_equalized) === '1' || single(params.speed_equalized) === 'on',
    battlefield: single(params.battlefield),
    knowledge_level: single(params.knowledge),
    prep_time: single(params.prep),
    win_condition: single(params.win_condition),
  });
}
