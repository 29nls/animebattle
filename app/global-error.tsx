'use client';

/**
 * Global error boundary. PRD §29: kegagalan harus jelas,
 * bukan halaman putih yang membuat pengguna menebak.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="id">
      <body className="flex min-h-screen items-center justify-center bg-[oklch(0.13_0.015_270)] text-[oklch(0.88_0.01_265)] font-sans antialiased">
        <div className="mx-auto max-w-md px-4 text-center">
          <div className="text-5xl mb-4">💥</div>
          <h1 className="text-3xl font-black text-white">Terjadi Kesalahan</h1>
          <p className="mt-3 text-sm leading-relaxed opacity-70">
            Sesuatu tidak berjalan seperti seharusnya. Jika masalah ini terus terjadi,
            silakan hubungi tim pengembang.
          </p>
          {error.digest && (
            <p className="mt-2 font-mono text-xs opacity-40">
              Error ID: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            className="mt-6 rounded-lg bg-[oklch(0.7_0.18_255)] px-6 py-2.5 text-sm font-semibold text-white shadow-lg transition-transform hover:-translate-y-0.5"
          >
            Coba Lagi
          </button>
        </div>
      </body>
    </html>
  );
}
