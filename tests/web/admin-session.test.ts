/**
 * Unit test token sesi admin (`src/lib/security/admin-session.ts`).
 *
 * Yang diuji bukan "apakah fungsi mengembalikan true" saja, melainkan batas
 * keamanannya: token yang ditandatangani dengan secret lain, token yang diubah
 * satu karakter, token dari masa depan, dan token kedaluwarsa harus ditolak —
 * semuanya tanpa database dan tanpa HTTP.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ADMIN_SESSION_MAX_AGE_MS,
  createAdminSessionToken,
  verifyAdminSessionToken,
} from '../../src/lib/security/admin-session.ts';

const SECRET = 'rahasia-uji-yang-panjang';
const NOW = 1_700_000_000_000;

describe('token sesi admin', () => {
  it('token yang baru dibuat lolos verifikasi', () => {
    const token = createAdminSessionToken(SECRET, NOW);
    assert.equal(verifyAdminSessionToken(token, SECRET, NOW), true);
    assert.equal(verifyAdminSessionToken(token, SECRET, NOW + ADMIN_SESSION_MAX_AGE_MS - 1000), true);
  });

  it('token kedaluwarsa ditolak', () => {
    const token = createAdminSessionToken(SECRET, NOW);
    assert.equal(verifyAdminSessionToken(token, SECRET, NOW + ADMIN_SESSION_MAX_AGE_MS + 1), false);
  });

  it('token dari masa depan ditolak (jam bergeser / stempel palsu)', () => {
    const token = createAdminSessionToken(SECRET, NOW + 60_000);
    assert.equal(verifyAdminSessionToken(token, SECRET, NOW), false);
  });

  it('secret berbeda menghasilkan token yang tidak sah', () => {
    const token = createAdminSessionToken('secret-lain', NOW);
    assert.equal(verifyAdminSessionToken(token, SECRET, NOW), false);
  });

  it('tanda tangan yang diubah satu karakter ditolak', () => {
    const token = createAdminSessionToken(SECRET, NOW);
    const parts = token.split('.');
    const signature = parts[2]!;
    const tampered = `${parts[0]}.${parts[1]}.${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`;
    assert.equal(verifyAdminSessionToken(tampered, SECRET, NOW), false);
  });

  it('stempel waktu yang diubah membuat tanda tangan tidak cocok', () => {
    const token = createAdminSessionToken(SECRET, NOW);
    const parts = token.split('.');
    const forged = `${parts[0]}.${Number(parts[1]) + 1}.${parts[2]}`;
    assert.equal(verifyAdminSessionToken(forged, SECRET, NOW), false);
  });

  it('bentuk yang cacat dan secret kosong ditolak tanpa melempar', () => {
    assert.equal(verifyAdminSessionToken('', SECRET, NOW), false);
    assert.equal(verifyAdminSessionToken('v1', SECRET, NOW), false);
    assert.equal(verifyAdminSessionToken('v1.abc.def', SECRET, NOW), false);
    assert.equal(verifyAdminSessionToken('v2.123.abc', SECRET, NOW), false);
    assert.equal(verifyAdminSessionToken(null, SECRET, NOW), false);
    assert.equal(verifyAdminSessionToken(createAdminSessionToken(SECRET, NOW), '', NOW), false);
    assert.equal(verifyAdminSessionToken(createAdminSessionToken(SECRET, NOW), null, NOW), false);
  });
});
