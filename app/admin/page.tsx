import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Admin Dashboard',
  description: 'Control panel for data curation and ingestion pipeline.',
};

export default function AdminDashboardPage() {
  return (
    <div className="animate-fade-in">
      <div className="mb-8 flex items-center justify-between border-b border-line pb-4">
        <div>
          <h1 className="text-3xl font-black text-ink-0">Admin Control Panel</h1>
          <p className="mt-1 text-sm text-ink-2">Manage ingestion, data quality, and conflict resolution.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-xs font-medium border border-line-strong text-ink-1">
            <div className="h-2 w-2 rounded-full bg-accent-win animate-pulse-glow" />
            System Online
          </span>
        </div>
      </div>

      <div className="mb-6 rounded-lg border border-accent-flag/30 bg-accent-flag/10 p-3 text-sm text-accent-flag flex items-center gap-2">
        <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <p>Mock UI Dashboard. Fitur fungsional seperti Supabase Auth & Ingestion Queue Queue Tracker akan diimplementasikan pada Sprint 2 & 4.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Metric Cards */}
        <div className="rounded-xl border border-line bg-surface-1 p-5 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Total Characters</h3>
          <div className="mt-2 text-3xl font-black text-ink-0">12,450</div>
          <p className="mt-1 text-xs text-ink-2">Dalam 1,200 verses</p>
        </div>
        
        <div className="rounded-xl border border-line bg-surface-1 p-5 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Ingestion Queue</h3>
          <div className="mt-2 text-3xl font-black text-accent-b">42</div>
          <p className="mt-1 text-xs text-ink-2">Jobs pending</p>
        </div>
        
        <div className="rounded-xl border border-accent-lose/30 bg-accent-lose/5 p-5 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-accent-lose">Open Conflicts</h3>
          <div className="mt-2 text-3xl font-black text-accent-lose">8</div>
          <p className="mt-1 text-xs text-accent-lose/70">Needs manual resolution</p>
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="rounded-2xl border border-line bg-surface-1 p-6">
          <h2 className="text-lg font-bold text-ink-0 mb-4 border-b border-line pb-2">Recent Ingestion Jobs</h2>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-ink-1">
              <thead className="text-xs uppercase bg-surface-2 text-ink-3">
                <tr>
                  <th className="px-4 py-3 rounded-tl-lg">Source</th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 rounded-tr-lg">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <tr className="hover:bg-surface-2/30">
                  <td className="px-4 py-3 font-medium text-accent-b">VSB_Adapter_01</td>
                  <td className="px-4 py-3">Bleach Universe</td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-accent-win/20 px-2 py-0.5 text-[0.65rem] font-bold uppercase text-accent-win">Success</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-3">10 mins ago</td>
                </tr>
                <tr className="hover:bg-surface-2/30">
                  <td className="px-4 py-3 font-medium text-accent-b">CSV_Upload</td>
                  <td className="px-4 py-3">Naruto Data</td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-accent-lose/20 px-2 py-0.5 text-[0.65rem] font-bold uppercase text-accent-lose">Failed</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-3">1 hour ago</td>
                </tr>
                <tr className="hover:bg-surface-2/30">
                  <td className="px-4 py-3 font-medium text-accent-b">Crawler_Wiki</td>
                  <td className="px-4 py-3">One Piece</td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-accent-flag/20 px-2 py-0.5 text-[0.65rem] font-bold uppercase text-accent-flag">Parsing</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-3">Just now</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div className="space-y-6">
          <section className="rounded-2xl border border-line bg-surface-1 p-6">
            <h2 className="text-lg font-bold text-ink-0 mb-4 border-b border-line pb-2">Quick Actions</h2>
            <div className="flex flex-col gap-3">
              <button className="btn-primary w-full text-sm">Upload CSV Data</button>
              <button className="rounded-lg border border-line bg-surface-2 px-4 py-2.5 text-sm font-medium text-ink-1 hover:bg-surface-3 transition-colors">
                Run Incremental Cron
              </button>
              <button className="rounded-lg border border-line bg-surface-2 px-4 py-2.5 text-sm font-medium text-ink-1 hover:bg-surface-3 transition-colors">
                Manage Rule Set
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
