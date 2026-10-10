import type { MetadataRoute } from 'next';

import { siteUrl } from '@/lib/site-url.ts';

/**
 * Sitemap dinamis (PRD §22 SEO). Di MVP, menghasilkan URL statis.
 * Sprint 5 akan menambahkan query database untuk semua karakter/verse.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  // `siteUrl()` memperlakukan NEXT_PUBLIC_SITE_URL="" (bawaan .env.example)
  // sebagai belum diatur; tanpa itu setiap entri sitemap kehilangan originnya.
  const baseUrl = siteUrl();

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${baseUrl}/characters`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/verses`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/versus`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/compare`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/legal/methodology`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.4,
    },
    {
      url: `${baseUrl}/legal/terms`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ];

  // Sprint 5: Tambahkan semua URL karakter dan verse dari database
  // const characters = await getCharacterSlugs();
  // const characterPages = characters.map(slug => ({
  //   url: `${baseUrl}/character/${slug}`,
  //   lastModified: new Date(),
  //   changeFrequency: 'weekly' as const,
  //   priority: 0.7,
  // }));

  return staticPages;
}
