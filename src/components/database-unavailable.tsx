/**
 * Panel "database belum terhubung" — satu tampilan untuk semua halaman yang
 * memuat data (daftar karakter, daftar verse, detail karakter, detail verse).
 *
 * Kenapa satu komponen: keempat halaman menghadapi kegagalan yang sama ketika
 * database tidak dapat dihubungi, dan sebelum ini hanya `/characters` yang
 * menanganinya; tiga halaman lain melempar galat ke runtime Next dan menjawab
 * HTTP 500.
 *
 * **Siapa melihat apa** — kebijakannya ada di sini, bukan di tiap halaman:
 *   * pengunjung anonim hanya menerima `GENERIC_UNAVAILABLE_MESSAGE`: status
 *     gangguan tanpa nama variabel lingkungan, host, atau nama tabel;
 *   * blok instruksi (`DATABASE_URL`, `ALLOW_DEMO_DATA`) dirender **hanya** bila
 *     `viewerIsOperator` benar — yaitu sesi panel admin yang sah.
 *
 * Detail teknis lengkap tetap tersedia bagi operator lewat log server
 * (`attemptLoad` mencatatnya) dan `/api/health/ready`. Catatan cakupan: cookie
 * sesi admin di-scope `path=/admin` (`features/admin/session.ts`), sehingga pada
 * halaman publik `viewerIsOperator` bernilai false untuk semua orang — termasuk
 * admin — sampai path cookie itu diperluas.
 *
 * Murni presentasional: tanpa state dan tanpa akses data; teks dipilih oleh
 * `visibleFailureMessage` di `features/data-source.ts`.
 */

import { visibleFailureMessage } from '@/features/data-source.ts';

export function DatabaseUnavailable({
  detail,
  viewerIsOperator,
}: {
  /** Pesan teknis lengkap dari `describeLoadFailure` (sudah termasuk saran perbaikan). */
  detail: string;
  /** `true` hanya untuk sesi panel admin yang sah. */
  viewerIsOperator: boolean;
}) {
  return (
    <div className="rounded-xl border border-accent-lose/30 bg-accent-lose/5 p-6 text-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-lose/20 text-accent-lose">
          !
        </div>
        <div>
          <h2 className="text-base font-bold text-accent-lose">Database belum terhubung</h2>
          <p className="mt-2 text-ink-1 leading-relaxed">
            {visibleFailureMessage(detail, viewerIsOperator)}
          </p>
          {viewerIsOperator && (
            <div className="mt-4 rounded bg-surface-0/50 p-3 font-mono text-xs text-ink-2 border border-line">
              <p>Pilih salah satu di .env.local:</p>
              <code className="text-accent-a">DATABASE_URL="postgres://..."</code>
              <p className="mt-2">atau jalankan mode demo tanpa database:</p>
              <code className="text-accent-a">ALLOW_DEMO_DATA=1</code>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
