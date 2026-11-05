/**
 * Uji modul slug permalink (`src/features/battle/share.ts`).
 *
 * Yang dikunci di sini adalah kontrak URL, bukan tampilan: dua sisi selalu
 * diurutkan sama, sehingga `a-vs-b` dan `b-vs-a` tidak pernah menjadi dua
 * halaman berbeda; dan slug yang "hampir benar" ditolak, bukan ditebak.
 *
 * Modulnya murni, jadi seluruh berkas ini berjalan tanpa database.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canonicalMatchup,
  canonicalRedirectTarget,
  compareSelections,
  matchupSlug,
  parseMatchupSlug,
  selectionValue,
} from '../../src/features/battle/share.ts';

const goku = { characterSlug: 'goku', formSlug: 'base' };
const gokuUltra = { characterSlug: 'goku', formSlug: 'ultra-instinct' };
const naruto = { characterSlug: 'naruto', formSlug: 'base' };

describe('selectionValue', () => {
  it('menggabungkan slug karakter dan form dengan satu garis miring', () => {
    assert.equal(selectionValue(goku), 'goku/base');
  });
});

describe('compareSelections', () => {
  it('mengurutkan menurut nilai kanonik, bukan menurut argumen', () => {
    assert.ok(compareSelections(goku, naruto) < 0, 'goku sebelum naruto');
    assert.ok(compareSelections(naruto, goku) > 0);
    assert.equal(compareSelections(goku, { ...goku }), 0);
  });

  it('membandingkan form ketika karakternya sama', () => {
    assert.ok(compareSelections(goku, gokuUltra) < 0, 'base sebelum ultra-instinct');
  });

  it('deterministik lintas locale: "Z" < "a" menurut kode unit', () => {
    // `localeCompare` akan menempatkan 'a' sebelum 'Z'; URL kanonik tidak boleh
    // bergantung pada locale proses, jadi urutannya mengikuti kode unit.
    assert.ok(compareSelections({ characterSlug: 'Zed', formSlug: 'x' }, { characterSlug: 'abel', formSlug: 'x' }) < 0);
  });
});

describe('canonicalMatchup', () => {
  it('menyusun slug terurut dan menandai masukan yang sudah kanonik', () => {
    const result = canonicalMatchup(goku, naruto);
    assert.ok(result);
    assert.equal(result.slug, 'goku/base-vs-naruto/base');
    assert.equal(result.canonical, true);
    assert.equal(result.sideA.characterSlug, 'goku');
    assert.equal(result.sideB.characterSlug, 'naruto');
  });

  it('menukar sisi bila masukan terbalik — slug tetap sama', () => {
    const forward = canonicalMatchup(goku, naruto);
    const backward = canonicalMatchup(naruto, goku);
    assert.ok(forward && backward);
    assert.equal(backward.slug, forward.slug);
    assert.equal(backward.canonical, false);
    assert.equal(backward.sideA.characterSlug, 'goku');
    assert.equal(backward.sideB.characterSlug, 'naruto');
  });

  it('menolak pertarungan sisi yang sama', () => {
    assert.equal(canonicalMatchup(goku, { ...goku }), null);
    assert.equal(matchupSlug(goku, { ...goku }), null);
  });
});

describe('parseMatchupSlug', () => {
  it('mengurai slug kanonik menjadi dua pilihan', () => {
    const parsed = parseMatchupSlug('goku/base-vs-naruto/base');
    assert.ok(parsed);
    assert.deepEqual(parsed.sideA, goku);
    assert.deepEqual(parsed.sideB, naruto);
  });

  it('menerima slug dengan urutan terbalik — pengurutan urusan pemanggil', () => {
    const parsed = parseMatchupSlug('naruto/base-vs-goku/base');
    assert.ok(parsed);
    assert.deepEqual(parsed.sideA, naruto);
    assert.deepEqual(parsed.sideB, goku);
  });

  it('menolak jumlah pemisah selain satu', () => {
    assert.equal(parseMatchupSlug('goku/base-vs-naruto/base-vs-luffy/base'), null);
    assert.equal(parseMatchupSlug('goku/base'), null);
  });

  it('menolak bagian yang bukan pasangan karakter/form', () => {
    assert.equal(parseMatchupSlug('goku-vs-naruto'), null, 'tanpa form');
    assert.equal(parseMatchupSlug('goku/base-vs-naruto'), null, 'sisi B tanpa form');
    assert.equal(parseMatchupSlug('goku/-vs-naruto/base'), null, 'form kosong');
    assert.equal(parseMatchupSlug('-vs-naruto/base'), null, 'karakter kosong');
    assert.equal(parseMatchupSlug('goku/base/vs-naruto/base'), null, 'tiga bagian di sisi A');
  });

  it('menolak string kosong', () => {
    assert.equal(parseMatchupSlug(''), null);
  });
});

describe('canonicalRedirectTarget', () => {
  it('tidak mengalihkan slug yang sudah kanonik', () => {
    assert.equal(canonicalRedirectTarget('goku/base-vs-naruto/base'), null);
  });

  it('mengembalikan bentuk kanonik untuk slug terbalik', () => {
    assert.equal(canonicalRedirectTarget('naruto/base-vs-goku/base'), 'goku/base-vs-naruto/base');
  });

  it('tidak mengalihkan slug yang tidak sah (pemanggil menjawab 404)', () => {
    assert.equal(canonicalRedirectTarget('goku-vs-naruto'), null);
    assert.equal(canonicalRedirectTarget('goku/base-vs-goku/base'), null, 'sisi sama');
  });

  it('slug hasil pengalihan selalu kanonik — tidak ada rantai redirect', () => {
    const target = canonicalRedirectTarget('naruto/base-vs-goku/base');
    assert.ok(target);
    assert.equal(canonicalRedirectTarget(target), null);
  });
});
