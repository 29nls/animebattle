'use client';

/**
 * Batas galat tingkat route.
 *
 * `global-error` hanya menangkap kegagalan layout akar; galat di dalam halaman
 * (mis. bug render yang lolos dari `attemptLoad`) sampai ke boundary ini.
 * Navigasi dan footer tetap tampil karena layout tidak diganti.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div role="alert" className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center text-center">
      <div aria-hidden="true" className="text-5xl">
        💥
      </div>
      <h1 className="mt-4 text-3xl font-black text-ink-0">Halaman gagal dimuat</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-2">
        Terjadi kesalahan saat merender halaman ini. Data yang sudah tampil sebelumnya tidak berubah;
        coba muat ulang bagian ini.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-xs text-ink-3">ID galat: {error.digest}</p>
      )}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="btn-primary">
          Coba lagi
        </button>
        <a
          href="/"
          className="rounded-lg border border-line bg-surface-1 px-5 py-2.5 text-sm font-medium text-ink-1 transition-colors hover:bg-surface-2"
        >
          Kembali ke beranda
        </a>
      </div>
    </div>
  );
}
