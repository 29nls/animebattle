import type { MetadataRoute } from 'next';

/**
 * robots.txt (PRD §22 SEO).
 * Izinkan semua crawler mengakses halaman publik.
 * Larang crawling admin dan API routes.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

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
