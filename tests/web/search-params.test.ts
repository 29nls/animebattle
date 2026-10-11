/**
 * Uji validasi parameter `/api/search` dan `/api/search/suggest` (murni, tanpa
 * database dan tanpa Next).
 *
 * Kenapa dipisah: aturan ini menentukan apa yang **ditolak** endpoint, dan
 * penolakan yang benar adalah bagian dari kontrak — `types` yang diam-diam
 * diabaikan akan membuat pemanggil mengira ia mencari verse juga, sedangkan
 * `per_page=37` yang dijepit diam-diam membuatnya tidak tahu batas yang berlaku.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_QUERY_LENGTH,
  parseSearchQuery,
  parseSuggestQuery,
} from '../../src/features/characters/search-params.ts';

function query(text: string): URLSearchParams {
  return new URLSearchParams(text);
}

describe('parseSearchQuery', () => {
  it('menerapkan default saat parameter tidak diberikan', () => {
    const parsed = parseSearchQuery(query(''));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.value, { q: '', verseSlug: null, media: null, page: 1, perPage: 20 });
  });

  it('memangkas kueri dan menormalkan media ke huruf kecil', () => {
    const parsed = parseSearchQuery(query('q=  Sun+Wukong  &media=MANGA&verse=one-punch-man&page=2&per_page=100'));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.value, {
      q: 'Sun Wukong',
      verseSlug: 'one-punch-man',
      media: 'manga',
      page: 2,
      perPage: 100,
    });
  });

  it('menerima `limit` sebagai alias lama untuk per_page', () => {
    const parsed = parseSearchQuery(query('q=goku&limit=50'));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.perPage, 50);
  });

  it('menolak parameter yang belum diimplementasikan dengan alasan yang jelas', () => {
    const parsed = parseSearchQuery(query('q=goku&types=character,verse'));
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(parsed.message, /types/);
    assert.match(parsed.message, /hanya mencari karakter/);
  });

  it('menolak parameter tak dikenal, bukan mengabaikannya', () => {
    const parsed = parseSearchQuery(query('q=goku&sort=name'));
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(parsed.message, /tidak dikenal: sort/);
    assert.match(parsed.message, /q, verse, media, page, per_page, limit/);
  });

  it('menolak nilai di luar kontrak, bukan menjepitnya diam-diam', () => {
    const perPage = parseSearchQuery(query('q=goku&per_page=37'));
    assert.equal(perPage.ok, false);
    if (!perPage.ok) assert.match(perPage.message, /20, 50, 100, 200/);

    const both = parseSearchQuery(query('q=goku&per_page=20&limit=50'));
    assert.equal(both.ok, false);
    if (!both.ok) assert.match(both.message, /bukan keduanya/);

    const media = parseSearchQuery(query('q=goku&media=light-novel'));
    assert.equal(media.ok, false);
    if (!media.ok) assert.match(media.message, /media tidak dikenal/);

    for (const bad of ['0', '-1', 'abc', '1.5', '99999']) {
      const page = parseSearchQuery(query(`q=goku&page=${bad}`));
      assert.equal(page.ok, false, `page=${bad} harus ditolak`);
    }
  });

  it('menerima kueri kosong sebagai daftar kosong, bukan galat', () => {
    const missing = parseSearchQuery(query(''));
    const blank = parseSearchQuery(query('q=%20%20'));
    assert.equal(missing.ok, true);
    assert.equal(blank.ok, true);
    if (!missing.ok || !blank.ok) return;
    assert.equal(missing.value.q, '');
    assert.equal(blank.value.q, '');
  });

  it('menolak kueri yang panjangnya melampaui batas', () => {
    const parsed = parseSearchQuery(query(`q=${'a'.repeat(MAX_QUERY_LENGTH + 1)}`));
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.match(parsed.message, /terlalu panjang/);
  });
});

describe('parseSuggestQuery', () => {
  it('menerima q saja', () => {
    const parsed = parseSuggestQuery(query('q=sa'));
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.value.q, 'sa');
  });

  it('menolak permintaan tanpa kueri, bukan menjawab nama acak', () => {
    for (const text of ['', 'q=', 'q=%20']) {
      const parsed = parseSuggestQuery(query(text));
      assert.equal(parsed.ok, false, `"${text}" harus ditolak`);
    }
  });

  it('menolak parameter lain', () => {
    const parsed = parseSuggestQuery(query('q=sa&limit=5'));
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.match(parsed.message, /tidak dikenal: limit/);
  });
});
