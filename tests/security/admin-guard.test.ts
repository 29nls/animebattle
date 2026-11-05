/**
 * Unit test otorisasi admin Supabase (AC-26, PRD §28).
 *
 * Kontrak yang dikunci:
 *  1. Fail-closed: konfigurasi Auth hilang → 503.
 *  2. Sesi tidak ada/kedaluwarsa → 401.
 *  3. Peran viewer < editor < admin/owner; curator legacy = editor.
 *  4. Admin/owner wajib AAL2; AAL1 → 403 mfa_required.
 *  5. Provider dapat disuntik sehingga handler tidak memerlukan Supabase nyata.
 *  6. Rate limiter tetap murni dan memisahkan kunci per user.
 *  7. Perbandingan CRON_SECRET tetap timing-safe.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateAdminAccess,
  getAdminAuth,
  isAdminAuthConfigured,
  normalizeRoles,
  setAdminAuthProviderForTests,
  type AdminAuthSnapshot,
} from '../../src/features/admin/auth.ts';
import { FixedWindowRateLimiter } from '../../src/lib/security/rate-limiter.ts';
import { secretsMatch } from '../../src/lib/security/secrets.ts';

function snapshot(overrides: Partial<AdminAuthSnapshot> = {}): AdminAuthSnapshot {
  return {
    configured: true,
    user: { id: 'user-uji', email: 'admin@example.test', displayName: 'Admin Uji' },
    roles: ['admin'],
    aal: 'aal2',
    expiresAt: 2_000_000_000,
    now: 1_700_000_000_000,
    ...overrides,
  };
}

describe('evaluateAdminAccess — fail-closed & sesi', () => {
  it('503 bila Supabase Auth belum dikonfigurasi, bahkan dengan user palsu', () => {
    const result = evaluateAdminAccess(snapshot({ configured: false }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 503);
      assert.equal(result.code, 'UNAVAILABLE');
      assert.equal(result.reason, 'not_configured');
    }
  });

  it('401 bila tidak ada sesi', () => {
    const result = evaluateAdminAccess(snapshot({ user: null, roles: [] }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 401);
      assert.equal(result.reason, 'unauthenticated');
    }
  });

  it('401 bila sesi kedaluwarsa (detik Unix)', () => {
    const result = evaluateAdminAccess(
      snapshot({ expiresAt: 1_700_000_000, now: 1_700_000_001_000 }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 401);
      assert.equal(result.reason, 'session_expired');
    }
  });

  it('menerima sesi yang belum kedaluwarsa', () => {
    const result = evaluateAdminAccess(
      snapshot({ expiresAt: 1_700_000_100, now: 1_700_000_000_000 }),
    );
    assert.equal(result.ok, true);
  });
});

describe('evaluateAdminAccess — eskalasi peran', () => {
  it('viewer boleh baca, tetapi tidak boleh aksi editor', () => {
    const viewer = snapshot({ roles: ['viewer'], aal: 'aal1' });
    assert.equal(evaluateAdminAccess(viewer, 'viewer').ok, true);
    const escalated = evaluateAdminAccess(viewer, 'editor');
    assert.equal(escalated.ok, false);
    if (!escalated.ok) assert.equal(escalated.reason, 'forbidden');
  });

  it('editor boleh aksi editor, tetapi tidak boleh aksi admin', () => {
    const editor = snapshot({ roles: ['editor'], aal: 'aal1' });
    assert.equal(evaluateAdminAccess(editor, 'editor').ok, true);
    const escalated = evaluateAdminAccess(editor, 'admin');
    assert.equal(escalated.ok, false);
    if (!escalated.ok) assert.equal(escalated.reason, 'forbidden');
  });

  it('curator legacy diperlakukan sebagai editor', () => {
    const result = evaluateAdminAccess(snapshot({ roles: ['curator'], aal: 'aal1' }), 'editor');
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.identity.effectiveRole, 'editor');
  });

  it('owner adalah admin', () => {
    const result = evaluateAdminAccess(snapshot({ roles: ['owner'] }), 'admin');
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.identity.effectiveRole, 'admin');
  });

  it('peran tak dikenal/duplikat dinormalisasi; tanpa peran → 403', () => {
    assert.deepEqual(normalizeRoles(['viewer', 'viewer', 'hacker']), ['viewer']);
    const result = evaluateAdminAccess(snapshot({ roles: ['hacker'] }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'forbidden');
  });
});

describe('evaluateAdminAccess — MFA admin', () => {
  it('admin AAL1 ditolak 403 mfa_required, bahkan untuk baca', () => {
    const result = evaluateAdminAccess(snapshot({ roles: ['admin'], aal: 'aal1' }), 'viewer');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
      assert.equal(result.reason, 'mfa_required');
    }
  });

  it('admin AAL2 diterima', () => {
    const result = evaluateAdminAccess(snapshot({ roles: ['admin'], aal: 'aal2' }), 'admin');
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.identity.aal, 'aal2');
  });

  it('editor tidak wajib MFA', () => {
    const result = evaluateAdminAccess(snapshot({ roles: ['editor'], aal: 'aal1' }), 'editor');
    assert.equal(result.ok, true);
  });
});

describe('getAdminAuth — provider injection', () => {
  it('memakai snapshot yang disuntik tanpa env Supabase', async () => {
    setAdminAuthProviderForTests(async () => snapshot({ roles: ['viewer'], aal: 'aal1' }));
    try {
      const result = await getAdminAuth('viewer');
      assert.equal(result.ok, true);
    } finally {
      setAdminAuthProviderForTests(null);
    }
  });

  it('fail-closed tanpa provider dan tanpa konfigurasi', async () => {
    setAdminAuthProviderForTests(null);
    const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    try {
      const result = await getAdminAuth();
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.status, 503);
    } finally {
      if (previousUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
      if (previousKey !== undefined) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey;
    }
  });

  it('isAdminAuthConfigured mengharuskan URL dan anon key', () => {
    assert.equal(isAdminAuthConfigured({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.test' }), false);
    assert.equal(
      isAdminAuthConfigured({
        NEXT_PUBLIC_SUPABASE_URL: 'https://x.test',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      }),
      true,
    );
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

  it('mengizinkan sampai batas, lalu menolak dengan retry_after_ms', () => {
    const { limiter } = limiterAt(1_000);
    for (let i = 0; i < LIMIT; i += 1) assert.equal(limiter.check('user-1').allowed, true);
    const blocked = limiter.check('user-1');
    assert.equal(blocked.allowed, false);
    if (!blocked.allowed) assert.ok(blocked.retryAfterMs > 0 && blocked.retryAfterMs <= WINDOW_MS);
  });

  it('memisahkan kunci per user', () => {
    const { limiter } = limiterAt(1_000);
    for (let i = 0; i < LIMIT; i += 1) limiter.check('user-1');
    assert.equal(limiter.check('user-1').allowed, false);
    assert.equal(limiter.check('user-2').allowed, true);
  });

  it('reset pada jendela berikutnya', () => {
    const { limiter, tick } = limiterAt(1_000);
    for (let i = 0; i < LIMIT; i += 1) limiter.check('user-1');
    assert.equal(limiter.check('user-1').allowed, false);
    tick(WINDOW_MS + 1);
    assert.equal(limiter.check('user-1').allowed, true);
  });

  it('murni terhadap waktu sistem', () => {
    assert.ok(!FixedWindowRateLimiter.toString().includes('Date.now'));
  });
});

describe('secretsMatch — CRON_SECRET tetap timing-safe', () => {
  it('cocok/mismatch/kosong', () => {
    assert.equal(secretsMatch('rahasia', 'rahasia'), true);
    assert.equal(secretsMatch('rahasia', 'salah'), false);
    assert.equal(secretsMatch('', 'rahasia'), false);
    assert.equal(secretsMatch('rahasia', ''), false);
  });

  it('memakai timingSafeEqual, bukan perbandingan string biasa', () => {
    const source = secretsMatch.toString();
    assert.ok(source.includes('timingSafeEqual'));
    assert.ok(!/\bprovided\s*===\s*configured\b/.test(source));
  });
});
