import type { Metadata } from 'next';
import type { ReactNode } from 'react';

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
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body className="antialiased">
        <header className="border-b border-line/60">
          <nav
            aria-label="Navigasi utama"
            className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3 text-sm"
          >
            <span className="font-semibold tracking-tight text-ink-0">Anime VS Battle</span>
            <a className="text-ink-2 hover:text-ink-0" href="/characters">
              Characters
            </a>
            <a className="text-ink-2 hover:text-ink-0" href="/versus">
              Versus
            </a>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 py-8 text-xs text-ink-3">
          <p>
            Hasil pertarungan adalah simulasi analitis dari statistik, kemampuan, resistances,
            asumsi, dan kondisi yang dipilih — bukan hasil resmi dan bukan klaim kanon.
          </p>
        </footer>
      </body>
    </html>
  );
}
