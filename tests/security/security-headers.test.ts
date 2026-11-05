import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import nextConfig from '../../next.config.ts';

describe('security headers', () => {
  it('memasang CSP dan header hardening pada semua path', async () => {
    const rules = await nextConfig.headers?.();
    assert.ok(rules && rules.length > 0);
    assert.equal(rules[0]!.source, '/:path*');

    const headers = new Map(rules[0]!.headers.map((header) => [header.key, header.value]));
    assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(headers.get('X-Frame-Options'), 'DENY');
    assert.equal(headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
    assert.equal(headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
    assert.match(headers.get('Permissions-Policy') ?? '', /camera=\(\)/);

    const csp = headers.get('Content-Security-Policy') ?? '';
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /form-action 'self'/);
    assert.match(csp, /script-src 'self' 'unsafe-inline'/);
    assert.match(csp, /https:\/\/\*\.supabase\.co/);
    // Nonce belum dipakai; jangan sampai dokumentasi mengklaim strict-dynamic.
    assert.doesNotMatch(csp, /strict-dynamic/);
  });

  it('tidak mengirim HSTS pada lingkungan non-produksi', async () => {
    const rules = await nextConfig.headers?.();
    const keys = rules?.[0]?.headers.map((header) => header.key) ?? [];
    if (process.env.NODE_ENV !== 'production') {
      assert.ok(!keys.includes('Strict-Transport-Security'));
    }
  });
});
