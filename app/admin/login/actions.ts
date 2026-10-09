'use server';

/**
 * Server action login/logout panel admin.
 *
 * Token yang dimasukkan operator adalah `ADMIN_INGESTION_SECRET` yang sama dengan
 * bearer API — satu rahasia, dua penggunaan. Perbandingannya memakai
 * `secretsMatch` (timing-safe, diuji di `tests/security/admin-guard.test.ts`),
 * bukan `===`.
 *
 * Rate limit 10 percobaan/menit per IP ditaruh di sini karena inilah satu-satunya
 * tempat rahasia admin dapat ditebak lewat UI. Tanpa itu, halaman login menjadi
 * oracle tebakan yang lebih nyaman daripada API yang sudah dibatasi.
 */

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { secretsMatch } from '@/lib/security/admin-guard.ts';
import { FixedWindowRateLimiter } from '@/lib/security/rate-limiter.ts';
import {
  ADMIN_SESSION_COOKIE,
  createAdminSessionToken,
} from '@/lib/security/admin-session.ts';
import { adminSecret, adminSessionCookieOptions } from '@/features/admin/session.ts';

const loginLimiter = new FixedWindowRateLimiter(10, 60_000, () => Date.now());

export async function loginAction(formData: FormData): Promise<void> {
  const secret = adminSecret();
  if (secret === null) {
    redirect('/admin/login?state=not_configured');
  }

  const headerBag = await headers();
  const identity = headerBag.get('x-forwarded-for')?.trim() || 'admin-login';
  if (!loginLimiter.check(identity).allowed) {
    redirect('/admin/login?state=rate_limited');
  }

  const token = String(formData.get('token') ?? '');
  if (!secretsMatch(token, secret)) {
    redirect('/admin/login?state=invalid');
  }

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, createAdminSessionToken(secret, Date.now()), adminSessionCookieOptions());
  redirect('/admin');
}

export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, '', { ...adminSessionCookieOptions(), maxAge: 0 });
  redirect('/admin/login');
}
