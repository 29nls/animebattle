/**
 * Penjaga keadaan antarmuka dan bahasa.
 *
 * Halaman tidak dapat dirender di `node --test` (JSX), tetapi kontrak yang mudah
 * hilang dapat diperiksa dari sumbernya: setiap halaman data wajib memasang
 * atribusi, route wajib punya keadaan memuat/galat, dan label Inggris yang sudah
 * diterjemahkan tidak boleh kembali. Test ini sengaja membaca teks sumber, bukan
 * menjalankan Next.
 *
 * Jalankan: npm run test:web
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const source = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

const exists = (path: string): boolean =>
  existsSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)));

/** Halaman yang menampilkan fakta dari database dan karenanya wajib beratribusi. */
const DATA_PAGES = [
  'app/page.tsx',
  'app/characters/page.tsx',
  'app/verses/page.tsx',
  'app/verse/[slug]/page.tsx',
  'app/versus/page.tsx',
  'app/versus/result/page.tsx',
  'app/versus/[...matchup]/page.tsx',
  'app/compare/page.tsx',
];

describe('keadaan memuat, galat, dan offline', () => {
  it('route memiliki skeleton pemuatan server dengan status pembaca layar', () => {
    assert.equal(exists('app/loading.tsx'), true, 'app/loading.tsx harus ada');
    const loading = source('app/loading.tsx');
    assert.match(loading, /PageSkeleton/);
    assert.match(loading, /Memuat halaman/);

    const skeleton = source('src/components/page-skeleton.tsx');
    assert.match(skeleton, /role="status"/);
    assert.match(skeleton, /aria-busy="true"/);
    assert.match(skeleton, /aria-live="polite"/);
  });

  it('route memiliki batas galat yang dapat dicoba ulang', () => {
    assert.equal(exists('app/error.tsx'), true, 'app/error.tsx harus ada');
    const errorPage = source('app/error.tsx');
    assert.match(errorPage, /^'use client';/);
    assert.match(errorPage, /reset/);
    assert.match(errorPage, /role="alert"/);
    assert.match(errorPage, /Coba lagi/);
    assert.match(errorPage, /Kembali ke beranda/);
  });

  it('banner offline memakai status jaringan browser tanpa melakukan fetch', () => {
    const banner = source('src/components/offline-banner.tsx');
    assert.match(banner, /navigator\.onLine/);
    assert.match(banner, /addEventListener\('online'/);
    assert.match(banner, /addEventListener\('offline'/);
    assert.match(banner, /role="status"/);
    assert.doesNotMatch(banner, /\bfetch\(/, 'banner offline tidak boleh melakukan fetch');
    assert.match(source('app/layout.tsx'), /<OfflineBanner \/>/);
  });
});

describe('atribusi sumber', () => {
  it('setiap halaman data memuat atribusi dan menanganinya sebagai bahan opsional', () => {
    for (const page of DATA_PAGES) {
      const pageSource = source(page);
      assert.match(pageSource, /loadAttribution\(/, `${page}: harus membaca atribusi`);
      assert.match(pageSource, /<DataAttribution/, `${page}: harus menampilkan atribusi`);
      assert.match(
        pageSource,
        /attribution=\{attribution\}/,
        `${page}: atribusi diteruskan sebagai prop`,
      );
    }
  });

  it('komponen atribusi membedakan database, demo, tidak tersedia, dan gagal', () => {
    const component = source('src/components/data-attribution.tsx');
    for (const status of ['database', 'demo', 'unavailable', 'failed']) {
      assert.match(component, new RegExp(`status === '${status}'`), `status ${status} hilang`);
    }
    assert.match(component, /Sumber &amp; lisensi data/);
    assert.match(component, /Lisensi:/);
    assert.match(component, /aria-labelledby="sumber-lisensi-data"/);
    assert.match(component, /rel="nofollow noopener"/);
  });

  it('kegagalan atribusi tidak menjatuhkan halaman data', () => {
    const queries = source('src/features/attribution/queries.ts');
    assert.match(queries, /catch \(error\)/);
    assert.match(queries, /status: 'failed'/);
    assert.match(queries, /status: 'unavailable'/);
    assert.match(queries, /status: 'demo'/);
  });
});

describe('bahasa dan aksesibilitas dasar', () => {
  it('dokumen berbahasa Indonesia dan menyediakan tautan lewati navigasi', () => {
    const layout = source('app/layout.tsx');
    assert.match(layout, /<html lang="id">/);
    assert.match(layout, /href="#konten-utama"/);
    assert.match(layout, /id="konten-utama"/);
    assert.match(layout, /Lewati ke konten utama/);
    assert.match(layout, /aria-label="Navigasi utama"/);
  });

  it('setiap halaman data memiliki satu judul utama', () => {
    for (const page of DATA_PAGES) {
      assert.match(source(page), /<h1\b/, `${page}: tidak memiliki <h1>`);
    }
  });

  it('tidak memuat lagi label Inggris yang sudah diterjemahkan', () => {
    const forbidden = [
      /Score Breakdown/,
      /\bWinner\b/,
      /Fighters/,
      /Simulate Battle/,
      /Character Database/,
      /Layered Battle Engine/,
      /Popular Battles/,
      /Terms of Use/,
      /Takedown Request/,
      /No characters found/,
      /Loading/,
      /Something went wrong/,
    ];

    for (const page of [...DATA_PAGES, 'app/legal/terms/page.tsx', 'app/legal/takedown/page.tsx']) {
      const pageSource = source(page);
      for (const pattern of forbidden) {
        assert.doesNotMatch(pageSource, pattern, `${page}: label Inggris kembali muncul: ${pattern}`);
      }
    }
  });

  it('halaman takedown mengirim laporan ke rute yang menyimpannya sebagai tiket', () => {
    const takedown = source('app/legal/takedown/page.tsx');
    const form = source('src/components/takedown-form.tsx');
    assert.match(takedown, /<TakedownForm\b/, 'halaman harus memakai formulir yang benar-benar mengirim');
    assert.match(takedown, /Kanal aktif/);
    assert.match(takedown, /kode tiket/);
    assert.match(form, /fetch\('\/api\/legal\/takedown'/);
    assert.match(form, /response\.status === 201/);
    assert.match(form, /payload\?\.data\?\.ticket_code/);
    assert.match(form, /Simpan kode tiket/);
    assert.doesNotMatch(takedown, /@[a-z0-9.-]+\.(com|org|net)/i, 'jangan menampilkan alamat surel yang tidak dipantau');
  });

  it('metodologi menyatakan hasil adalah simulasi probabilistik, bukan kanon', () => {
    const methodology = source('app/legal/methodology/page.tsx');
    assert.match(methodology, /simulasi probabilistik/i);
    assert.match(methodology, /bukan (hasil )?kanon|bukan klaim kanon/i);
    assert.match(methodology, /Sumber &amp; lisensi|sumber/i);
  });
});
