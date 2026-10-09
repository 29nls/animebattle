/**
 * Potongan tampilan yang dipakai bersama oleh halaman admin.
 *
 * Dipisah agar aturan tampilan status dan format waktu hanya ada satu tempat:
 * bila `/admin` dan `/admin/ingestion` menggambar badge dengan aturannya
 * masing-masing, keduanya akan berbeda begitu satu halaman diperbarui.
 * Tidak ada query atau aksi di sini — komponen ini murni presentasi.
 */

import type { ReactNode } from 'react';

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-accent-win/20 text-accent-win',
  partial: 'bg-accent-flag/20 text-accent-flag',
  failed: 'bg-accent-lose/20 text-accent-lose',
  processing: 'bg-accent-b/20 text-accent-b',
  pending: 'bg-surface-3 text-ink-1',
  skipped: 'bg-surface-3 text-ink-3',
};

/** Label status yang dibaca admin; nilai tak dikenal tidak disembunyikan. */
export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? 'bg-surface-3 text-ink-1';
  return (
    <span className={`rounded px-2 py-0.5 text-[0.65rem] font-bold uppercase ${style}`}>
      {status}
    </span>
  );
}

/**
 * Waktu dalam UTC, deterministik antara server dan test.
 *
 * Sengaja bukan waktu relatif ("10 menit lalu"): halaman ini dirender server dan
 * direvalidasi saat aksi terjadi, sehingga label relatif justru berbohong —
 * "baru saja" tetap "baru saja" setelah halaman dibuka lama. UTC juga menghindari
 * perbedaan hasil antar lingkungan.
 */
export function formatDateTime(value: string | null): string {
  if (value === null) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'default' | 'warn' | 'danger' | 'brand';
}) {
  const tones: Record<string, string> = {
    default: 'border-line bg-surface-1',
    warn: 'border-accent-flag/30 bg-accent-flag/5',
    danger: 'border-accent-lose/30 bg-accent-lose/5',
    brand: 'border-accent-b/30 bg-accent-b/5',
  };
  return (
    <div className={`rounded-xl border p-5 shadow-sm ${tones[tone]}`}>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">{label}</h3>
      <div className="mt-2 text-3xl font-black text-ink-0">{value}</div>
      {hint ? <p className="mt-1 text-xs text-ink-2">{hint}</p> : null}
    </div>
  );
}

/** Keadaan yang harus terlihat sebagai keadaan, bukan sebagai kegagalan render. */
export function Notice({
  tone,
  title,
  children,
}: {
  tone: 'info' | 'warn' | 'danger' | 'success';
  title: string;
  children?: ReactNode;
}) {
  const tones: Record<string, string> = {
    info: 'border-line bg-surface-1 text-ink-2',
    warn: 'border-accent-flag/30 bg-accent-flag/10 text-accent-flag',
    danger: 'border-accent-lose/30 bg-accent-lose/10 text-accent-lose',
    success: 'border-accent-win/30 bg-accent-win/10 text-accent-win',
  };
  return (
    <div className={`rounded-xl border p-4 text-sm ${tones[tone]}`}>
      <p className="font-semibold">{title}</p>
      {children ? <div className="mt-1 leading-relaxed">{children}</div> : null}
    </div>
  );
}
