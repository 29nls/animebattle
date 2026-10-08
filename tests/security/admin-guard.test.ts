/**
 * Unit test guard keamanan rute admin (AC-26, PRD §28).
 *
 * Kontrak yang dikunci:
 *  1. Guard **fail-closed**: tanpa konfigurasi → semua permintaan ditolak 503.
 *  2. Secret salah/kosong → 401; secret benar → lolos dengan principal.
 *  3. Perbandingan secret tahan timing attack (timingSafeEqual, bukan `===`).
 *  4. Rate limiter: jendela tetap, menolak 429 pada permintaan ke-N+1,
 *     pemisahan kunci per-principal, reset pada jendela berikutnya.
 *  5. Limiter murni: waktu disuntikkan (injectable clock), tanpa Date.now internal.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { adminGuard, secretsMatch, AdminGuardConfigError } from '../../src/lib/security/admin-guard.ts';
import { FixedWindowRateLimiter } from '../../src/lib/security/rate-limiter.ts';

const ENV_KEY = 'ADMIN_INGESTION_SECRET';

/** Susun header request seperti route akan melakukannya. */
function requestWith(header: Record<string, string>): { headers: { get(name: string): string | null } } {
  return { headers: { get: (name) => header[name.toLowerCase()] ?? null } };
}

describe('adminGuard — fail-closed', () => {
  it('menolak 503 bila secret belum dikonfigurasi (tidak ada fallback terbuka)', () => {
    const env = { [ENV_KEY]: '' };
    const result = adminGuard(requestWith({ authorization: 'Bearer apa pun' }), env, ENV_KEY);
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
  });

  it('melempar AdminGuardConfigError bila dipanggil tanpa nama env (kesalahan pemanggil, bukan request)', () => {
    assert.throws(() => adminGuard(requestWith({}), {}, ''), AdminGuardConfigError);
  });
});

describe('adminGuard — autentikasi', () => {
  const env = { [ENV_KEY]: 'r4hasia-admin' };

  it('menolak 401 tanpa header Authorization', () => {
    const result = adminGuard(requestWith({}), env, ENV_KEY);
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  });

  it('menolak 401 dengan skema selain Bearer', () => {
    const result = adminGuard(requestWith({ authorization: 'Basic r4hasia-admin' }), env, ENV_KEY);
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  });

  it('menolak 401 dengan secret salah', () => {
    const result = adminGuard(requestWith({ authorization: 'Bearer salah' }), env, ENV_KEY);
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  });

  it('menerima secret benar dan mengembalikan principal', () => {
    const result = adminGuard(requestWith({ authorization: 'Bearer r4hasia-admin' }), env, ENV_KEY);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.principal, 'bearer-admin');
  });

  it('memakai timingSafeEqual, bukan perbandingan string biasa', () => {
    const source = secretsMatch.toString();
    assert.ok(source.includes('timingSafeEqual'), 'pembanding wajib memakai timingSafeEqual');
    assert.ok(!/\bprovided\s*===\s*configured\b/.test(source), 'perbandingan `===` langsung dilarang');
  });

  it('secretsMatch benar secara perilaku (cocok/mismatch/kosong)', () => {
    assert.equal(secretsMatch('rahasia', 'rahasia'), true);
    assert.equal(secretsMatch('rahasia', 'salah'), false);
    assert.equal(secretsMatch('', 'rahasia'), false);
    assert.equal(secretsMatch('rahasia', ''), false);
  });

  it('menerima X-Forwarded-For sebagai identitas untuk limiter', () => {
    const env2 = { [ENV_KEY]: 'tok' };
    const result = adminGuard(
      requestWith({ authorization: 'Bearer tok', 'x-forwarded-for': '203.0.113.9' }),
      env2,
      ENV_KEY,
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.identity, '203.0.113.9');
  });
});

describe('FixedWindowRateLimiter', () => {
  const WINDOW_MS = 60_000;
  const LIMIT = 5;

  function limiterAt(startMs: number) {
    let now = startMs;
    return {
      limiter: new FixedWindowRateLimiter(LIMIT, WINDOW_MS, () => now),
      tick: (ms: number) => {
        now += ms;
      },
    };
  }

  it('mengizinkan sampai batas, lalu menolak 429 dengan retry_after_ms', () => {
    const { limiter } = limiterAt(1_000);
    for (let i = 0; i < LIMIT; i += 1) {
      const r = limiter.check('klien-1');
      assert.equal(r.allowed, true, `permintaan ke-${i + 1} harus lolos`);
    }
    const blocked = limiter.check('klien-1');
    assert.equal(blocked.allowed, false);
    if (!blocked.allowed) {
      assert.ok(blocked.retryAfterMs > 0 && blocked.retryAfterMs <= WINDOW_MS);
    }
  });

  it('memisahkan kunci: kunci lain tidak terganggu blok', () => {
    const { limiter } = limiterAt(1_000);
    for (let i = 0; i < LIMIT; i += 1) limiter.check('klien-1');
    assert.equal(limiter.check('klien-1').allowed, false);
    assert.equal(limiter.check('klien-2').allowed, true);
  });

  it('reset pada jendela berikutnya (jendela tetap, bukan sliding)', () => {
    const { limiter, tick } = limiterAt(1_000);
    for (let i = 0; i < LIMIT; i += 1) limiter.check('klien-1');
    assert.equal(limiter.check('klien-1').allowed, false);
    tick(WINDOW_MS + 1);
    assert.equal(limiter.check('klien-1').allowed, true);
  });

  it('murni terhadap waktu sistem: jam disuntikkan, tanpa Date.now internal', () => {
    const source = FixedWindowRateLimiter.toString();
    assert.ok(!source.includes('Date.now'), 'limiter wajib menerima jam dari luar');
    const { limiter } = limiterAt(5_000);
    assert.equal(limiter.check('x').allowed, true);
  });
});
