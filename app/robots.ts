import type { MetadataRoute } from 'next';

import { siteUrl } from '@/lib/site-url.ts';

/**
 * robots.txt (PRD §22 SEO).
 * Izinkan semua crawler mengakses halaman publik.
 * Larang crawling admin dan API routes.
 */
export default function robots(): MetadataRoute.Robots {
  // `siteUrl()` memperlakukan NEXT_PUBLIC_SITE_URL="" (bawaan .env.example)
  // sebagai belum diatur; tanpa itu sitemap tertulis sebagai "/sitemap.xml".
  const baseUrl = siteUrl();

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin/', '/api/', '/versus/result'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
