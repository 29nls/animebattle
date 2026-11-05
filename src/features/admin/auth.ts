/**
 * Model otorisasi panel admin — murni dan dapat diuji tanpa Supabase.
 *
 * Sumber kebenaran peran ada di tabel `user_roles` dan diverifikasi di server.
 * Modul ini hanya menjawab satu pertanyaan: berdasarkan snapshot sesi yang
 * sudah diverifikasi, boleh atau tidak, dan kalau tidak, status HTTP apa.
 *
 * Aturan yang dikunci:
 *  - Konfigurasi Auth hilang → 503 (fail-closed), bukan fallback terbuka.
 *  - Tanpa user / sesi kedaluwarsa → 401.
 *  - Tanpa peran yang dikenal, peran kurang, atau admin belum `aal2` → 403.
 *  - `admin` dan `owner` wajib MFA. `curator` adalah peran legacy dan
 *    diperlakukan sebagai `editor`; `editor` tidak wajib MFA.
 *
 * Zona `web-request`: modul ini tidak membaca cookie atau database. Provider
 * default dimuat dinamis dari `auth-server.ts`, sehingga unit test dapat
 * menyuntikkan snapshot tanpa memuat `next/headers`.
 */

export type AdminRole = 'viewer' | 'editor' | 'curator' | 'admin' | 'owner';

/** Tingkat akses efektif yang dipakai halaman dan route. */
export type AdminAccessLevel = 'viewer' | 'editor' | 'admin';

export type AdminAuthReason =
  | 'not_configured'
  | 'unauthenticated'
  | 'session_expired'
  | 'forbidden'
  | 'mfa_required'
  | 'database_unavailable';

export interface AdminUser {
  id: string;
  email: string | null;
  displayName: string | null;
}

/** Snapshot yang sudah diverifikasi dari Supabase + database peran. */
export interface AdminAuthSnapshot {
  configured: boolean;
  user: AdminUser | null;
  roles: readonly string[];
  aal: 'aal1' | 'aal2';
  /** Detik Unix dari sesi Supabase, bila tersedia. */
  expiresAt?: number | null;
  /** Disuntik di test agar kedaluwarsa deterministik. */
  now?: number;
}

export interface AdminIdentity {
  userId: string;
  email: string | null;
  displayName: string | null;
  roles: AdminRole[];
  effectiveRole: AdminAccessLevel;
  aal: 'aal1' | 'aal2';
}

export type AdminAuthFailure = {
  ok: false;
  status: 401 | 403 | 503;
  code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'UNAVAILABLE';
  reason: AdminAuthReason;
  message: string;
};

export type AdminAuthResult = { ok: true; identity: AdminIdentity } | AdminAuthFailure;

const KNOWN_ROLES: ReadonlySet<string> = new Set(['viewer', 'editor', 'curator', 'admin', 'owner']);

const ROLE_RANK: Record<AdminAccessLevel, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
};

/** Buang peran tak dikenal dan duplikat, pertahankan urutan input. */
export function normalizeRoles(roles: readonly string[]): AdminRole[] {
  const seen = new Set<string>();
  const result: AdminRole[] = [];
  for (const role of roles) {
    if (!KNOWN_ROLES.has(role) || seen.has(role)) continue;
    seen.add(role);
    result.push(role as AdminRole);
  }
  return result;
}

export function isAdminRole(role: AdminRole): boolean {
  return role === 'admin' || role === 'owner';
}

export function isEditorRole(role: AdminRole): boolean {
  return role === 'editor' || role === 'curator' || isAdminRole(role);
}

/** Tingkat efektif tertinggi yang dimiliki pengguna. */
export function effectiveRoleFor(roles: readonly AdminRole[]): AdminAccessLevel | null {
  if (roles.some(isAdminRole)) return 'admin';
  if (roles.some(isEditorRole)) return 'editor';
  if (roles.includes('viewer')) return 'viewer';
  return null;
}

export function roleSatisfies(roles: readonly AdminRole[], minimum: AdminAccessLevel): boolean {
  const effective = effectiveRoleFor(roles);
  return effective !== null && ROLE_RANK[effective] >= ROLE_RANK[minimum];
}

function failure(
  reason: AdminAuthReason,
  status: 401 | 403 | 503,
  code: AdminAuthFailure['code'],
  message: string,
): AdminAuthFailure {
  return { ok: false, status, code, reason, message };
}

/**
 * Evaluasi snapshot. Urutan sengaja: konfigurasi → identitas → umur sesi →
 * peran → MFA → tingkat akses. Tidak ada cabang yang membiarkan request lolos
 * ketika data otorisasi tidak lengkap.
 */
export function evaluateAdminAccess(
  snapshot: AdminAuthSnapshot,
  minimum: AdminAccessLevel = 'viewer',
): AdminAuthResult {
  if (!snapshot.configured) {
    return failure(
      'not_configured',
      503,
      'UNAVAILABLE',
      'Supabase Auth belum dikonfigurasi; rute admin sengaja gagal tertutup.',
    );
  }

  if (snapshot.user === null) {
    return failure('unauthenticated', 401, 'UNAUTHORIZED', 'Tidak berwenang.');
  }

  const now = snapshot.now ?? Date.now();
  if (
    typeof snapshot.expiresAt === 'number' &&
    Number.isFinite(snapshot.expiresAt) &&
    snapshot.expiresAt * 1000 <= now
  ) {
    return failure('session_expired', 401, 'UNAUTHORIZED', 'Sesi kedaluwarsa. Silakan masuk kembali.');
  }

  const roles = normalizeRoles(snapshot.roles);
  if (effectiveRoleFor(roles) === null) {
    return failure('forbidden', 403, 'FORBIDDEN', 'Akun ini tidak memiliki peran admin.');
  }

  if (roles.some(isAdminRole) && snapshot.aal !== 'aal2') {
    return failure(
      'mfa_required',
      403,
      'FORBIDDEN',
      'Peran admin/owner mewajibkan MFA (aal2). Selesaikan verifikasi TOTP terlebih dahulu.',
    );
  }

  if (!roleSatisfies(roles, minimum)) {
    return failure(
      'forbidden',
      403,
      'FORBIDDEN',
      `Peran tidak mencukupi untuk aksi ini (butuh ${minimum}).`,
    );
  }

  return {
    ok: true,
    identity: {
      userId: snapshot.user.id,
      email: snapshot.user.email,
      displayName: snapshot.user.displayName,
      roles,
      effectiveRole: effectiveRoleFor(roles)!,
      aal: snapshot.aal,
    },
  };
}

/** Apakah env minimum Supabase Auth tersedia. Tidak membuka koneksi. */
export function isAdminAuthConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return typeof url === 'string' && url.trim() !== '' && typeof key === 'string' && key.trim() !== '';
}

export type AdminAuthProvider = () => Promise<AdminAuthSnapshot>;

let injectedProvider: AdminAuthProvider | null = null;

/** Hanya untuk test/integration; `null` mengembalikan provider produksi. */
export function setAdminAuthProviderForTests(provider: AdminAuthProvider | null): void {
  injectedProvider = provider;
}

/**
 * Ambil snapshot lalu evaluasi. Provider produksi dimuat dinamis supaya unit
 * test model ini tidak perlu memuat `next/headers` atau Supabase.
 */
export async function getAdminAuth(
  minimum: AdminAccessLevel = 'viewer',
): Promise<AdminAuthResult> {
  let snapshot: AdminAuthSnapshot;
  try {
    if (injectedProvider !== null) {
      snapshot = await injectedProvider();
    } else if (!isAdminAuthConfigured()) {
      snapshot = { configured: false, user: null, roles: [], aal: 'aal1' };
    } else {
      const { loadAdminAuthSnapshot } = await import('./auth-server.ts');
      snapshot = await loadAdminAuthSnapshot();
    }
  } catch (error) {
    console.error('[admin-auth] gagal memuat sesi:', error instanceof Error ? error.message : error);
    return failure(
      'database_unavailable',
      503,
      'UNAVAILABLE',
      'Sesi tidak dapat diverifikasi saat ini; akses admin ditolak.',
    );
  }

  return evaluateAdminAccess(snapshot, minimum);
}
