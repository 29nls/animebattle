/**
 * Sesi halaman admin: satu tempat yang memutuskan "boleh lihat panel atau
 * tidak", dipakai layout `/admin/(dashboard)` dan halaman login.
 *
 * Zona `web-request` (PRD §39): boleh memakai `next/headers` dan modul
 * `src/lib/security/*`; tidak boleh menyentuh ingestion.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_MS,
  verifyAdminSessionToken,
} from '../../lib/security/admin-session.ts';

/** Secret panel; `null` berarti fitur admin sengaja mati (fail-closed). */
export function adminSecret(): string | null {
  const secret = process.env.ADMIN_INGESTION_SECRET;
  if (typeof secret !== 'string' || secret.trim() === '') return null;
  return secret;
}

export function adminPanelConfigured(): boolean {
  return adminSecret() !== null;
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const secret = adminSecret();
  if (secret === null) return false;
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value ?? null;
  return verifyAdminSessionToken(token, secret, Date.now());
}

/** Dipakai layout panel: belum terautentikasi → halaman login. */
export async function requireAdminSession(): Promise<void> {
  if (!(await isAdminAuthenticated())) {
    redirect('/admin/login');
  }
}

/** Opsi cookie sesi: httpOnly, hanya dikirim ke /admin, tidak lintas situs. */
export function adminSessionCookieOptions(): {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/admin',
    maxAge: Math.floor(ADMIN_SESSION_MAX_AGE_MS / 1000),
  };
}
