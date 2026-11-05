import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateIngestionHealth } from '../../src/lib/observability/ingestion-health.ts';
import { formatLogRecord } from '../../src/lib/observability/logger.ts';
import { sanitizeValue } from '../../src/lib/observability/redact.ts';

describe('log terstruktur', () => {
  it('mengeluarkan satu record JSON dengan waktu, level, dan event', () => {
    const record = formatLogRecord(
      'warn',
      'uji.event',
      { route: '/api/search' },
      new Date('2026-11-05T10:00:00.000Z'),
    );
    assert.deepEqual(record, {
      time: '2026-11-05T10:00:00.000Z',
      level: 'warn',
      event: 'uji.event',
      service: 'animebattle',
      route: '/api/search',
    });
    assert.doesNotThrow(() => JSON.stringify(record));
  });

  it('meredaksi password, token, DSN, email, dan kredensial di URL', () => {
    const record = formatLogRecord('error', 'uji.redaksi', {
      password: 'jangan-keluar',
      api_token: 'tok_rahasia',
      SENTRY_DSN: 'https://contoh@sentry.invalid/1',
      reporter_email: 'pemilik@example.test',
      database_url: 'postgres://user:pass@db.example.test:5432/animebattle',
      nested: { authorization: 'Bearer abc.def.ghi' },
      error: new Error('gagal konek postgres://user:secret@db.example.test/animebattle'),
    });

    const text = JSON.stringify(record);
    assert.doesNotMatch(text, /jangan-keluar/);
    assert.doesNotMatch(text, /tok_rahasia/);
    assert.doesNotMatch(text, /pemilik@example\.test/);
    assert.doesNotMatch(text, /user:secret/);
    assert.doesNotMatch(text, /abc\.def\.ghi/);
    assert.equal(record.password, '[redacted]');
    assert.equal(record.reporter_email, '[redacted]');
    assert.match(text, /\[redacted\]/);
  });

  it('menangani objek melingkar tanpa melempar', () => {
    const cyclic: Record<string, unknown> = { nama: 'aman' };
    cyclic.diri = cyclic;
    const safe = sanitizeValue(cyclic) as Record<string, unknown>;
    assert.doesNotThrow(() => JSON.stringify(safe));
    assert.equal(safe.diri, '[circular]');
  });
});

describe('kesehatan antrian ingestion', () => {
  const healthy = {
    failed_jobs: 0,
    stuck_jobs: 0,
    stale_pending_jobs: 0,
    oldest_pending_age_seconds: 12,
    oldest_processing_age_seconds: 0,
  };

  it('sehat bila tidak ada job gagal, macet, atau pending basi', () => {
    const verdict = evaluateIngestionHealth(healthy);
    assert.equal(verdict.healthy, true);
    assert.deepEqual(verdict.issues, []);
  });

  it('menganggap job gagal, processing macet, dan pending basi sebagai alarm', () => {
    const verdict = evaluateIngestionHealth({
      ...healthy,
      failed_jobs: 2,
      stuck_jobs: 1,
      stale_pending_jobs: 3,
    });
    assert.equal(verdict.healthy, false);
    assert.equal(verdict.issues.length, 3);
    assert.match(verdict.issues.join(' '), /gagal/);
    assert.match(verdict.issues.join(' '), /macet/);
    assert.match(verdict.issues.join(' '), /pending/);
  });
});
