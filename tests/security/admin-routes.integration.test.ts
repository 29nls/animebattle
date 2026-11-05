/**
 * Integration test rute admin — kontrak keamanan pada level handler Next.js.
 *
 * Database tidak disentuh: provider sesi disuntik, dan route yang lolos guard
 * berhenti pada `DatabaseNotConfiguredError` (503). Itu membuktikan urutan
 * auth → peran → rate limit → DB, bukan hanya unit evaluator.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  setAdminAuthProviderForTests,
  type AdminAuthSnapshot,
} from '../../src/features/admin/auth.ts';

const { POST: runPost } = await import('../../app/api/admin/ingestion/run/route.ts');
const { POST: importPost } = await import('../../app/api/admin/ingestion/import/route.ts');
const { GET: metricsGet } = await import('../../app/api/admin/metrics/route.ts');

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function snapshot(overrides: Partial<AdminAuthSnapshot> = {}): AdminAuthSnapshot {
  return {
    configured: true,
    user: { id: randomUUID(), email: 'admin@example.test', displayName: 'Admin Uji' },
    roles: ['admin'],
    aal: 'aal2',
    expiresAt: 2_000_000_000,
    now: 1_700_000_000_000,
    ...overrides,
  };
}

function useSnapshot(value: AdminAuthSnapshot): void {
  setAdminAuthProviderForTests(async () => value);
}

async function errorBody(response: Response) {
  return (await response.json()) as {
    error: { code: string; message: string; details?: { reason?: string } };
  };
}

beforeEach(() => {
  delete process.env.DATABASE_URL;
  setAdminAuthProviderForTests(null);
});

afterEach(() => {
  setAdminAuthProviderForTests(null);
  delete process.env.DATABASE_URL;
});

describe('integration — admin auth fail-closed', () => {
  it('503 tanpa konfigurasi Supabase Auth', async () => {
    useSnapshot(snapshot({ configured: false, user: null, roles: [] }));
    const response = await runPost(jsonRequest('http://localhost/api/admin/ingestion/run', { scope: 'manual_run' }));
    assert.equal(response.status, 503);
    const body = await errorBody(response);
    assert.equal(body.error.code, 'UNAVAILABLE');
    assert.equal(body.error.details?.reason, 'not_configured');
  });

  it('401 tanpa sesi', async () => {
    useSnapshot(snapshot({ user: null, roles: [] }));
    const response = await runPost(jsonRequest('http://localhost/api/admin/ingestion/run', { scope: 'manual_run' }));
    assert.equal(response.status, 401);
    assert.equal((await errorBody(response)).error.code, 'UNAUTHORIZED');
  });

  it('401 untuk sesi kedaluwarsa', async () => {
    useSnapshot(snapshot({ expiresAt: 1_700_000_000, now: 1_700_000_001_000 }));
    const response = await runPost(jsonRequest('http://localhost/api/admin/ingestion/run', { scope: 'manual_run' }));
    assert.equal(response.status, 401);
    assert.equal((await errorBody(response)).error.details?.reason, 'session_expired');
  });
});

describe('integration — eskalasi peran & MFA', () => {
  it('viewer ditolak 403 pada aksi editor', async () => {
    useSnapshot(snapshot({ roles: ['viewer'], aal: 'aal1' }));
    const response = await runPost(jsonRequest('http://localhost/api/admin/ingestion/run', { scope: 'manual_run' }));
    assert.equal(response.status, 403);
    const body = await errorBody(response);
    assert.equal(body.error.code, 'FORBIDDEN');
    assert.equal(body.error.details?.reason, 'forbidden');
  });

  it('editor lolos guard lalu DB menolak 503 (urutan benar)', async () => {
    useSnapshot(snapshot({ roles: ['editor'], aal: 'aal1' }));
    const response = await runPost(jsonRequest('http://localhost/api/admin/ingestion/run', { scope: 'manual_run' }));
    assert.equal(response.status, 503);
    const body = await errorBody(response);
    assert.equal(body.error.code, 'UNAVAILABLE');
    assert.match(body.error.message, /Database belum dikonfigurasi/);
    assert.notEqual(body.error.details?.reason, 'not_configured');
  });

  it('admin AAL1 ditolak 403 mfa_required, bahkan untuk metrics viewer', async () => {
    useSnapshot(snapshot({ roles: ['admin'], aal: 'aal1' }));
    const response = await metricsGet(new Request('http://localhost/api/admin/metrics'));
    assert.equal(response.status, 403);
    const body = await errorBody(response);
    assert.equal(body.error.code, 'FORBIDDEN');
    assert.equal(body.error.details?.reason, 'mfa_required');
  });

  it('admin AAL2 lolos guard; DB menolak 503', async () => {
    useSnapshot(snapshot({ roles: ['admin'], aal: 'aal2' }));
    const response = await metricsGet(new Request('http://localhost/api/admin/metrics'));
    assert.equal(response.status, 503);
    const body = await errorBody(response);
    assert.match(body.error.message, /Database belum dikonfigurasi/);
  });

  it('import juga memakai guard editor dan tidak menerima aktor dari body', async () => {
    useSnapshot(snapshot({ roles: ['editor'], aal: 'aal1' }));
    const response = await importPost(
      jsonRequest('http://localhost/api/admin/ingestion/import', {
        scope: 'import_url',
        target_ref: 'https://example.test/data.json',
        created_by: '00000000-0000-0000-0000-000000000000',
      }),
    );
    assert.equal(response.status, 503);
    assert.match((await errorBody(response)).error.message, /Database belum dikonfigurasi/);
  });
});

describe('integration — rate limit per user', () => {
  it('permintaan ke-7 dari user yang sama ditolak 429', async () => {
    const userId = randomUUID();
    useSnapshot(snapshot({ user: { id: userId, email: 'rl@example.test', displayName: null } }));

    let last: Response | undefined;
    for (let i = 0; i < 7; i += 1) {
      last = await runPost(jsonRequest('http://localhost/api/admin/ingestion/run', { scope: 'manual_run' }));
    }
    assert.equal(last!.status, 429);
    assert.ok((last!.headers.get('retry-after') ?? '') !== '');
    const body = await errorBody(last!);
    assert.equal(body.error.code, 'RATE_LIMITED');
    assert.ok((body.error.details as { retry_after_ms?: number } | undefined)?.retry_after_ms! > 0);
  });

  it('user berbeda tidak terpengaruh kuota user lain', async () => {
    const first = randomUUID();
    useSnapshot(snapshot({ user: { id: first, email: null, displayName: null } }));
    for (let i = 0; i < 7; i += 1) {
      await runPost(jsonRequest('http://localhost/api/admin/ingestion/run', { scope: 'manual_run' }));
    }

    useSnapshot(snapshot({ user: { id: randomUUID(), email: null, displayName: null } }));
    const response = await runPost(jsonRequest('http://localhost/api/admin/ingestion/run', { scope: 'manual_run' }));
    assert.equal(response.status, 503);
  });
});
