import type { Metadata } from 'next';
import Link from 'next/link';

import { getSqlClient, isDatabaseConfigured, isDatabaseUnavailable } from '@/lib/db/client.ts';
import { getDashboardSummary, listIngestionJobs } from '@/features/admin/queries.ts';
import type { DashboardSummary, IngestionJobRow } from '@/features/admin/queries.ts';
import { Notice, StatCard, StatusBadge, formatDateTime } from '@/features/admin/ui.tsx';
import { syncNowAction } from './actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Admin Dashboard',
  description: 'Control panel for data curation and ingestion pipeline.',
};

export default async function AdminDashboardPage() {
  let summary: DashboardSummary | null = null;
  let recentJobs: IngestionJobRow[] = [];
  let unavailable: string | null = null;

  if (isDatabaseConfigured()) {
    try {
      const sql = getSqlClient();
      summary = await getDashboardSummary(sql);
      recentJobs = await listIngestionJobs(sql, { limit: 8 });
    } catch (error) {
      // Gangguan infrastruktur ditampilkan sebagai keadaan, bukan dilempar
      // menjadi halaman error: admin perlu tahu bahwa yang salah adalah
      // koneksi, bukan datanya.
      if (!isDatabaseUnavailable(error)) throw error;
      unavailable = error instanceof Error ? error.message : String(error);
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <h1 className="text-3xl font-black text-ink-0">Admin Control Panel</h1>
          <p className="mt-1 text-sm text-ink-2">
            Ringkasan data, kesehatan antrian ingestion, dan konflik sumber — semuanya dibaca langsung
            dari database, bukan angka contoh.
          </p>
        </div>
        <form action={syncNowAction}>
          <button type="submit" className="btn-primary text-sm">
            Sync Now
          </button>
        </form>
      </div>

      {!isDatabaseConfigured() ? (
        <Notice tone="warn" title="Database belum dikonfigurasi">
          <p>
            Setel <code>DATABASE_URL</code> pada environment server. Panel ini tidak menampilkan angka
            contoh: tanpa database, tidak ada yang bisa diverifikasi, jadi yang jujur adalah keadaan ini —
            bukan dashboard berisi data palsu.
          </p>
        </Notice>
      ) : unavailable !== null ? (
        <Notice tone="danger" title="Database tidak dapat dihubungi">
          <p className="font-mono text-xs">{unavailable}</p>
          <p className="mt-2">
            Periksa konektivitas dan kredensial <code>DATABASE_URL</code>. Data tidak ditampilkan sebagian,
            karena setengah data lebih menyesatkan daripada tidak ada.
          </p>
        </Notice>
      ) : summary ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard label="Karakter" value={summary.stats.total_characters} hint="Tabel characters" />
            <StatCard label="Form / versi" value={summary.stats.total_forms} hint="Belum dihapus (deleted_at null)" />
            <StatCard label="Verse" value={summary.stats.total_verses} />
            <StatCard label="Ability" value={summary.stats.total_abilities} hint="Katalog abilities" />
            <StatCard label="Sumber" value={summary.stats.total_sources} hint="Registry sources" />
            <StatCard label="Hasil battle tersimpan" value={summary.stats.total_battles} />
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Job pending"
              value={summary.pending_jobs}
              tone={summary.pending_jobs > 0 ? 'brand' : 'default'}
              hint="Menunggu diklaim worker"
            />
            <StatCard
              label="Job gagal (24 jam)"
              value={summary.failed_jobs_24h}
              tone={summary.failed_jobs_24h > 0 ? 'danger' : 'default'}
              hint="Perlu ditinjau di halaman ingestion"
            />
            <StatCard
              label="Konflik terbuka"
              value={summary.open_conflicts}
              tone={summary.open_conflicts > 0 ? 'warn' : 'default'}
              hint="character_source_conflicts berstatus open"
            />
            <StatCard
              label="Karakter diupdate (7 hari)"
              value={summary.updated_characters_7d}
              hint="Sinyal kesegaran data (K2)"
            />
          </div>

          <section className="mt-8 rounded-2xl border border-line bg-surface-1 p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
              <h2 className="text-lg font-bold text-ink-0">Ingestion terakhir</h2>
              <Link href="/admin/ingestion" className="text-sm text-accent-b hover:underline">
                Buka daftar lengkap →
              </Link>
            </div>

            {summary.last_ingestion ? (
              <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs uppercase tracking-wider text-ink-3">Status</dt>
                  <dd className="mt-1">
                    <StatusBadge status={summary.last_ingestion.status} />
                    {summary.last_ingestion.error_type ? (
                      <span className="ml-2 text-xs text-accent-lose">{summary.last_ingestion.error_type}</span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-ink-3">Scope</dt>
                  <dd className="mt-1 font-medium text-ink-0">{summary.last_ingestion.scope}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-ink-3">Dibuat</dt>
                  <dd className="mt-1 text-ink-1">{formatDateTime(summary.last_ingestion.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-ink-3">Selesai</dt>
                  <dd className="mt-1 text-ink-1">{formatDateTime(summary.last_ingestion.completed_at)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-ink-2">
                Belum ada job ingestion. Tekan <strong className="text-ink-0">Sync Now</strong> atau impor
                dataset/URL dari halaman ingestion.
              </p>
            )}
          </section>

          <section className="mt-6 rounded-2xl border border-line bg-surface-1 p-6">
            <h2 className="mb-4 border-b border-line pb-2 text-lg font-bold text-ink-0">Job terbaru</h2>
            {recentJobs.length === 0 ? (
              <p className="text-sm text-ink-2">Antrian kosong.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-2 text-xs uppercase text-ink-3">
                    <tr>
                      <th className="px-3 py-2">Scope</th>
                      <th className="px-3 py-2">Sumber</th>
                      <th className="px-3 py-2">Target</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Records</th>
                      <th className="px-3 py-2">Dibuat</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line text-ink-1">
                    {recentJobs.map((job) => (
                      <tr key={job.id} className="hover:bg-surface-2/30">
                        <td className="px-3 py-2 font-medium text-ink-0">{job.scope}</td>
                        <td className="px-3 py-2">{job.source_slug ?? '—'}</td>
                        <td className="max-w-[16rem] truncate px-3 py-2 font-mono text-xs" title={job.target_ref ?? ''}>
                          {job.target_ref ?? '—'}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={job.status} />
                        </td>
                        <td className="px-3 py-2 text-xs">
                          +{job.records_created} / ~{job.records_updated} / !{job.records_failed}
                        </td>
                        <td className="px-3 py-2 text-xs text-ink-3">{formatDateTime(job.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
