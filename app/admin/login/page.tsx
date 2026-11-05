import type { Metadata } from 'next';
import Link from 'next/link';

import { isAdminAuthConfigured } from '@/features/admin/auth.ts';
import { loginAction } from './actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Masuk Admin',
  description: 'Autentikasi Supabase untuk panel admin Anime VS Battle.',
  robots: { index: false, follow: false },
};

const STATE_MESSAGES: Record<string, string> = {
  invalid: 'Email atau kata sandi salah. Periksa kembali kredensial akun admin.',
  rate_limited: 'Terlalu banyak percobaan. Tunggu satu menit sebelum mencoba lagi.',
  not_configured:
    'Supabase Auth belum dikonfigurasi. Panel admin sengaja gagal tertutup sampai URL dan anon key diisi.',
  expired: 'Sesi kedaluwarsa. Silakan masuk kembali.',
  login_required: 'Masuk untuk membuka panel admin.',
  forbidden: 'Akun ini tidak memiliki peran admin yang sesuai.',
  unavailable: 'Sesi tidak dapat diverifikasi saat ini. Coba lagi setelah database tersedia.',
  signed_out: 'Kamu sudah keluar dari panel admin.',
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const configured = isAdminAuthConfigured();
  const message = state ? STATE_MESSAGES[state] : undefined;

  return (
    <div className="mx-auto max-w-md py-12">
      <h1 className="text-2xl font-black text-ink-0">Masuk Panel Admin</h1>
      <p className="mt-2 text-sm text-ink-2">
        Autentikasi memakai Supabase Auth. Hanya akun dengan peran{' '}
        <code className="text-accent-b">viewer</code>, <code className="text-accent-b">editor</code>,{' '}
        <code className="text-accent-b">admin</code>, atau <code className="text-accent-b">owner</code>{' '}
        yang dapat masuk. Admin dan owner wajib menyelesaikan verifikasi TOTP.
      </p>

      {message && (
        <div className="mt-4 rounded-lg border border-accent-flag/30 bg-accent-flag/10 p-3 text-sm text-accent-flag">
          {message}
        </div>
      )}

      {configured ? (
        <form action={loginAction} className="mt-6 space-y-3">
          <label className="block text-sm font-medium text-ink-1" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="username"
            className="input-field w-full"
            placeholder="nama@domain.tld"
          />
          <label className="block text-sm font-medium text-ink-1" htmlFor="password">
            Kata sandi
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="input-field w-full"
          />
          <button type="submit" className="btn-primary w-full text-sm">
            Masuk
          </button>
        </form>
      ) : (
        <div className="mt-6 rounded-lg border border-line bg-surface-1 p-4 text-sm text-ink-2">
          <p className="font-medium text-ink-0">Panel terkunci</p>
          <p className="mt-1">
            Setel <code className="text-accent-b">NEXT_PUBLIC_SUPABASE_URL</code> dan{' '}
            <code className="text-accent-b">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> pada environment server.
            Tanpa keduanya, tidak ada satu pun rute atau halaman admin yang dapat diakses.
          </p>
        </div>
      )}

      <p className="mt-4 text-sm text-ink-3">
        Sudah masuk tetapi diminta MFA?{' '}
        <Link href="/admin/login/mfa" className="text-accent-b hover:underline">
          Buka verifikasi TOTP
        </Link>
      </p>

      <p className="mt-6 text-sm text-ink-3">
        <Link href="/" className="text-accent-b hover:underline">
          ← Kembali ke situs
        </Link>
      </p>
    </div>
  );
}
