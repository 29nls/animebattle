import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { siteUrl } from '@/lib/site-url.ts';
import './globals.css';

/**
 * Metadata dasar. Setiap halaman menimpanya dengan `title`/`description` sendiri;
 * nilai di sini adalah jaring pengaman, bukan pengganti (PRD §27: judul harus unik).
 */
export const metadata: Metadata = {
  title: {
    default: 'Anime VS Battle — Who Would Win?',
    template: '%s — Anime VS Battle',
  },
  description:
    'Compare thousands of fictional characters and simulate the battle. Statistik, abilities, resistances, dan kondisi pertarungan dengan sumber yang dapat ditelusuri.',
  // `siteUrl()` (bukan `??` langsung): NEXT_PUBLIC_SITE_URL="" adalah nilai
  // bawaan .env.example dan bukan nullish, sehingga `??` melewatinya dan
  // `new URL('')` melempar → setiap halaman dinamis menjawab 500.
  metadataBase: new URL(siteUrl()),
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'Anime VS Battle',
    title: 'Anime VS Battle — Who Would Win?',
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body className="antialiased">
        {/* ─── Navbar ─── */}
        <header className="sticky top-0 z-50 border-b border-line/40 glass-strong">
          <nav
            aria-label="Navigasi utama"
            className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6"
          >
            <a href="/" className="flex items-center gap-2.5 group">
              {/* Logo mark */}
              <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-a to-accent-b shadow-lg">
                <span className="text-sm font-black text-white tracking-tight">VS</span>
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-bold tracking-tight text-ink-0 group-hover:text-gradient-hero transition-colors">
                  Anime VS Battle
                </span>
                <span className="text-[0.6rem] uppercase tracking-widest text-ink-3 leading-none hidden sm:block">
                  Who Would Win?
                </span>
              </div>
            </a>

            <div className="flex items-center gap-1 sm:gap-2 text-sm">
              <a
                className="rounded-lg px-3 py-1.5 text-ink-2 transition-all hover:bg-surface-2 hover:text-ink-0"
                href="/characters"
              >
                Database
              </a>
              <a
                className="rounded-lg px-3 py-1.5 text-ink-2 transition-all hover:bg-surface-2 hover:text-ink-0 hidden sm:inline-flex"
                href="/verses"
              >
                Verses
              </a>
              <a
                className="rounded-lg px-3 py-1.5 text-ink-2 transition-all hover:bg-surface-2 hover:text-ink-0"
                href="/versus"
              >
                Battle
              </a>
              <a
                className="rounded-lg px-3 py-1.5 text-ink-2 transition-all hover:bg-surface-2 hover:text-ink-0 hidden sm:inline-flex"
                href="/compare"
              >
                Compare
              </a>
              <a
                className="btn-primary ml-2 text-xs !py-1.5 !px-3"
                href="/versus"
              >
                ⚔️ Fight
              </a>
            </div>
          </nav>
        </header>

        {/* ─── Main ─── */}
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">{children}</main>

        {/* ─── Footer ─── */}
        <footer className="border-t border-line/40 mt-16">
          <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
            <div className="grid gap-8 sm:grid-cols-3">
              {/* Brand */}
              <div>
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-accent-a to-accent-b">
                    <span className="text-[0.65rem] font-black text-white">VS</span>
                  </div>
                  <span className="text-sm font-bold text-ink-0">Anime VS Battle</span>
                </div>
                <p className="mt-3 text-xs text-ink-3 leading-relaxed max-w-xs">
                  Anime VS Battle adalah proyek independen. Nama karakter, judul, dan gambar adalah milik
                  pemegang hak masing-masing dan digunakan untuk keperluan referensi/informasi.
                </p>
              </div>

              {/* Navigation */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-2 mb-3">Navigasi</h3>
                <ul className="space-y-2 text-xs">
                  <li><a className="text-ink-3 hover:text-ink-0 transition-colors" href="/characters">Character Database</a></li>
                  <li><a className="text-ink-3 hover:text-ink-0 transition-colors" href="/versus">Battle Simulator</a></li>
                  <li><a className="text-ink-3 hover:text-ink-0 transition-colors" href="/compare">Compare Characters</a></li>
                </ul>
              </div>

              {/* Legal */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-2 mb-3">Legal</h3>
                <ul className="space-y-2 text-xs">
                  <li><a className="text-ink-3 hover:text-ink-0 transition-colors" href="/legal/terms">Terms of Use</a></li>
                  <li><a className="text-ink-3 hover:text-ink-0 transition-colors" href="/legal/methodology">Methodology</a></li>
                  <li><a className="text-ink-3 hover:text-ink-0 transition-colors" href="/legal/takedown">Takedown Request</a></li>
                </ul>
              </div>
            </div>

            <div className="mt-8 border-t border-line/30 pt-6 text-center">
              <p className="text-[0.65rem] text-ink-3 leading-relaxed max-w-2xl mx-auto">
                Hasil pertarungan adalah simulasi analitis dari statistik, kemampuan, resistances,
                asumsi, dan kondisi yang dipilih — bukan hasil resmi dan bukan klaim kanon.
                Data diambil dari sumber publik yang tercantum di setiap halaman.
              </p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
