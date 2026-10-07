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
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
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
        ],
      },
    ];
  },
};

export default nextConfig;
