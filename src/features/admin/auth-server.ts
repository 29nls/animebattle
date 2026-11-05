/**
 * Sesi Supabase Auth untuk server Next.js.
 *
 * Cookie sesi dikelola `@supabase/ssr`; token tidak pernah disimpan di
 * localStorage atau diteruskan ke komponen klien. Peran dibaca dari
 * `user_roles` memakai `SqlClient` yang sama dengan seluruh aplikasi.
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { getSqlClient } from '../../lib/db/client.ts';
import type { AdminAuthSnapshot } from './auth.ts';

function requireAuthEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY'): string {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} belum dikonfigurasi.`);
  }
  return value.trim();
}

/** Client server-side yang menulis cookie sesi lewat Server Action/Route Handler. */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    requireAuthEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireAuthEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Component tidak boleh menulis cookie. Refresh sesi tetap
            // dicoba oleh middleware/route; jangan ubah kegagalan itu menjadi
            // halaman 500.
          }
        },
      },
    },
  );
}

interface RoleRow {
  role: string;
}

function displayNameOf(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}): string | null {
  const metadata = user.user_metadata ?? {};
  const candidate = metadata.full_name ?? metadata.name;
  if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
  return user.email ?? null;
}

/**
 * Muat user, AAL, dan peran. Kesalahan database dilempar ke `getAdminAuth`
 * yang menerjemahkannya menjadi 503 — bukan menjadi akses terbuka.
 */
export async function loadAdminAuthSnapshot(): Promise<AdminAuthSnapshot> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error !== null || data.user === null) {
    return { configured: true, user: null, roles: [], aal: 'aal1', expiresAt: null };
  }

  const user = data.user;
  const { data: sessionData } = await supabase.auth.getSession();
  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const expiresAt = sessionData.session?.expires_at ?? null;

  const sql = getSqlClient();
  // Profil lokal harus ada sebelum audit_logs.actor_id (FK users) dapat diisi.
  await sql.query(
    `insert into users (id, display_name)
     values ($1, $2)
     on conflict (id) do update
       set display_name = coalesce(users.display_name, excluded.display_name)`,
    [user.id, displayNameOf(user)],
  );

  const roleRows = await sql.query<RoleRow>(
    `select role::text as role
       from user_roles
      where user_id = $1
      order by created_at asc`,
    [user.id],
  );

  return {
    configured: true,
    user: {
      id: user.id,
      email: user.email ?? null,
      displayName: displayNameOf(user),
    },
    roles: roleRows.map((row) => row.role),
    aal: aalData?.currentLevel === 'aal2' ? 'aal2' : 'aal1',
    expiresAt: typeof expiresAt === 'number' ? expiresAt : null,
  };
}
