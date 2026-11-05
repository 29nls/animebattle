'use server';

/**
 * Server action login/logout panel admin.
 *
 * Login memakai email + password Supabase Auth. Admin/owner yang sudah
 * terdaftar faktor TOTP harus menyelesaikan `mfaAction` sebelum guard memberi
 * akses (AAL2). Tidak ada shared secret di UI.
 *
 * Semua kegagalan autentikasi dikembalikan sebagai pesan generik: membedakan
 * "email tidak ada" dan "password salah" memberi oracle enumerasi akun.
 */

import type { Route } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { isAdminAuthConfigured } from '@/features/admin/auth.ts';
import { createSupabaseServerClient } from '@/features/admin/auth-server.ts';
import { checkLoginRateLimit } from '@/features/admin/login.ts';

function clientIp(headersBag: { get(name: string): string | null }): string {
  const forwarded = headersBag.get('x-forwarded-for');
  if (forwarded !== null) {
    const first = forwarded.split(',')[0]?.trim() ?? '';
    if (first !== '') return first;
  }
  return headersBag.get('x-real-ip')?.trim() || 'unknown-client';
}

export async function loginAction(formData: FormData): Promise<void> {
  if (!isAdminAuthConfigured()) {
    redirect('/admin/login?state=not_configured');
  }

  const headerBag = await headers();
  if (!checkLoginRateLimit(clientIp(headerBag)).allowed) {
    redirect('/admin/login?state=rate_limited');
  }

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  if (email === '' || password === '') {
    redirect('/admin/login?state=invalid');
  }

  let failed = false;
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    failed = error !== null;
  } catch {
    failed = true;
  }

  if (failed) redirect('/admin/login?state=invalid');
  redirect('/admin');
}

export async function mfaAction(formData: FormData): Promise<void> {
  if (!isAdminAuthConfigured()) {
    redirect('/admin/login?state=not_configured');
  }

  const headerBag = await headers();
  if (!checkLoginRateLimit(clientIp(headerBag)).allowed) {
    redirect('/admin/login/mfa?state=rate_limited' as Route);
  }

  const code = String(formData.get('code') ?? '').trim();
  if (!/^\d{6}$/.test(code)) {
    redirect('/admin/login/mfa?state=invalid' as Route);
  }

  let state: string | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const factors = await supabase.auth.mfa.listFactors();
    const factor = factors.data?.totp.find((entry) => entry.status === 'verified');

    if (factors.error !== null || factor === undefined) {
      state = 'not_enrolled';
    } else {
      const challenge = await supabase.auth.mfa.challenge({ factorId: factor.id });
      if (challenge.error !== null) {
        state = 'invalid';
      } else {
        const verified = await supabase.auth.mfa.verify({
          factorId: factor.id,
          challengeId: challenge.data.id,
          code,
        });
        if (verified.error !== null) state = 'invalid';
      }
    }
  } catch {
    state = 'invalid';
  }

  if (state !== null) redirect(`/admin/login/mfa?state=${state}` as Route);
  redirect('/admin');
}

export async function logoutAction(): Promise<void> {
  try {
    if (isAdminAuthConfigured()) {
      const supabase = await createSupabaseServerClient();
      await supabase.auth.signOut();
    }
  } catch {
    // Sesi lokal tetap diarahkan ke login; kegagalan jaringan tidak boleh
    // menahan operator di panel.
  }
  redirect('/admin/login?state=signed_out');
}
