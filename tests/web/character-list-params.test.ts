/**
 * Test parameter halaman `/characters` — tanpa Next, tanpa database.
 *
 * Yang dijaga: URL hasil ketikan pengguna tidak boleh menjatuhkan halaman, tetapi
 * juga tidak boleh diam-diam berubah arti. Nilai media yang tidak dikenal
 * diabaikan, sementara nilai sah diteruskan apa adanya; pagination wajib
 * membawa filter yang sedang aktif.
 *
 * Jalankan: npm run test:web
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_CHARACTER_PAGE_SIZE,
  MAX_CHARACTER_QUERY_LENGTH,
  characterListHref,
  hasCharacterFilters,
  mediaLabel,
  parseCharacterListParams,
} from '../../src/features/characters/list-params.ts';

describe('parseCharacterListParams', () => {
  it('memberi default yang aman untuk URL kosong', () => {
    assert.deepEqual(parseCharacterListParams({}), {
      query: '',
      verseSlug: null,
      media: null,
      page: 1,
      perPage: DEFAULT_CHARACTER_PAGE_SIZE,
    });
  });

  it('memangkas q dan memotongnya pada batas kontrak', () => {
    assert.equal(parseCharacterListParams({ q: '  saitama  ' }).query, 'saitama');
    assert.equal(
      parseCharacterListParams({ q: 'x'.repeat(MAX_CHARACTER_QUERY_LENGTH + 50) }).query.length,
      MAX_CHARACTER_QUERY_LENGTH,
    );
  });

  it('menerima media hanya bila persis nilai enum', () => {
    assert.equal(parseCharacterListParams({ media: 'anime' }).media, 'anime');
    assert.equal(parseCharacterListParams({ media: 'ANIME' }).media, 'anime');
    assert.equal(parseCharacterListParams({ media: 'light-novel' }).media, null);
    assert.equal(parseCharacterListParams({ media: ' anime ' }).media, 'anime');
  });

  it('mengabaikan halaman dan ukuran halaman yang tidak sah', () => {
    for (const input of [{ page: '0' }, { page: '-2' }, { page: 'abc' }, { page: '1.5' }]) {
      assert.equal(parseCharacterListParams(input).page, 1, JSON.stringify(input));
    }
    for (const perPage of ['10', '500', 'abc', '0']) {
      assert.equal(
        parseCharacterListParams({ per_page: perPage }).perPage,
        DEFAULT_CHARACTER_PAGE_SIZE,
        perPage,
      );
    }
    assert.equal(parseCharacterListParams({ page: '3', per_page: '100' }).page, 3);
    assert.equal(parseCharacterListParams({ per_page: '200' }).perPage, 200);
  });

  it('mempertahankan slug verse apa adanya, hanya dipangkas', () => {
    assert.equal(parseCharacterListParams({ verse: ' one-punch-man ' }).verseSlug, 'one-punch-man');
    assert.equal(parseCharacterListParams({ verse: '   ' }).verseSlug, null);
  });
});

describe('hasCharacterFilters', () => {
  it('membedakan katalog biasa dari katalog tersaring', () => {
    assert.equal(hasCharacterFilters(parseCharacterListParams({})), false);
    assert.equal(hasCharacterFilters(parseCharacterListParams({ q: 'saitama' })), true);
    assert.equal(hasCharacterFilters(parseCharacterListParams({ verse: 'opm' })), true);
    assert.equal(hasCharacterFilters(parseCharacterListParams({ media: 'manga' })), true);
  });
});

describe('characterListHref', () => {
  const active = parseCharacterListParams({
    q: 'saitama',
    verse: 'one-punch-man',
    media: 'manga',
    page: '2',
    per_page: '100',
  });

  it('membawa semua filter dan pagination', () => {
    assert.equal(
      characterListHref(active),
      '/characters?q=saitama&verse=one-punch-man&media=manga&page=2&per_page=100',
    );
  });

  it('tidak menulis nilai default', () => {
    assert.equal(characterListHref(parseCharacterListParams({})), '/characters');
    assert.equal(
      characterListHref(active, { page: 1, perPage: DEFAULT_CHARACTER_PAGE_SIZE }),
      '/characters?q=saitama&verse=one-punch-man&media=manga',
    );
  });

  it('dapat menghapus filter dengan override null', () => {
    assert.equal(
      characterListHref(active, {
        verseSlug: null,
        media: null,
        page: 1,
        perPage: DEFAULT_CHARACTER_PAGE_SIZE,
      }),
      '/characters?q=saitama',
    );
  });

  it('meng-encode nilai yang memuat spasi dan karakter khusus', () => {
    const href = characterListHref(parseCharacterListParams({ q: 'saitama & genos' }));
    assert.equal(href, '/characters?q=saitama+%26+genos');
    assert.equal(new URL(href, 'https://local.test').searchParams.get('q'), 'saitama & genos');
  });
});

describe('mediaLabel', () => {
  it('menerjemahkan nilai enum dan mempertahankan nilai tak dikenal', () => {
    assert.equal(mediaLabel('comic'), 'Komik');
    assert.equal(mediaLabel('movie'), 'Film');
    assert.equal(mediaLabel('other'), 'Lainnya');
    assert.equal(mediaLabel('light-novel'), 'light-novel');
  });
});
