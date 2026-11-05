import Link from 'next/link';
import type { Route } from 'next';
import type { ReactNode } from 'react';

import { requireAdminPage } from '@/features/admin/session.ts';
import { logoutAction } from '../login/actions';

export const dynamic = 'force-dynamic';

/**
 * Penjaga panel admin (group `(dashboard)`). Halaman login berada di luar
 * group ini, sehingga redirect tidak membuat lingkaran.
 */
export default async function AdminDashboardLayout({ children }: { children: ReactNode }) {
  const identity = await requireAdminPage('viewer');
  const canReview = identity.effectiveRole === 'editor' || identity.effectiveRole === 'admin';
  const canSeeLegalReports = identity.effectiveRole === 'admin';

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
      <aside className="lg:w-56 shrink-0">
        <nav className="sticky top-20 rounded-2xl border border-line bg-surface-1 p-4 shadow-sm">
          <h2 className="mb-1 text-xs font-bold uppercase tracking-widest text-ink-3">
            Admin Panel
          </h2>
          <p className="mb-4 truncate text-xs text-ink-2" title={identity.email ?? undefined}>
            {identity.displayName ?? identity.email ?? identity.userId}
          </p>
          <p className="mb-4 text-[0.7rem] uppercase tracking-wider text-ink-3">
            {identity.effectiveRole} · {identity.aal}
          </p>
          <ul className="space-y-1 text-sm">
            <li>
              <Link
                href="/admin"
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 font-medium text-ink-1 transition-colors hover:bg-surface-2 hover:text-ink-0"
              >
                <span className="text-base">📊</span> Dashboard
              </Link>
            </li>
            <li>
              <Link
                href="/admin/ingestion"
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 font-medium text-ink-1 transition-colors hover:bg-surface-2 hover:text-ink-0"
              >
                <span className="text-base">📥</span> Ingestion Jobs
              </Link>
            </li>
            <li>
              <Link
                href="/admin/conflicts"
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 font-medium text-ink-1 transition-colors hover:bg-surface-2 hover:text-ink-0"
              >
                <span className="text-base">⚠️</span> Conflicts
              </Link>
            </li>
            {canReview ? (
              <li>
                <Link
                  href="/admin/audit"
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 font-medium text-ink-1 transition-colors hover:bg-surface-2 hover:text-ink-0"
                >
                  <span className="text-base">🧾</span> Audit Log
                </Link>
              </li>
            ) : null}
            {canSeeLegalReports ? (
              <li>
                <Link
                  href={'/admin/reports' as Route}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 font-medium text-ink-1 transition-colors hover:bg-surface-2 hover:text-ink-0"
                >
                  <span className="text-base">⚖️</span> Laporan Legal
                </Link>
              </li>
            ) : null}
            <li className="pt-3 mt-3 border-t border-line/50">
              <Link
                href="/"
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-ink-3 transition-colors hover:text-ink-0"
              >
                <span className="text-base">←</span> Back to Site
              </Link>
            </li>
            <li>
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-0"
                >
                  <span className="text-base">🚪</span> Keluar
                </button>
              </form>
            </li>
          </ul>
        </nav>
      </aside>

      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
