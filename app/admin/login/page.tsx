import type { Metadata } from 'next';
import Link from 'next/link';

import { adminPanelConfigured } from '@/features/admin/session.ts';
import { loginAction } from './actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Masuk Admin',
  description: 'Autentikasi panel admin Anime VS Battle.',
  robots: { index: false, follow: false },
};

const STATE_MESSAGES: Record<string, string> = {
  invalid: 'Token admin salah. Periksa kembali nilai ADMIN_INGESTION_SECRET.',
  rate_limited: 'Terlalu banyak percobaan. Tunggu satu menit sebelum mencoba lagi.',
  not_configured:
    'ADMIN_INGESTION_SECRET belum disetel. Panel admin sengaja gagal tertutup sampai secret dikonfigurasi.',
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const configured = adminPanelConfigured();
  const message = state ? STATE_MESSAGES[state] : undefined;

  return (
    <div className="mx-auto max-w-md py-12">
      <h1 className="text-2xl font-black text-ink-0">Masuk Panel Admin</h1>
      <p className="mt-2 text-sm text-ink-2">
        Panel ini menampilkan data operasional: antrian ingestion, error, dan konflik sumber.
        Autentikasinya memakai token yang sama dengan <code className="text-accent-b">ADMIN_INGESTION_SECRET</code>;
        setelah Supabase Auth terpasang (Sprint 4), halaman ini menjadi login berperan.
      </p>

      {message && (
        <div className="mt-4 rounded-lg border border-accent-flag/30 bg-accent-flag/10 p-3 text-sm text-accent-flag">
          {message}
        </div>
      )}

      {configured ? (
        <form action={loginAction} className="mt-6 space-y-3">
          <label className="block text-sm font-medium text-ink-1" htmlFor="token">
            Token admin
          </label>
          <input
            id="token"
            name="token"
            type="password"
            required
            autoComplete="current-password"
            className="input-field w-full"
            placeholder="Tempel token admin"
          />
          <button type="submit" className="btn-primary w-full text-sm">
            Masuk
          </button>
        </form>
      ) : (
        <div className="mt-6 rounded-lg border border-line bg-surface-1 p-4 text-sm text-ink-2">
          <p className="font-medium text-ink-0">Panel terkunci</p>
          <p className="mt-1">
            Setel <code className="text-accent-b">ADMIN_INGESTION_SECRET</code> pada environment server,
            lalu muat ulang halaman ini. Tanpa secret, tidak ada satu pun rute atau halaman admin yang
            dapat diakses — termasuk oleh pemilik sistem.
          </p>
        </div>
      )}

      <p className="mt-6 text-sm text-ink-3">
        <Link href="/" className="text-accent-b hover:underline">
          ← Kembali ke situs
        </Link>
      </p>
    </div>
  );
}
