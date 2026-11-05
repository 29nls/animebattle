import type { NextConfig } from 'next';

/**
 * Konfigurasi Next.js.
 *
 * Catatan penting soal battle engine: seluruh modul engine mengimpor dengan
 * ekstensi `.ts` eksplisit (mis. `./engine.ts`) karena Node menjalankan TypeScript
 * dengan type stripping tanpa transform — jadi ekstensi wajib ada agar runner
 * `scripts/run-battle-cases.mjs` bisa memuatnya langsung. Turbopack meresolusi
 * spesifier dengan ekstensi eksplisit sebagai jalur berkas literal, sehingga
 * modul yang sama dipakai apa adanya oleh Node **dan** oleh bundel Next. Kalau
 * `next build` gagal pada impor `.ts`, itu berarti asumsi ini rusak — bukan
 * alasan untuk menduplikasi engine.
 */
const isProduction = process.env.NODE_ENV === 'production';

/**
 * CSP fase 1.
 *
 * `script-src 'unsafe-inline'` masih diperlukan karena halaman konten publik
 * dirender statis dan Next menyisipkan bootstrap script tanpa nonce. Nonce
 * per-request akan memaksa semua halaman menjadi dinamis; itu perubahan
 * arsitektur, bukan sekadar header. Batas ini dicatat di launch checklist agar
 * tidak diklaim sebagai CSP strict.
 *
 * `connect-src` mengizinkan Supabase karena login admin memakai SDK browser.
 * Tidak ada koneksi pihak ketiga lain dari browser; Sentry adalah server-only.
 */
function contentSecurityPolicy(): string {
  const scriptSrc = isProduction
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
  const connectSrc = isProduction
    ? "connect-src 'self' https://*.supabase.co wss://*.supabase.co"
    : "connect-src 'self' https://*.supabase.co wss://*.supabase.co ws: wss:";

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    scriptSrc,
    connectSrc,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self'",
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ].join('; ');
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  // Source map browser tidak dikirim ke publik. Sentry server tidak memakai
  // upload source map; stack trace server tetap terbaca dari nama fungsi.
  productionBrowserSourceMaps: false,
  // Halaman legal & karakter adalah konten publik; tidak ada alasan menyajikan
  // header teknologi server ke publik (PRD §28).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          ...(isProduction
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=63072000; includeSubDomains; preload',
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
