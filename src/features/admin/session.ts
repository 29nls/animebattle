/**
 * Penjaga halaman `/admin/(dashboard)`.
 *
 * Tidak ada fallback token. Tanpa Supabase Auth panel terkunci; sesi tanpa
 * peran atau admin tanpa MFA diarahkan ke halaman yang menjelaskan alasannya.
 */

import type { Route } from 'next';
import { redirect } from 'next/navigation';

import {
  getAdminAuth,
  isAdminAuthConfigured,
  type AdminAccessLevel,
  type AdminAuthFailure,
  type AdminAuthReason,
  type AdminIdentity,
} from './auth.ts';

export { isAdminAuthConfigured };

export function adminPanelConfigured(): boolean {
  return isAdminAuthConfigured();
}

export function loginPathForReason(reason: AdminAuthReason): string {
  switch (reason) {
    case 'not_configured':
      return '/admin/login?state=not_configured';
    case 'session_expired':
      return '/admin/login?state=expired';
    case 'mfa_required':
      return '/admin/login/mfa?state=required';
    case 'forbidden':
      return '/admin/login?state=forbidden';
    case 'database_unavailable':
      return '/admin/login?state=unavailable';
    case 'unauthenticated':
      return '/admin/login?state=login_required';
  }
}

export function redirectForAuthFailure(auth: AdminAuthFailure): never {
  redirect(loginPathForReason(auth.reason) as Route);
}

/** Dipakai tautan "Admin" di halaman publik; bukan penjaga halaman admin. */
export async function isAdminAuthenticated(): Promise<boolean> {
  if (!adminPanelConfigured()) return false;
  const auth = await getAdminAuth('viewer');
  return auth.ok;
}

/**
 * Halaman memakai guard ini. Layout memanggilnya untuk viewer; halaman yang
 * butuh editor/admin memanggil ulang dengan tingkat yang lebih tinggi.
 */
export async function requireAdminPage(
  minimum: AdminAccessLevel = 'viewer',
): Promise<AdminIdentity> {
  if (!adminPanelConfigured()) {
    redirect('/admin/login?state=not_configured' as Route);
  }

  const auth = await getAdminAuth(minimum);
  if (!auth.ok) redirectForAuthFailure(auth);
  return auth.identity;
}
