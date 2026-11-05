import { ImageResponse } from 'next/og';

import { parseMatchupSlug } from '@/features/battle/share.ts';

// Tanpa `dynamic`: route dengan parameter dinamis dirender per permintaan,
// dan pengulangan dicegah oleh header cache di bawah. `force-static` akan
// membekukan satu gambar untuk semua slug.
const SIZE = { width: 1200, height: 630 };

/**
 * OG image per matchup.
 *
 * Kenapa route handler, bukan `opengraph-image.tsx` di sebelah halaman: slug
 * kanonik berbentuk `karakter/form-vs-karakter/form`, sehingga halaman memakai
 * segmen catch-all. Next.js menolak konvensi `opengraph-image` di bawah
 * catch-all ("Catch-all must be the last part of the URL"), jadi gambar sosial
 * dipasang di `/og/versus/[...matchup]` dan ditautkan lewat
 * `openGraph.images` pada metadata halaman.
 *
 * Sengaja tidak memuat database: metadata dan gambar sosial dibaca perayap
 * lebih sering daripada pengunjung, dan kegagalan database tidak boleh membuat
 * pratinjau tautan menjadi 500. Karena itu yang ditampilkan hanya dua nama dari
 * slug — angka pemenang tetap ada di halaman, bukan di gambar yang dapat
 * terlanjur dibagikan sebelum hasilnya berubah.
 */
function pretty(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ matchup: string[] }> },
): Promise<Response> {
  const { matchup } = await params;
  const parsed = parseMatchupSlug(matchup.join('/'));
  // Halaman matchup untuk slug ini 404, jadi tidak ada tautan sah yang
  // membutuhkannya. Menjawab 404 mencegah perayap mengindeks gambar generik
  // yang sama untuk ribuan URL sampah.
  if (!parsed) return new Response('Matchup tidak ditemukan', { status: 404 });

  const left = pretty(parsed.sideA.characterSlug);
  const right = pretty(parsed.sideB.characterSlug);
  const leftForm = pretty(parsed.sideA.formSlug);
  const rightForm = pretty(parsed.sideB.formSlug);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          background: 'linear-gradient(135deg, #0b1020 0%, #1b2340 55%, #2a1b3d 100%)',
          color: '#f5f7ff',
          fontFamily: 'sans-serif',
          padding: '64px',
        }}
      >
        <div style={{ fontSize: 26, letterSpacing: 6, textTransform: 'uppercase', opacity: 0.65 }}>
          Anime VS Battle
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 40,
            marginTop: 48,
            width: '100%',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flex: 1 }}>
            <div style={{ fontSize: 64, fontWeight: 800, textAlign: 'right', lineHeight: 1.05 }}>
              {left}
            </div>
            <div style={{ fontSize: 26, opacity: 0.7, marginTop: 8 }}>{leftForm}</div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 96,
              height: 96,
              borderRadius: 999,
              border: '2px solid rgba(245,247,255,0.35)',
              fontSize: 30,
              fontWeight: 700,
            }}
          >
            VS
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', flex: 1 }}>
            <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.05 }}>{right}</div>
            <div style={{ fontSize: 26, opacity: 0.7, marginTop: 8 }}>{rightForm}</div>
          </div>
        </div>

        <div style={{ marginTop: 56, fontSize: 24, opacity: 0.6 }}>
          Simulasi deterministik dengan rujukan data
        </div>
      </div>
    ),
    {
      ...SIZE,
      headers: {
        // Nama file memuat slug, tetapi header ini tetap eksplisit: CDN tidak
        // boleh menyajikan gambar matchup lain setelah data berubah.
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      },
    },
  );
}
