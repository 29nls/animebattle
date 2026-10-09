import type { Metadata } from 'next';

import { getSqlClient, isDatabaseConfigured, isDatabaseUnavailable } from '@/lib/db/client.ts';
import { getConflictSummary, listConflicts } from '@/features/admin/queries.ts';
import type { ConflictRow, ConflictSummary } from '@/features/admin/queries.ts';
import { Notice, StatCard, formatDateTime } from '@/features/admin/ui.tsx';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Data Conflicts',
  description: 'Review dan selesaikan konflik data dari berbagai sumber.',
};

export default async function AdminConflictsPage() {
  let conflicts: ConflictRow[] = [];
  let summary: ConflictSummary | null = null;
  let unavailable: string | null = null;

  if (isDatabaseConfigured()) {
    try {
      const sql = getSqlClient();
      summary = await getConflictSummary(sql);
      conflicts = await listConflicts(sql, { limit: 50 });
    } catch (error) {
      if (!isDatabaseUnavailable(error)) throw error;
      unavailable = error instanceof Error ? error.message : String(error);
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-3xl font-black text-ink-0">Conflict Queue</h1>
        <p className="mt-1 text-sm text-ink-2">
          Konflik terjadi saat dua sumber memberi nilai berbeda untuk field yang sama. Konflik disimpan di{' '}
          <code>character_source_conflicts</code> — data tidak pernah ditimpa otomatis; keputusan akhir ada
          di tangan manusia (PRD §19).
        </p>
      </div>

      {!isDatabaseConfigured() ? (
        <Notice tone="warn" title="Database belum dikonfigurasi">
          Setel <code>DATABASE_URL</code> untuk melihat antrian konflik.
        </Notice>
      ) : unavailable !== null ? (
        <Notice tone="danger" title="Database tidak dapat dihubungi">
          <p className="font-mono text-xs">{unavailable}</p>
        </Notice>
      ) : summary ? (
        <>
          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Terbuka"
              value={summary.pending}
              tone={summary.pending > 0 ? 'danger' : 'default'}
              hint="status open"
            />
            <StatCard label="Selesai (7 hari)" value={summary.resolved_7d} hint="status resolved + resolved_at" />
            <StatCard label="Total sepanjang waktu" value={summary.total} />
          </div>

          <div className="overflow-hidden rounded-2xl border border-line bg-surface-1">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-xs uppercase text-ink-3">
                  <tr>
                    <th className="px-4 py-3">Karakter</th>
                    <th className="px-4 py-3">Field</th>
                    <th className="px-4 py-3">Nilai A (sumber)</th>
                    <th className="px-4 py-3">Nilai B (sumber)</th>
                    <th className="px-4 py-3">Terdeteksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line text-ink-1">
                  {conflicts.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-ink-3">
                        <div className="flex flex-col items-center gap-2">
                          <span className="text-3xl opacity-50">✅</span>
                          <p className="font-medium">Tidak ada konflik terbuka</p>
                          <p className="max-w-sm text-xs">
                            Konflik muncul saat pipeline menemukan dua sumber memberi nilai berbeda untuk
                            stat yang sama pada form yang sama.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    conflicts.map((conflict) => (
                      <tr key={conflict.id} className="hover:bg-surface-2/30">
                        <td className="px-4 py-3">
                          <div className="font-medium text-ink-0">{conflict.character_name}</div>
                          <div className="font-mono text-[0.7rem] text-ink-3">{conflict.character_slug}</div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{conflict.metric}</td>
                        <td className="px-4 py-3">
                          <div>{conflict.value_a ?? '—'}</div>
                          <div className="text-[0.7rem] text-ink-3">{conflict.source_a_name ?? 'sumber tidak diketahui'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div>{conflict.value_b ?? '—'}</div>
                          <div className="text-[0.7rem] text-ink-3">{conflict.source_b_name ?? 'sumber tidak diketahui'}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-ink-3">{formatDateTime(conflict.created_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      <div className="mt-8 rounded-xl border border-line bg-surface-1 p-6 text-xs leading-relaxed text-ink-2">
        <h3 className="mb-3 text-sm font-bold text-ink-0">Opsi resolusi (PRD §7.1 US-24)</h3>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="text-ink-0">Keep A / Keep B:</strong> simpan nilai satu sumber, tandai yang
            lain sebagai superseded.
          </li>
          <li>
            <strong className="text-ink-0">Keep Both (Split):</strong> nilai berbeda karena form/era
            berbeda — buat versi baru alih-alih memilih satu.
          </li>
          <li>
            <strong className="text-ink-0">Mark Unresolved:</strong> tandai belum dapat diselesaikan dan
            turunkan <code>confidence</code>.
          </li>
        </ul>
        <p className="mt-3">
          UI resolusi (diff berdampingan + tombol simpan bertuliskan <code>audit_logs</code>) menyusul pada
          Sprint 4; halaman ini sudah menampilkan data sungguhan dari database.
        </p>
      </div>
    </div>
  );
}
