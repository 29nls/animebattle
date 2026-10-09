import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * Layout akar `/admin`.
 *
 * Isinya sengaja tipis: hanya `noindex`. Sidebar dan penjaga sesi tinggal di
 * `(dashboard)/layout.tsx`, sedangkan halaman login berada di luar group itu —
 * sehingga halaman login tidak ikut menampilkan navigasi panel yang belum boleh
 * dibuka, dan tidak ikut terkena redirect penjaga sesi (yang akan membuat
 * lingkaran tak berujung).
 */
// PRD §27: /admin/* wajib noindex — robots.txt saja tidak mencegah pengindeksan
// URL yang tertaut dari luar.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return children;
}
