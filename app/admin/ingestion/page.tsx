import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Ingestion Jobs',
  description: 'Monitor dan kelola job ingestion pipeline.',
};

export const dynamic = 'force-dynamic';

export default function AdminIngestionPage() {
  return (
    <div className="animate-fade-in">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-ink-0">Ingestion Pipeline</h1>
          <p className="mt-1 text-sm text-ink-2">Monitor, retry, dan manage semua job ingestion.</p>
        </div>
        <a href="/admin" className="text-sm text-accent-b hover:underline">← Back to Dashboard</a>
      </div>

      {/* ─── Action Bar ─── */}
      <div className="mb-8 flex flex-wrap gap-3">
        <button className="btn-primary text-sm">+ Import URL</button>
        <button className="rounded-lg border border-line bg-surface-2 px-4 py-2 text-sm font-medium text-ink-1 hover:bg-surface-3 transition-colors">
          Import CSV/JSON Dataset
        </button>
        <button className="rounded-lg border border-line bg-surface-2 px-4 py-2 text-sm font-medium text-ink-1 hover:bg-surface-3 transition-colors">
          Sync All (Scheduled Full)
        </button>
      </div>

      {/* ─── Filter Tabs ─── */}
      <div className="flex gap-1 border-b border-line mb-6">
        {['All', 'Pending', 'Processing', 'Completed', 'Failed', 'Partial'].map((tab, i) => (
          <button
            key={tab}
            className={`px-4 py-2.5 text-sm font-medium transition-colors rounded-t-lg ${
              i === 0
                ? 'bg-surface-2 text-ink-0 border-x border-t border-line-strong'
                : 'text-ink-2 hover:text-ink-0 hover:bg-surface-1'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ─── Jobs Table ─── */}
      <div className="rounded-2xl border border-line bg-surface-1 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-xs uppercase text-ink-3">
              <tr>
                <th className="px-4 py-3">Job ID</th>
                <th className="px-4 py-3">Scope</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Records</th>
                <th className="px-4 py-3">Retries</th>
                <th className="px-4 py-3">Error</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-ink-1">
              {/* Empty state */}
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-ink-3">
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-3xl opacity-50">📋</span>
                    <p className="font-medium">Belum ada job ingestion</p>
                    <p className="text-xs max-w-sm">
                      Buat job baru dengan tombol Import URL atau Sync di atas. 
                      Halaman ini akan menampilkan status, error, dan retry dari setiap job secara real-time.
                    </p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Pipeline Architecture Note ─── */}
      <div className="mt-8 rounded-xl border border-line bg-surface-1 p-6 text-xs text-ink-2 leading-relaxed">
        <h3 className="font-bold text-ink-0 text-sm mb-2">Pipeline Architecture</h3>
        <p>
          Setiap job melewati tahapan: <code className="text-accent-b">fetch → parse → normalize → validate → dedupe → resolve → upsert</code>.
          Kegagalan pada tahap apapun akan dicatat dengan <code className="text-accent-b">error_type</code> spesifik
          (ParserError, SourceUnavailable, RateLimited, InvalidData, DuplicateCharacter, MissingRequiredField).
          Backoff eksponensial diterapkan pada retry, dan job yang sudah melewati <code className="text-accent-b">max_retries</code> 
          akan ditandai <code className="text-accent-lose">failed</code> secara permanen.
        </p>
      </div>
    </div>
  );
}
