import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { siteUrl } from '@/lib/site-url.ts';
import { OfflineBanner } from '@/components/offline-banner.tsx';
import './globals.css';

/**
 * Metadata dasar. Setiap halaman menimpanya dengan `title`/`description` sendiri;
 * nilai di sini adalah jaring pengaman, bukan pengganti (PRD §27: judul harus unik).
 *
 * Bahasa antarmuka adalah **Indonesia** (keputusan D23, PRD §Lampiran Decision
 * Log): dokumen produk berbahasa Indonesia, dan mencampur label Inggris di
 * tengahnya membuat pengguna harus menerjemahkan sendiri istilah seperti
 * "Score Breakdown" atau "Winner". Tidak ada mekanisme i18n dua bahasa pada MVP —
 * menambahkannya tanpa penerjemah dan pengujian konten hanya akan menghasilkan
 * bahasa yang tidak konsisten.
 */
export const metadata: Metadata = {
  title: {
    default: 'Anime VS Battle — Siapa yang Menang?',
    template: '%s — Anime VS Battle',
  },
  description:
    'Bandingkan karakter fiksi dan simulasikan pertarungannya. Statistik, kemampuan, resistensi, dan kondisi pertarungan dengan sumber yang dapat ditelusuri.',
  // `siteUrl()` (bukan `??` langsung): NEXT_PUBLIC_SITE_URL="" adalah nilai
  // bawaan .env.example dan bukan nullish, sehingga `??` melewatinya dan
  // `new URL('')` melempar → setiap halaman dinamis menjawab 500.
  metadataBase: new URL(siteUrl()),
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'Anime VS Battle',
    title: 'Anime VS Battle — Siapa yang Menang?',
    description:
      'Pilih dua karakter, pilih form-nya, lalu lihat analisis mengapa salah satunya lebih unggul.',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#1a1a2e',
  width: 'device-width',
  initialScale: 1,
};

const NAV_LINKS = [
  { href: '/characters', label: 'Karakter', mobile: true },
  { href: '/verses', label: 'Verse', mobile: false },
  { href: '/versus', label: 'Bertarung', mobile: true },
  { href: '/compare', label: 'Bandingkan', mobile: false },
  { href: '/legal/methodology', label: 'Tentang', mobile: false },
] as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body className="antialiased">
        <a
          href="#konten-utama"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-surface-1 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink-0 focus:shadow-card"
        >
          Lewati ke konten utama
        </a>

        {/* ─── Navbar ─── */}
        <header className="sticky top-0 z-50 border-b border-line/40 glass-strong">
          <nav
            aria-label="Navigasi utama"
            className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6"
          >
            <a href="/" className="group flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-a to-accent-b shadow-lg"
              >
                <span className="text-sm font-black tracking-tight text-white">VS</span>
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-bold tracking-tight text-ink-0 transition-colors group-hover:text-gradient-hero">
                  Anime VS Battle
                </span>
                <span className="hidden text-[0.6rem] uppercase leading-none tracking-widest text-ink-3 sm:block">
                  Siapa yang menang?
                </span>
              </span>
            </a>

            <div className="flex items-center gap-1 text-sm sm:gap-2">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className={`rounded-lg px-2.5 py-1.5 text-ink-2 transition-all hover:bg-surface-2 hover:text-ink-0 sm:px-3 ${
                    link.mobile ? '' : 'hidden sm:inline-flex'
                  }`}
                >
                  {link.label}
                </a>
              ))}
              <a href="/versus" className="btn-primary ml-1 px-3 py-1.5 text-xs sm:ml-2">
                Mulai simulasi
              </a>
            </div>
          </nav>
        </header>

        <OfflineBanner />

        {/* ─── Main ─── */}
        <main id="konten-utama" className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
          {children}
        </main>

        {/* ─── Footer ─── */}
        <footer className="mt-16 border-t border-line/40">
          <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
            <div className="grid gap-8 sm:grid-cols-3">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-accent-a to-accent-b"
                  >
                    <span className="text-[0.65rem] font-black text-white">VS</span>
                  </span>
                  <span className="text-sm font-bold text-ink-0">Anime VS Battle</span>
                </div>
                <p className="mt-3 max-w-xs text-xs leading-relaxed text-ink-3">
                  Proyek independen. Nama karakter, judul, dan gambar adalah milik pemegang hak
                  masing-masing dan digunakan untuk referensi serta analisis.
                </p>
              </div>

              <div>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-2">
                  Jelajahi
                </h2>
                <ul className="space-y-2 text-xs">
                  <li>
                    <a className="text-ink-3 transition-colors hover:text-ink-0" href="/characters">
                      Database karakter
                    </a>
                  </li>
                  <li>
                    <a className="text-ink-3 transition-colors hover:text-ink-0" href="/verses">
                      Daftar verse
                    </a>
                  </li>
                  <li>
                    <a className="text-ink-3 transition-colors hover:text-ink-0" href="/versus">
                      Simulasi pertarungan
                    </a>
                  </li>
                  <li>
                    <a className="text-ink-3 transition-colors hover:text-ink-0" href="/compare">
                      Bandingkan statistik
                    </a>
                  </li>
                </ul>
              </div>

              <div>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-2">
                  Tentang &amp; legal
                </h2>
                <ul className="space-y-2 text-xs">
                  <li>
                    <a
                      className="text-ink-3 transition-colors hover:text-ink-0"
                      href="/legal/methodology"
                    >
                      Metodologi &amp; keterbatasan
                    </a>
                  </li>
                  <li>
                    <a className="text-ink-3 transition-colors hover:text-ink-0" href="/legal/terms">
                      Ketentuan penggunaan
                    </a>
                  </li>
                  <li>
                    <a
                      className="text-ink-3 transition-colors hover:text-ink-0"
                      href="/legal/takedown"
                    >
                      Permintaan takedown
                    </a>
                  </li>
                </ul>
              </div>
            </div>

            <div className="mt-8 border-t border-line/30 pt-6 text-center">
              <p className="mx-auto max-w-2xl text-[0.65rem] leading-relaxed text-ink-3">
                Hasil pertarungan adalah simulasi probabilistik dari statistik, kemampuan,
                resistensi, asumsi, dan kondisi yang dipilih — bukan hasil resmi, bukan klaim kanon.
                Data diambil dari sumber publik yang tercantum di setiap halaman data.
              </p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
