import type { MetadataRoute } from 'next';

import { siteUrl } from '@/lib/site-url.ts';
import { getSqlClient, isDatabaseConfigured } from '@/lib/db/client.ts';
import { listPopularMatchups } from '@/features/battle/matchup-queries.ts';

/**
 * Sitemap dinamis (PRD §22 SEO).
 *
 * Hanya halaman statis dan **matchup populer** yang didaftarkan. Permalink
 * matchup dibuat untuk setiap pasangan form yang pernah disimulasikan, dan
 * jumlahnya tumbuh kombinatorial; mendaftarkan semuanya akan membanjiri indeks
 * dengan halaman hasil yang belum tentu pernah dibuka siapa pun. Ambangnya
 * diambil dari `mv_battle_popularity` — sumber yang sama dengan blok "Popular
 * Battles" di `/versus`, jadi sitemap tidak pernah menjanjikan halaman yang
 * tidak ditautkan dari mana pun.
 *
 * `force-dynamic` karena database tidak tersedia saat build: sitemap yang
 * di-prerender akan membeku pada daftar kosong sampai deployment berikutnya.
 */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // `siteUrl()` memperlakukan NEXT_PUBLIC_SITE_URL="" (bawaan .env.example)
  // sebagai belum diatur; tanpa itu setiap entri sitemap kehilangan originnya.
  const baseUrl = siteUrl();
  const lastModified = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified,
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${baseUrl}/characters`,
      lastModified,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/verses`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/versus`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/compare`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/legal/methodology`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.4,
    },
    {
      url: `${baseUrl}/legal/terms`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ];

  // Database belum dikonfigurasi atau view belum di-refresh bukan alasan
  // sitemap gagal: halaman statis tetap sah, dan `robots.txt` tetap menunjuk
  // berkas ini. Kegagalan dicatat supaya operator melihatnya di log, bukan
  // disembunyikan.
  // Database yang memang belum diisi bukan kegagalan: itu keadaan normal pada
  // build/demo lokal, dan mencatatnya sebagai galat membuat log operator penuh
  // stack trace yang tidak dapat ditindaklanjuti. Kegagalan **setelah**
  // dikonfigurasi tetap dicatat.
  let popular: Awaited<ReturnType<typeof listPopularMatchups>> = [];
  if (isDatabaseConfigured()) {
    try {
      popular = await listPopularMatchups(getSqlClient(), 50);
    } catch (error) {
      console.error('[sitemap] daftar matchup populer tidak dapat dibaca:', error);
    }
  }

  const matchupPages: MetadataRoute.Sitemap = popular.map((matchup) => ({
    url: `${baseUrl}/versus/${matchup.slug}`,
    lastModified: new Date(matchup.lastSimulatedAt),
    changeFrequency: 'weekly',
    priority: 0.6,
  }));

  return [...staticPages, ...matchupPages];
}
