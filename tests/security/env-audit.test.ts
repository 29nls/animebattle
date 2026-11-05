import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  auditEnvNames,
  extractEnvNames,
  findPublicEnvReferences,
  PUBLIC_ENV_ALLOWLIST,
} from '../../src/lib/security/env-audit.ts';

describe('audit environment publik', () => {
  it('mengizinkan tiga variabel publik yang sudah ditinjau', () => {
    assert.deepEqual(auditEnvNames([...PUBLIC_ENV_ALLOWLIST]), []);
  });

  it('menolak NEXT_PUBLIC_ baru dan nama yang mirip rahasia', () => {
    const errors = auditEnvNames([
      'NEXT_PUBLIC_FEATURE_FLAG',
      'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY',
      'DATABASE_URL',
    ]);
    assert.equal(errors.length, 2);
    assert.match(errors[0]!, /FEATURE_FLAG/);
    assert.match(errors[1]!, /SERVICE_ROLE/);
  });

  it('mengambil nama dari template tanpa membaca nilai', () => {
    const names = extractEnvNames(`
      # komentar
      DATABASE_URL="postgres://user:pass@host/db"
      export NEXT_PUBLIC_SITE_URL=https://contoh.test
      CRON_SECRET=
    `);
    assert.deepEqual(names, ['DATABASE_URL', 'NEXT_PUBLIC_SITE_URL', 'CRON_SECRET']);
  });

  it('menemukan referensi process.env publik di sumber', () => {
    const refs = findPublicEnvReferences(`
      const a = process.env.NEXT_PUBLIC_SITE_URL;
      const b = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const c = process.env.DATABASE_URL;
    `);
    assert.deepEqual(refs, ['NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_SUPABASE_URL']);
  });
});
