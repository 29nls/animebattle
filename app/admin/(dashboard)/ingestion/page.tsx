import type { Metadata } from 'next';
import Link from 'next/link';

import { getSqlClient, isDatabaseConfigured, isDatabaseUnavailable } from '@/lib/db/client.ts';
import { listIngestionErrors, listIngestionJobs } from '@/features/admin/queries.ts';
import type { IngestionErrorRow, IngestionJobRow } from '@/features/admin/queries.ts';
import { Notice, StatusBadge, formatDateTime } from '@/features/admin/ui.tsx';
import { cancelJobAction, importDatasetAction, importUrlAction, retryJobAction, syncNowAction } from '../actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ingestion Jobs',
  description: 'Monitor dan kelola job ingestion pipeline.',
};

const STATUS_TABS = ['all', 'pending', 'processing', 'completed', 'partial', 'failed', 'skipped'] as const;

const SUCCESS_STATES: Record<string, string> = {
  sync_queued: 'Job sinkronisasi masuk antrian. Worker menerapkannya di proses terpisah.',
  url_queued: 'Job impor URL masuk antrian. Worker memeriksa allow-list, robots.txt, dan rate limit sumber.',
  dataset_staged: 'Dataset di-stage dan job impor masuk antrian.',
  dataset_staged_dry: 'Dataset di-stage sebagai dry-run: worker memeriksa tanpa menulis apa pun.',
  job_requeued: 'Job dikembalikan ke antrian.',
  job_cancelled: 'Job ditandai skipped.',
};

const WARN_STATES: Record<string, string> = {
  invalid_url: 'URL harus lengkap dan berprotokol http/https.',
  url_not_allowed:
    'URL tidak diizinkan oleh allow-list sumber (AC-19). Daftarkan sumbernya lebih dulu dengan legal_status allowed dan metadata lisensi (LP-6).',
  empty_dataset: 'Isi dulu kolom dataset JSON.',
  invalid_json: 'JSON tidak dapat dibaca.',
  import_rejected: 'Impor ditolak sebelum masuk antrian.',
  job_not_retryable: 'Job tidak dapat di-retry (tidak ada, sedang processing, atau sudah selesai).',
  job_not_cancellable: 'Job tidak dapat dibatalkan (tidak ada atau sedang processing).',
};

const DANGER_STATES: Record<string, string> = {
  db_unavailable: 'Database tidak dapat dihubungi; tidak ada perubahan yang dilakukan.',
  rate_limited: 'Terlalu banyak aksi dalam satu menit. Tunggu sebentar.',
  failed: 'Aksi gagal karena kesalahan tak terduga. Periksa log server untuk detailnya.',
};

function StateBanner({ state, detail }: { state?: string; detail?: string }) {
  if (!state) return null;
  if (SUCCESS_STATES[state]) {
    return (
      <Notice tone="success" title={SUCCESS_STATES[state]}>
        {detail ? <p className="font-mono text-xs">{detail}</p> : null}
      </Notice>
    );
  }
  if (WARN_STATES[state]) {
    return (
      <Notice tone="warn" title={WARN_STATES[state]}>
        {detail ? <p className="font-mono text-xs">{detail}</p> : null}
      </Notice>
    );
  }
  if (DANGER_STATES[state]) {
    return (
      <Notice tone="danger" title={DANGER_STATES[state]}>
        {detail ? <p className="font-mono text-xs">{detail}</p> : null}
      </Notice>
    );
  }
  return <Notice tone="info" title={`Status tidak dikenal: ${state}`} />;
}

function errorPayloadText(payload: unknown): string | null {
  if (payload === null || payload === undefined) return null;
  try {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return text.length > 400 ? `${text.slice(0, 400)}…` : text;
  } catch {
    return null;
  }
}

function ErrorPanel({ errors }: { errors: IngestionErrorRow[] }) {
  if (errors.length === 0) {
    return <p className="text-xs text-ink-3">Tidak ada baris error untuk job ini.</p>;
  }
  return (
    <ul className="space-y-2">
      {errors.map((error) => (
        <li key={error.id} className="rounded-lg border border-line bg-surface-2/40 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-accent-lose/20 px-2 py-0.5 font-bold uppercase text-accent-lose">
              {error.error_type}
            </span>
            {error.http_status !== null ? (
              <span className="text-ink-2">HTTP {error.http_status}</span>
            ) : null}
            <span className="text-ink-3">retry {error.retry_count}</span>
            <span className="text-ink-3">{formatDateTime(error.created_at)}</span>
          </div>
          <p className="mt-2 text-ink-1">{error.error_message}</p>
          {error.source_url ? (
            <p className="mt-1 break-all font-mono text-[0.7rem] text-ink-3">{error.source_url}</p>
          ) : null}
          {errorPayloadText(error.payload) ? (
            <pre className="mt-2 overflow-x-auto rounded bg-surface-3/60 p-2 font-mono text-[0.7rem] text-ink-2">
              {errorPayloadText(error.payload)}
            </pre>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export default async function AdminIngestionPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; state?: string; detail?: string; job?: string }>;
}) {
  const query = await searchParams;
  const status = STATUS_TABS.includes((query.status ?? 'all') as (typeof STATUS_TABS)[number])
    ? query.status ?? 'all'
    : 'all';

  let jobs: IngestionJobRow[] = [];
  let errorsByJob = new Map<string, IngestionErrorRow[]>();
  let unavailable: string | null = null;

  if (isDatabaseConfigured()) {
    try {
      const sql = getSqlClient();
      jobs = await listIngestionJobs(sql, {
        limit: 50,
        ...(status === 'all' ? {} : { status }),
      });
      // Error diambil sekaligus untuk seluruh job yang tampil — satu query
      // tambahan, bukan satu query per baris.
      const errors = await listIngestionErrors(sql, { jobIds: jobs.map((job) => job.id) });
      errorsByJob = errors.reduce<Map<string, IngestionErrorRow[]>>((map, error) => {
        const list = map.get(error.job_id) ?? [];
        list.push(error);
        map.set(error.job_id, list);
        return map;
      }, new Map());
    } catch (error) {
      if (!isDatabaseUnavailable(error)) throw error;
      unavailable = error instanceof Error ? error.message : String(error);
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-ink-0">Ingestion Pipeline</h1>
          <p className="mt-1 text-sm text-ink-2">
            Jalur request hanya mengantrikan; pekerjaannya dijalankan worker terpisah (AC-25). Semua error
            di bawah berasal dari <code>ingestion_errors</code> — tidak ada yang disimpulkan di UI.
          </p>
        </div>
        <form action={syncNowAction}>
          <button type="submit" className="rounded-lg border border-line bg-surface-2 px-4 py-2 text-sm font-medium text-ink-1 transition-colors hover:bg-surface-3">
            Sync Now (scheduled_full)
          </button>
        </form>
      </div>

      <div className="space-y-3">
        <StateBanner state={query.state} detail={query.detail} />
        {query.job ? (
          <Notice tone="info" title="Job terkait">
            <p className="font-mono text-xs">{query.job}</p>
          </Notice>
        ) : null}
        {!isDatabaseConfigured() ? (
          <Notice tone="warn" title="Database belum dikonfigurasi">
            Setel <code>DATABASE_URL</code> untuk melihat antrian. Halaman ini tidak menampilkan job contoh.
          </Notice>
        ) : unavailable !== null ? (
          <Notice tone="danger" title="Database tidak dapat dihubungi">
            <p className="font-mono text-xs">{unavailable}</p>
          </Notice>
        ) : null}
      </div>

      {isDatabaseConfigured() && unavailable === null ? (
        <>
          <div className="mt-6 flex gap-1 overflow-x-auto border-b border-line">
            {STATUS_TABS.map((tab) => (
              <Link
                key={tab}
                href={tab === 'all' ? '/admin/ingestion' : `/admin/ingestion?status=${tab}`}
                className={`rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                  tab === status
                    ? 'border-x border-t border-line-strong bg-surface-2 text-ink-0'
                    : 'text-ink-2 hover:bg-surface-1 hover:text-ink-0'
                }`}
              >
                {tab}
              </Link>
            ))}
          </div>

          <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface-1">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-xs uppercase text-ink-3">
                  <tr>
                    <th className="px-4 py-3">Job</th>
                    <th className="px-4 py-3">Scope</th>
                    <th className="px-4 py-3">Sumber</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Records</th>
                    <th className="px-4 py-3">Retry</th>
                    <th className="px-4 py-3">Dibuat</th>
                    <th className="px-4 py-3">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line text-ink-1">
                  {jobs.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-ink-3">
                        <div className="flex flex-col items-center gap-2">
                          <span className="text-3xl opacity-50">📋</span>
                          <p className="font-medium">Tidak ada job pada filter ini</p>
                          <p className="max-w-md text-xs">
                            Buat job dengan Sync Now, impor dataset JSON, atau impor URL di bawah. Setiap job
                            akan menampilkan status, error, dan retry-nya.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    jobs.map((job) => {
                      const jobErrors = errorsByJob.get(job.id) ?? [];
                      return (
                        <tr key={job.id} className="align-top hover:bg-surface-2/20">
                          <td className="px-4 py-3">
                            <details className="group">
                              <summary className="cursor-pointer font-mono text-xs text-accent-b">
                                {job.id.slice(0, 8)}…
                              </summary>
                              <div className="mt-2 w-[24rem] space-y-2 rounded-lg border border-line bg-surface-2/40 p-3">
                                <p className="font-mono text-[0.7rem] text-ink-2">{job.id}</p>
                                <dl className="grid grid-cols-2 gap-1 text-[0.7rem] text-ink-2">
                                  <dt>parser</dt>
                                  <dd className="font-mono">{job.parser_version ?? '—'}</dd>
                                  <dt>dry-run</dt>
                                  <dd>{job.dry_run ? 'ya' : 'tidak'}</dd>
                                  <dt>mulai</dt>
                                  <dd>{formatDateTime(job.started_at)}</dd>
                                  <dt>selesai</dt>
                                  <dd>{formatDateTime(job.completed_at)}</dd>
                                  <dt>percobaan berikut</dt>
                                  <dd>{formatDateTime(job.next_attempt_at)}</dd>
                                </dl>
                                {job.dry_run ? (
                                  <p className="text-[0.7rem] text-accent-flag">
                                    Dry-run: worker memeriksa tanpa menulis baris kanonik.
                                  </p>
                                ) : null}
                                <ErrorPanel errors={jobErrors} />
                              </div>
                            </details>
                          </td>
                          <td className="px-4 py-3 font-medium text-ink-0">{job.scope}</td>
                          <td className="px-4 py-3">
                            {job.source_slug ? (
                              <span title={job.source_name ?? ''}>{job.source_slug}</span>
                            ) : (
                              <span className="text-ink-3">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={job.status} />
                            {job.error_type ? (
                              <div className="mt-1 text-[0.7rem] text-accent-lose">{job.error_type}</div>
                            ) : null}
                            {job.error_message ? (
                              <div className="mt-1 max-w-[18rem] text-[0.7rem] text-ink-2" title={job.error_message}>
                                {job.error_message.length > 140
                                  ? `${job.error_message.slice(0, 140)}…`
                                  : job.error_message}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            <div>found {job.records_found}</div>
                            <div className="text-accent-win">created {job.records_created}</div>
                            <div>updated {job.records_updated}</div>
                            <div className={job.records_failed > 0 ? 'text-accent-lose' : ''}>
                              failed {job.records_failed}
                            </div>
                            {jobErrors.length > 0 ? (
                              <div className="mt-1 text-ink-3">{jobErrors.length} error tercatat</div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {job.retry_count}/{job.max_retries}
                          </td>
                          <td className="px-4 py-3 text-xs text-ink-3">{formatDateTime(job.created_at)}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-2">
                              <form action={retryJobAction}>
                                <input type="hidden" name="job_id" value={job.id} />
                                <button
                                  type="submit"
                                  className="w-full rounded border border-line bg-surface-2 px-2 py-1 text-xs text-ink-1 hover:bg-surface-3"
                                >
                                  Retry
                                </button>
                              </form>
                              <form action={cancelJobAction}>
                                <input type="hidden" name="job_id" value={job.id} />
                                <button
                                  type="submit"
                                  className="w-full rounded border border-line bg-surface-2 px-2 py-1 text-xs text-ink-3 hover:bg-surface-3"
                                >
                                  Cancel
                                </button>
                              </form>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface-1 p-6">
          <h2 className="text-lg font-bold text-ink-0">Impor dataset (JSON)</h2>
          <p className="mt-1 text-xs text-ink-2">
            Dataset di-stage ke <code>ingestion_raw_pages</code> lalu diantrikan. Validasi bentuk penuh
            dijalankan worker — itulah sebabnya dataset cacat tetap terlihat sebagai job <em>failed</em>
            beserta alasannya, bukan ditolak diam-diam di sini.
          </p>
          <form action={importDatasetAction} className="mt-4 space-y-3">
            <textarea
              name="dataset"
              rows={8}
              className="input-field w-full font-mono text-xs"
              placeholder={`{\n  "parser_version": "dataset-json@1.0.0",\n  "source_slug": "admin-dataset-import",\n  "verse": { "slug": "…", "name": "…" },\n  "characters": [ … ]\n}`}
            />
            <label className="flex items-center gap-2 text-sm text-ink-1">
              <input type="checkbox" name="dry_run" />
              Dry-run (periksa tanpa menulis)
            </label>
            <button type="submit" className="btn-primary w-full text-sm">
              Stage &amp; antrikan impor
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-line bg-surface-1 p-6">
          <h2 className="text-lg font-bold text-ink-0">Impor URL</h2>
          <p className="mt-1 text-xs text-ink-2">
            URL harus cocok dengan <code>base_url</code> sumber berstatus <code>allowed</code>. Worker
            memeriksa robots.txt, kelas alamat IP (SSRF), dan rate limit per host sebelum mengambil isinya.
          </p>
          <form action={importUrlAction} className="mt-4 space-y-3">
            <input
              type="url"
              name="url"
              required
              className="input-field w-full"
              placeholder="https://sumber-contoh.test/api/verse/xyz"
            />
            <button type="submit" className="btn-primary w-full text-sm">
              Antrikan impor URL
            </button>
          </form>

          <div className="mt-6 border-t border-line pt-4 text-xs text-ink-2">
            <h3 className="font-bold text-ink-0">Tahapan yang dijalankan worker</h3>
            <p className="mt-1 leading-relaxed">
              <code className="text-accent-b">fetch → parse → normalize → validate → dedupe → resolve →
              upsert</code>. Kegagalan sementara (429/5xx/timeout) kembali ke antrian dengan backoff;
              kegagalan tetap (kebijakan, 401/403, data tak sah) langsung berstatus <code>failed</code>.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
