import { parseMatchupSlug } from '@/features/battle/share.ts';

// SVG 1200x630 murni: tidak membutuhkan runtime Satori/WASM/font-biner,
// sehingga kompatibel 100% dengan Cloudflare Workers tanpa modul .bin.
const WIDTH = 1200;
const HEIGHT = 630;

function pretty(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ matchup: string[] }> },
): Promise<Response> {
  const { matchup } = await params;
  const parsed = parseMatchupSlug(matchup.join('/'));

  if (!parsed) return new Response('Matchup tidak ditemukan', { status: 404 });

  const left = escapeXml(pretty(parsed.sideA.characterSlug));
  const right = escapeXml(pretty(parsed.sideB.characterSlug));
  const leftForm = escapeXml(pretty(parsed.sideA.formSlug));
  const rightForm = escapeXml(pretty(parsed.sideB.formSlug));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0b1020"/>
      <stop offset="55%" stop-color="#1b2340"/>
      <stop offset="100%" stop-color="#2a1b3d"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <text x="600" y="100" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="26" font-weight="600" letter-spacing="6" fill="#f5f7ff" opacity="0.65">ANIME VS BATTLE</text>
  
  <!-- Left Fighter -->
  <text x="510" y="290" text-anchor="end" font-family="system-ui, -apple-system, sans-serif" font-size="56" font-weight="800" fill="#f5f7ff">${left}</text>
  <text x="510" y="335" text-anchor="end" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="400" fill="#f5f7ff" opacity="0.7">${leftForm}</text>
  
  <!-- VS Circle -->
  <circle cx="600" cy="300" r="48" fill="none" stroke="rgba(245,247,255,0.35)" stroke-width="2"/>
  <text x="600" y="311" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="30" font-weight="700" fill="#f5f7ff">VS</text>
  
  <!-- Right Fighter -->
  <text x="690" y="290" text-anchor="start" font-family="system-ui, -apple-system, sans-serif" font-size="56" font-weight="800" fill="#f5f7ff">${right}</text>
  <text x="690" y="335" text-anchor="start" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="400" fill="#f5f7ff" opacity="0.7">${rightForm}</text>
  
  <text x="600" y="520" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="24" fill="#f5f7ff" opacity="0.6">Simulasi deterministik dengan rujukan data</text>
</svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
    },
  });
}
