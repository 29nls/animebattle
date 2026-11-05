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
 * Rate limit: 30/menit/IP (PRD §24, AC-26) lewat tabel `rate_limit_windows` —
 * lihat `src/lib/security/distributed-rate-limit.ts` untuk alasan tidak memakai
 * Map in-process.
 */

import { parseBattleConditions } from '@/features/battle/conditions.ts';
import { defaultRuleSet } from '@/features/battle/rule-set.ts';
import { simulateFromSides, simulateFromVersions } from '@/features/battle/simulate.ts';
import { DatabaseNotConfiguredError, getSqlClient, isDatabaseUnavailable } from '@/lib/db/client.ts';
import { apiError } from '@/lib/errors.ts';
import { reportError } from '@/lib/observability/report-error.ts';
import { enforcePublicRateLimit } from '@/lib/security/distributed-rate-limit.ts';
import type { BattleInput } from '@/services/battle/types.ts';

export const dynamic = 'force-dynamic';

/** Kuota PRD §24: 30/menit/IP, dihitung terpisah dari pencarian. */
const RATE_LIMIT = { scope: 'battle-simulate', limit: 30, windowMs: 60_000 } as const;

// Rule set default dan normalisasi kondisi dipindah ke `src/features/battle/`
// karena dipakai juga oleh halaman `/versus/result`. Route ini tinggal memakai
// modul yang sama — bobot dan default tidak dapat berbeda antara API dan halaman.
// Invarian daftar enum tetap dijaga `scripts/check-architecture.mjs`
// (sekarang membaca `src/features/battle/conditions.ts`).

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('INVALID_INPUT', 'Body harus berupa JSON.', 400);
  }

  const payload = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const conditions = parseBattleConditions(payload.conditions);

  const previewAllowed =
    process.env.NODE_ENV !== 'production' && process.env.ALLOW_BATTLE_PREVIEW === '1';

  // Jalur pratinjau: klien memasok datanya sendiri.
  if (payload.sides !== undefined) {
    if (!previewAllowed) {
      return apiError(
        'FORBIDDEN',
        'Jalur pratinjau tidak aktif. Kirim side_a_version_id/side_b_version_id, atau set ALLOW_BATTLE_PREVIEW=1 pada lingkungan non-produksi.',
        403,
      );
    }

    const sides = payload.sides as BattleInput;
    try {
      return Response.json(simulateFromSides({ ...sides, conditions }, defaultRuleSet()));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return apiError('INVALID_INPUT', message, 400);
    }
  }

  // Jalur produksi: hanya id, data diambil server.
  const a = payload.side_a_version_id;
  const b = payload.side_b_version_id;
  if (typeof a !== 'string' || typeof b !== 'string') {
    return apiError('INVALID_INPUT', 'Butuh side_a_version_id dan side_b_version_id (string UUID).', 400);
  }

  // Kuota diperiksa setelah bentuk body sah: permintaan cacat tidak boleh
  // menghabiskan jatah pengguna yang mengirim body benar.
  const limited = await enforcePublicRateLimit(request.headers, RATE_LIMIT);
  if (limited) return limited;

  // Divalidasi SEBELUM menyentuh database. Sebelumnya pemeriksaan ini ada di
  // dalam `simulateFromVersions`, tetapi klien database sudah diambil lebih dulu
  // oleh pemanggil — sehingga request yang jelas salah dijawab 503 "database
  // belum dikonfigurasi", dan pesan itu menyalahkan konfigurasi server atas
  // kesalahan pemanggil.
  if (a === b) {
    return apiError(
      'INVALID_INPUT',
      'Kedua sisi memakai form yang sama. Pertarungan karakter dengan dirinya sendiri tidak menghasilkan analisis apa pun.',
      400,
    );
  }

  try {
    const result = await simulateFromVersions(getSqlClient(), {
      side_a_version_id: a,
      side_b_version_id: b,
      conditions,
      rule_set: defaultRuleSet(),
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Konfigurasi yang hilang: pesannya operasional dan berguna bagi operator.
    if (error instanceof DatabaseNotConfiguredError) {
      return apiError('UNAVAILABLE', message, 503);
    }
    // Konektivitas: 503 + pesan generik (detail driver tidak untuk pemanggil anonim).
    if (isDatabaseUnavailable(error)) {
      await reportError(error, {
        event: 'api.battle_simulate.database_unavailable',
        route: '/api/battle/simulate',
      });
      return apiError('UNAVAILABLE', 'Database tidak dapat dihubungi saat ini.', 503);
    }
    return apiError('INVALID_INPUT', message, 400);
  }
}
