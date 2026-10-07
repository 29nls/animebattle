import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Data Conflicts',
  description: 'Review dan selesaikan konflik data dari berbagai sumber.',
};

export const dynamic = 'force-dynamic';

export default function AdminConflictsPage() {
  return (
    <div className="animate-fade-in">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-ink-0">Conflict Queue</h1>
          <p className="mt-1 text-sm text-ink-2">
            Konflik terjadi saat dua sumber memberikan nilai berbeda untuk metrik yang sama. 
            Data tidak pernah ditimpa otomatis — keputusan akhir di tangan manusia (PRD §19).
          </p>
        </div>
        <a href="/admin" className="text-sm text-accent-b hover:underline">← Back to Dashboard</a>
      </div>

      {/* ─── Summary Cards ─── */}
      <div className="grid gap-4 sm:grid-cols-3 mb-8">
        <div className="rounded-xl border border-accent-lose/30 bg-accent-lose/5 p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Pending Review</h3>
          <div className="mt-2 text-3xl font-black text-accent-lose">0</div>
        </div>
        <div className="rounded-xl border border-accent-flag/30 bg-accent-flag/5 p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Resolved (7 days)</h3>
          <div className="mt-2 text-3xl font-black text-accent-flag">0</div>
        </div>
        <div className="rounded-xl border border-line bg-surface-1 p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Total All Time</h3>
          <div className="mt-2 text-3xl font-black text-ink-0">0</div>
        </div>
      </div>

      {/* ─── Conflicts List ─── */}
      <div className="rounded-2xl border border-line bg-surface-1 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-xs uppercase text-ink-3">
              <tr>
                <th className="px-4 py-3">Character</th>
                <th className="px-4 py-3">Metric</th>
                <th className="px-4 py-3">Value A (Source)</th>
                <th className="px-4 py-3">Value B (Source)</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-ink-1">
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-ink-3">
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-3xl opacity-50">✅</span>
                    <p className="font-medium">Tidak ada konflik yang perlu diselesaikan</p>
                    <p className="text-xs max-w-sm">
                      Konflik muncul saat pipeline ingestion menemukan dua sumber memberikan 
                      nilai berbeda untuk stat yang sama pada form yang sama.
                    </p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Resolution Guide ─── */}
      <div className="mt-8 rounded-xl border border-line bg-surface-1 p-6 text-xs text-ink-2 leading-relaxed">
        <h3 className="font-bold text-ink-0 text-sm mb-3">Resolution Options</h3>
        <ul className="space-y-2 list-disc pl-5">
          <li><strong className="text-ink-0">Keep A:</strong> Gunakan nilai dari Source A, tandai Source B sebagai superseded.</li>
          <li><strong className="text-ink-0">Keep B:</strong> Gunakan nilai dari Source B, tandai Source A sebagai superseded.</li>
          <li><strong className="text-ink-0">Keep Both (Split):</strong> Nilai berbeda karena form berbeda — buat version/form baru.</li>
          <li><strong className="text-ink-0">Mark Unresolved:</strong> Tandai sebagai belum dapat diselesaikan, turunkan confidence.</li>
        </ul>
      </div>
    </div>
  );
}
