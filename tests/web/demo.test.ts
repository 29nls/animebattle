/**
 * Test lapisan web: dataset demo, provider, dan pemilih sumber data.
 *
 * Kenapa test ini ada padahal tidak menyentuh database: dataset demo dan
 * pemilihnya adalah **kode produksi** (dipakai halaman), dan kontraknya mudah
 * rusak tanpa disadari — id duplikat, kategori ability yang tidak ada di rule
 * set, pasangan form yang membuat engine melempar, atau data demo yang bocor
 * ketika flag belum diaktifkan. Semuanya diperiksa di sini.
 *
 * Jalankan: npm run test:web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DEMO_CHARACTERS,
  DEMO_FORM_RECORDS,
  DEMO_VERSES,
} from '../../src/features/demo/dataset.ts';
import {
  DEMO_NOTICE,
  DemoDataError,
  demoBattleInput,
  demoCharacterDetail,
  demoCharacterListItems,
  demoEnabled,
  demoVerseDetail,
} from '../../src/features/demo/provider.ts';
import { loadCharacterList } from '../../src/features/characters/queries.ts';
import { DatabaseNotConfiguredError } from '../../src/lib/db/client.ts';
import { simulateFromSides } from '../../src/features/battle/simulate.ts';
import { DISCLAIMER, REQUIRED_METRICS } from '../../src/services/battle/types.ts';
import type { BattleConditions, RuleSet } from '../../src/services/battle/types.ts';

const ruleSet = JSON.parse(
  readFileSync(new URL('../../src/services/battle/fixtures/rule-set.default.json', import.meta.url), 'utf8'),
) as RuleSet;

const CONDITIONS: BattleConditions = {
  mode: 'standard',
  speed_equalized: false,
  starting_distance_rank: null,
  battlefield: 'neutral',
  knowledge_level: 'partial',
  prep_time: 'none',
  win_condition: 'incapacitation',
};

test('dataset demo konsisten: id unik, versi cocok, metrik wajib terisi', () => {
  const characterSlugs = DEMO_CHARACTERS.map((character) => character.slug);
  assert.equal(new Set(characterSlugs).size, characterSlugs.length);

  const versionIds = DEMO_FORM_RECORDS.map((record) => record.side.version_id);
  assert.equal(new Set(versionIds).size, versionIds.length, 'version_id harus unik');

  for (const record of DEMO_FORM_RECORDS) {
    for (const metric of REQUIRED_METRICS) {
      assert.notEqual(
        record.side.metrics[metric],
        null,
        `${record.side.version_id}: metrik wajib ${metric} tidak boleh kosong`,
      );
    }
    assert.equal(record.side.metrics.tier, record.side.tier.rank, `${record.side.version_id}: tier rank tidak sinkron`);
    assert.equal(record.side.statistics.length > 0, true, `${record.side.version_id}: harus punya statistik`);
  }

  assert.equal(new Set(DEMO_VERSES.map((verse) => verse.slug)).size, DEMO_VERSES.length);
});

test('semua kategori ability & resistensi demo dikenal rule set', () => {
  // Kategori dianggap dikenal bila muncul di peta win condition **atau** di aturan
  // interaksi hax. Sebagian kategori (mis. existence-erasure, reality-warping)
  // memang tidak punya entri eksplisit di peta dan memakai `_default`.
  const knownCategories = new Set([
    ...Object.keys(ruleSet.constants.win_condition_map),
    ...ruleSet.hax_rules.flatMap((rule) => [rule.ability_category_slug, rule.resistance_category_slug]),
  ]);
  for (const record of DEMO_FORM_RECORDS) {
    for (const ability of record.side.abilities) {
      assert.ok(
        knownCategories.has(ability.category_slug),
        `${record.side.version_id}: kategori ability "${ability.category_slug}" tidak ada di rule set`,
      );
    }
    for (const resistance of record.side.resistances) {
      assert.ok(
        knownCategories.has(resistance.category_slug),
        `${record.side.version_id}: kategori resistensi "${resistance.category_slug}" tidak ada di rule set`,
      );
    }
  }
});

test('setiap pasangan form dapat disimulasikan, deterministik, dan memuat disclaimer', () => {
  const values = DEMO_FORM_RECORDS.map((record) => `${record.character.slug}/${record.form.slug}`);
  let pairs = 0;

  for (const valueA of values) {
    for (const valueB of values) {
      if (valueA === valueB) continue;
      pairs += 1;

      const input = demoBattleInput(valueA, valueB, CONDITIONS);
      const first = simulateFromSides(input, ruleSet);
      const second = simulateFromSides(input, ruleSet);

      assert.equal(first.input_hash, second.input_hash, `${valueA} vs ${valueB}: hash tidak deterministik`);
      assert.equal(first.winner, second.winner, `${valueA} vs ${valueB}: pemenang berubah antar pemanggilan`);
      assert.ok(['a', 'b', 'draw', 'insufficient_data'].includes(first.winner));
      assert.ok(first.win_probability.a >= 0 && first.win_probability.a <= 1);
      assert.ok(first.win_probability.b >= 0 && first.win_probability.b <= 1);
      assert.ok(Math.abs(first.win_probability.a + first.win_probability.b - 1) < 1e-9);
      assert.equal(first.disclaimer, DISCLAIMER, 'disclaimer harus verbatim dari engine (AC-13)');
      assert.ok(first.primary_reason.trim() !== '', 'primary_reason tidak boleh kosong');
    }
  }

  assert.equal(pairs, values.length * (values.length - 1));
});

test('pilihan tidak sah ditolak dengan pesan yang dapat diperbaiki pengguna', () => {
  assert.throws(() => demoBattleInput('aster-vale/base', 'aster-vale/base', CONDITIONS), DemoDataError);
  assert.throws(() => demoBattleInput('tidak-ada/base', 'aster-vale/base', CONDITIONS), DemoDataError);
  assert.throws(() => demoBattleInput('tanpa-slash', 'aster-vale/base', CONDITIONS), DemoDataError);
});

test('view model demo memenuhi bentuk yang dipakai halaman', () => {
  const list = demoCharacterListItems();
  assert.ok(list.length >= 6);
  assert.ok(list.every((item) => item.tier_code), 'kartu daftar harus menampilkan tier di mode demo');
  assert.equal(demoCharacterListItems('kaal').length, 1);

  const detail = demoCharacterDetail('aster-vale', 'ascendant');
  assert.ok(detail);
  // `demoCharacterDetail` mengembalikan semua form; pemilihan form aktif dilakukan
  // loader (`loadCharacterDetail`) yang menambahkan `activeForm`.
  assert.equal(detail.forms.find((form) => form.slug === 'ascendant')?.tier_code, '5-B');
  assert.equal(
    detail.forms.some((form) => form.is_default),
    true,
    'setiap karakter demo harus punya form default',
  );
  assert.ok(detail.statistics.length > 0);
  assert.ok(detail.abilities.length > 0);
  assert.equal(detail.sources[0]?.source_name.length > 0, true);
  assert.ok(DEMO_NOTICE.includes('sintetis'), 'penanda demo harus menyebut datanya sintetis');

  assert.equal(demoCharacterDetail('tidak-ada'), null);

  const verse = demoVerseDetail('aetherion-saga');
  assert.ok(verse);
  assert.equal(verse.characters.length, 2);
  assert.ok(demoVerseDetail('tidak-ada') === null);
});

test('data demo tidak pernah menggantikan database sungguhan', async () => {
  const previous = process.env.ALLOW_DEMO_DATA;
  delete process.env.ALLOW_DEMO_DATA;
  try {
    assert.equal(demoEnabled(), false, 'default harus opt-in');
    await assert.rejects(loadCharacterList(), (error) => error instanceof DatabaseNotConfiguredError);

    process.env.ALLOW_DEMO_DATA = '1';
    assert.equal(demoEnabled(), true);
    const result = await loadCharacterList();
    assert.equal(result.source, 'demo');
  } finally {
    if (previous === undefined) delete process.env.ALLOW_DEMO_DATA;
    else process.env.ALLOW_DEMO_DATA = previous;
  }
});
