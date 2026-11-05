import type { Metadata } from 'next';
import Link from 'next/link';

import { getSqlClient, isDatabaseConfigured, isDatabaseUnavailable } from '@/lib/db/client.ts';
import { listAuditLogs, type AuditLogRow } from '@/features/admin/audit.ts';
import { requireAdminPage } from '@/features/admin/session.ts';
import { Notice, formatDateTime } from '@/features/admin/ui.tsx';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Audit Log Admin',
  description: 'Riwayat aksi admin yang tercatat di audit_logs.',
  robots: { index: false, follow: false },
};

function paramsText(params: unknown): string {
  if (params === null || params === undefined) return '—';
  try {
    const text = JSON.stringify(params);
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
  } catch {
    return '—';
  }
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  // Layout sudah memastikan viewer; halaman ini menaikkan syarat ke editor.
  await requireAdminPage('editor');

  const query = await searchParams;
  const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
  const limit = 50;
  const offset = (page - 1) * limit;

  let rows: AuditLogRow[] = [];
  let unavailable: string | null = null;

  if (isDatabaseConfigured()) {
    try {
      rows = await listAuditLogs(getSqlClient(), { limit, offset });
    } catch (error) {
      if (!isDatabaseUnavailable(error)) throw error;
      unavailable = error instanceof Error ? error.message : String(error);
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6 border-b border-line pb-4">
        <h1 className="text-3xl font-black text-ink-0">Audit Log</h1>
        <p className="mt-1 text-sm text-ink-2">
          Siapa menjalankan aksi apa, kapan, dan dengan parameter apa. Baris berasal langsung dari{' '}
          <code>audit_logs</code>; tidak ada entri yang disusun di UI.
        </p>
      </div>

      {!isDatabaseConfigured() ? (
        <Notice tone="warn" title="Database belum dikonfigurasi">
          Setel <code>DATABASE_URL</code> untuk membaca audit log.
        </Notice>
      ) : unavailable !== null ? (
        <Notice tone="danger" title="Database tidak dapat dihubungi">
          <p className="font-mono text-xs">{unavailable}</p>
        </Notice>
      ) : rows.length === 0 ? (
        <Notice tone="info" title="Belum ada entri audit">
          Aksi import, run, retry, cancel, takedown, dan merge akan muncul di sini setelah dijalankan.
        </Notice>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface-1">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-xs uppercase text-ink-3">
                <tr>
                  <th className="px-4 py-3">Waktu</th>
                  <th className="px-4 py-3">Aktor</th>
                  <th className="px-4 py-3">Aksi</th>
                  <th className="px-4 py-3">Entitas</th>
                  <th className="px-4 py-3">Parameter</th>
                  <th className="px-4 py-3">IP hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-ink-1">
                {rows.map((row) => (
                  <tr key={row.id} className="align-top hover:bg-surface-2/20">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-3">
                      {formatDateTime(row.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink-0">{row.actor_name ?? '—'}</div>
                      {row.actor_id ? (
                        <div className="font-mono text-[0.7rem] text-ink-3">{row.actor_id}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{row.action}</td>
                    <td className="px-4 py-3 text-xs">
                      <div>{row.entity_type}</div>
                      {row.entity_id ? (
                        <div className="font-mono text-[0.7rem] text-ink-3">{row.entity_id}</div>
                      ) : null}
                    </td>
                    <td className="max-w-[22rem] px-4 py-3">
                      <code className="break-all text-[0.7rem] text-ink-2">{paramsText(row.params)}</code>
                    </td>
                    <td className="px-4 py-3 font-mono text-[0.7rem] text-ink-3">
                      {row.ip_hash ? `${row.ip_hash.slice(0, 12)}…` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between text-sm">
        <Link
          href={page <= 1 ? '/admin/audit' : `/admin/audit?page=${page - 1}`}
          className={page <= 1 ? 'pointer-events-none text-ink-3' : 'text-accent-b hover:underline'}
        >
          ← Sebelumnya
        </Link>
        <span className="text-xs text-ink-3">Halaman {page}</span>
        <Link
          href={`/admin/audit?page=${page + 1}`}
          className={rows.length < limit ? 'pointer-events-none text-ink-3' : 'text-accent-b hover:underline'}
        >
          Berikutnya →
        </Link>
      </div>
    </div>
  );
}
