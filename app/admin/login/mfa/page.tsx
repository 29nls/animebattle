import type { Metadata } from 'next';
import Link from 'next/link';

import { isAdminAuthConfigured } from '@/features/admin/auth.ts';
import { mfaAction } from '../actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Verifikasi MFA Admin',
  description: 'Verifikasi TOTP untuk sesi admin.',
  robots: { index: false, follow: false },
};

const STATE_MESSAGES: Record<string, string> = {
  required: 'Peran admin/owner mewajibkan MFA. Masukkan kode TOTP dari aplikasi authenticator.',
  invalid: 'Kode TOTP tidak sah atau sudah kedaluwarsa.',
  not_enrolled:
    'Akun admin ini belum memiliki faktor TOTP terverifikasi. Daftarkan faktor di Supabase Auth sebelum masuk.',
  rate_limited: 'Terlalu banyak percobaan. Tunggu satu menit sebelum mencoba lagi.',
};

export default async function AdminMfaPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const message = state ? STATE_MESSAGES[state] : undefined;

  return (
    <div className="mx-auto max-w-md py-12">
      <h1 className="text-2xl font-black text-ink-0">Verifikasi MFA</h1>
      <p className="mt-2 text-sm text-ink-2">
        Masukkan enam digit dari aplikasi authenticator. Sesi akan naik ke AAL2 sebelum panel admin
        dapat diakses.
      </p>

      {message && (
        <div className="mt-4 rounded-lg border border-accent-flag/30 bg-accent-flag/10 p-3 text-sm text-accent-flag">
          {message}
        </div>
      )}

      {isAdminAuthConfigured() ? (
        <form action={mfaAction} className="mt-6 space-y-3">
          <label className="block text-sm font-medium text-ink-1" htmlFor="code">
            Kode TOTP
          </label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            required
            autoComplete="one-time-code"
            className="input-field w-full font-mono tracking-[0.35em]"
            placeholder="000000"
          />
          <button type="submit" className="btn-primary w-full text-sm">
            Verifikasi
          </button>
        </form>
      ) : (
        <div className="mt-6 rounded-lg border border-line bg-surface-1 p-4 text-sm text-ink-2">
          Supabase Auth belum dikonfigurasi; verifikasi MFA tidak tersedia.
        </div>
      )}

      <p className="mt-6 text-sm text-ink-3">
        <Link href="/admin/login" className="text-accent-b hover:underline">
          ← Kembali ke login
        </Link>
      </p>
    </div>
  );
}
