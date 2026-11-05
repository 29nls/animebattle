import type { Metadata } from 'next';

import { getSqlClient, isDatabaseConfigured, isDatabaseUnavailable } from '@/lib/db/client.ts';
import { requireAdminPage } from '@/features/admin/session.ts';
import { Notice, StatusBadge, formatDateTime } from '@/features/admin/ui.tsx';
import { listLegalReports, type LegalReportRow } from '@/features/legal/queries.ts';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Laporan Legal',
  description: 'Tiket takedown dan permintaan privasi.',
};

export default async function AdminReportsPage() {
  await requireAdminPage('admin');

  let reports: LegalReportRow[] = [];
  let unavailable: string | null = null;
  if (isDatabaseConfigured()) {
    try {
      reports = await listLegalReports(getSqlClient(), { limit: 100 });
    } catch (error) {
      if (!isDatabaseUnavailable(error)) throw error;
      unavailable = error instanceof Error ? error.message : String(error);
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6 border-b border-line pb-4">
        <h1 className="text-3xl font-black text-ink-0">Laporan Legal</h1>
        <p className="mt-1 text-sm text-ink-2">
          Tiket dari <code>/api/legal/takedown</code>. Halaman ini memuat PII; akses dibatasi admin
          dengan MFA. Jangan menyalin isi laporan ke kanal publik.
        </p>
      </div>

      {!isDatabaseConfigured() ? (
        <Notice tone="warn" title="Database belum dikonfigurasi">
          Setel <code>DATABASE_URL</code> untuk membaca tiket.
        </Notice>
      ) : unavailable !== null ? (
        <Notice tone="danger" title="Database tidak dapat dihubungi">
          <p className="font-mono text-xs">{unavailable}</p>
        </Notice>
      ) : reports.length === 0 ? (
        <Notice tone="info" title="Belum ada tiket">
          Tiket baru akan muncul di sini setelah formulir publik dikirim.
        </Notice>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface-1">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-xs uppercase text-ink-3">
                <tr>
                  <th className="px-4 py-3">Tiket</th>
                  <th className="px-4 py-3">Jenis</th>
                  <th className="px-4 py-3">Pelapor</th>
                  <th className="px-4 py-3">URL</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Masuk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {reports.map((report) => (
                  <tr key={report.id} className="align-top">
                    <td className="px-4 py-3 font-mono text-xs text-ink-0">{report.ticket_code}</td>
                    <td className="px-4 py-3 uppercase text-ink-2">{report.kind}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink-0">{report.reporter_name}</p>
                      <p className="text-xs text-ink-2">{report.reporter_email}</p>
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      <a
                        href={report.reported_url}
                        rel="nofollow noreferrer noopener"
                        target="_blank"
                        className="break-all text-xs text-accent-b underline underline-offset-2"
                      >
                        {report.reported_url}
                      </a>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-ink-3">Deskripsi</summary>
                        <p className="mt-1 whitespace-pre-wrap text-xs text-ink-2">
                          {report.description}
                        </p>
                      </details>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={report.status} />
                      {report.reviewed_at ? (
                        <p className="mt-1 text-[0.7rem] text-ink-3">
                          {formatDateTime(report.reviewed_at)}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-2">
                      {formatDateTime(report.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs text-ink-3">
        Tindak lanjut dan perubahan status mengikuti <code>docs/runbooks/takedown.md</code>. Jangan
        menghapus tiket sebelum masa retensi selesai.
      </p>
    </div>
  );
}
