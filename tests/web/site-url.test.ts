/**
 * Penjaga regresi base URL situs.
 *
 * Kenapa: `.env.example` menetapkan `NEXT_PUBLIC_SITE_URL=""`. String kosong
 * bukan nullish, jadi `process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'`
 * melewatinya dan `new URL('')` melempar `TypeError: Invalid URL` saat modul
 * `app/layout.tsx` dievaluasi — seluruh halaman dinamis menjawab HTTP 500
 * sementara halaman statis tetap 200. Test ini mengunci arti "kosong = belum
 * diatur" dan memastikan nilai yang dikembalikan selalu dapat dibentuk `URL`.
 *
 * Jalankan: npm run test:web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SITE_URL, siteUrl } from '../../src/lib/site-url.ts';

/** Jalankan `run` dengan NEXT_PUBLIC_SITE_URL disetel sementara, lalu kembalikan. */
function withSiteUrl(value: string | undefined, run: () => void): void {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  if (value === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = value;

  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
}

test('NEXT_PUBLIC_SITE_URL kosong atau spasi dianggap belum diatur', () => {
  withSiteUrl('', () => assert.equal(siteUrl(), DEFAULT_SITE_URL));
  withSiteUrl('   ', () => assert.equal(siteUrl(), DEFAULT_SITE_URL));
  withSiteUrl(undefined, () => assert.equal(siteUrl(), DEFAULT_SITE_URL));
});

test('NEXT_PUBLIC_SITE_URL terisi dipakai apa adanya dengan spasi pinggir dipangkas', () => {
  withSiteUrl('https://animebattle.example', () =>
    assert.equal(siteUrl(), 'https://animebattle.example'),
  );
  withSiteUrl('  https://animebattle.example  ', () =>
    assert.equal(siteUrl(), 'https://animebattle.example'),
  );
});

test('nilai kembalian selalu dapat dibentuk URL (metadataBase layout tidak melempar)', () => {
  for (const value of ['', '   ', undefined, 'https://animebattle.example']) {
    withSiteUrl(value, () => assert.doesNotThrow(() => new URL(siteUrl()), `nilai: ${String(value)}`));
  }
});
