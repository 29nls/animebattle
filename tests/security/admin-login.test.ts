/**
 * Rate limit login panel admin (10/menit/IP).
 *
 * Diuji dengan jam yang disuntik agar deterministik; tidak ada Supabase atau
 * jaringan yang disentuh.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createLoginLimiter,
  loginRateLimitKey,
  LOGIN_RATE_LIMIT,
  LOGIN_RATE_WINDOW_MS,
} from '../../src/features/admin/login.ts';

describe('rate limit login', () => {
  it('batasnya 10 percobaan per 60 detik', () => {
    assert.equal(LOGIN_RATE_LIMIT, 10);
    assert.equal(LOGIN_RATE_WINDOW_MS, 60_000);
  });

  it('percobaan ke-11 ditolak, jendela berikutnya membuka lagi', () => {
    let now = 1_000;
    const limiter = createLoginLimiter(() => now);
    for (let i = 0; i < 10; i += 1) {
      assert.equal(limiter.check(loginRateLimitKey('203.0.113.9')).allowed, true);
    }
    const blocked = limiter.check(loginRateLimitKey('203.0.113.9'));
    assert.equal(blocked.allowed, false);
    if (!blocked.allowed) assert.ok(blocked.retryAfterMs > 0);

    now += 60_001;
    assert.equal(limiter.check(loginRateLimitKey('203.0.113.9')).allowed, true);
  });

  it('IP berbeda punya kuota terpisah', () => {
    let now = 1_000;
    const limiter = createLoginLimiter(() => now);
    for (let i = 0; i < 10; i += 1) limiter.check('203.0.113.9');
    assert.equal(limiter.check('203.0.113.9').allowed, false);
    assert.equal(limiter.check('203.0.113.10').allowed, true);
  });

  it('IP kosong memakai kunci yang stabil, bukan kunci kosong', () => {
    assert.equal(loginRateLimitKey(''), 'unknown-client');
    assert.equal(loginRateLimitKey(null), 'unknown-client');
    assert.equal(loginRateLimitKey('   '), 'unknown-client');
  });
});
