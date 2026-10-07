import type { ReactNode } from 'react';

/**
 * Layout admin dengan navigasi sidebar khusus.
 * Terpisah dari layout publik agar guard role (Sprint 0) hanya
 * perlu disisipkan di satu tempat.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
      {/* ─── Sidebar ─── */}
      <aside className="lg:w-56 shrink-0">
        <nav className="sticky top-20 rounded-2xl border border-line bg-surface-1 p-4 shadow-sm">
          <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-ink-3">
            Admin Panel
          </h2>
          <ul className="space-y-1 text-sm">
            <li>
              <a
                href="/admin"
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 font-medium text-ink-1 transition-colors hover:bg-surface-2 hover:text-ink-0"
              >
                <span className="text-base">📊</span> Dashboard
              </a>
            </li>
            <li>
              <a
                href="/admin/ingestion"
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 font-medium text-ink-1 transition-colors hover:bg-surface-2 hover:text-ink-0"
              >
                <span className="text-base">📥</span> Ingestion Jobs
              </a>
            </li>
            <li>
              <a
                href="/admin/conflicts"
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 font-medium text-ink-1 transition-colors hover:bg-surface-2 hover:text-ink-0"
              >
                <span className="text-base">⚠️</span> Conflicts
              </a>
            </li>
            <li className="pt-3 mt-3 border-t border-line/50">
              <a
                href="/"
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-ink-3 transition-colors hover:text-ink-0"
              >
                <span className="text-base">←</span> Back to Site
              </a>
            </li>
          </ul>
        </nav>
      </aside>

      {/* ─── Main Content ─── */}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
