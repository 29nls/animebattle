/**
 * Panel "database belum terhubung" — satu tampilan untuk semua halaman yang
 * memuat data (daftar karakter, daftar verse, detail karakter, detail verse).
 *
 * Kenapa satu komponen: keempat halaman menghadapi kegagalan yang sama ketika
 * `DATABASE_URL` kosong dan dataset demo tidak diaktifkan, dan sebelum ini
 * hanya `/characters` yang menampilkannya; tiga halaman lain melempar galat ke
 * runtime Next dan menjawab HTTP 500. Panel ini menyebut penyebabnya apa adanya
 * beserta dua cara memperbaikinya (isi `DATABASE_URL`, atau jalankan mode demo).
 *
 * Murni presentasional: tanpa state, tanpa akses data. Pesannya dirakit
 * `features/data-source.ts` (`attemptLoad`/`describeLoadFailure`).
 */

export function DatabaseUnavailable({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-accent-lose/30 bg-accent-lose/5 p-6 text-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-lose/20 text-accent-lose">
          !
        </div>
        <div>
          <h2 className="text-base font-bold text-accent-lose">Database belum terhubung</h2>
          <p className="mt-2 text-ink-1 leading-relaxed">{message}</p>
          <div className="mt-4 rounded bg-surface-0/50 p-3 font-mono text-xs text-ink-2 border border-line">
            <p>Pilih salah satu di .env.local:</p>
            <code className="text-accent-a">DATABASE_URL="postgres://..."</code>
            <p className="mt-2">atau jalankan mode demo tanpa database:</p>
            <code className="text-accent-a">ALLOW_DEMO_DATA=1</code>
          </div>
        </div>
      </div>
    </div>
  );
}
