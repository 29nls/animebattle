import Link from 'next/link';

/**
 * Custom 404 page. PRD §29: degradasi yang jelas,
 * bukan halaman error default yang membingungkan.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center animate-fade-in-up">
      <div className="text-6xl mb-6 animate-float">⚔️</div>
      <h1 className="text-4xl font-black text-ink-0 sm:text-5xl">404</h1>
      <p className="mt-3 text-lg text-ink-2 max-w-md">
        Halaman yang Anda cari tidak ditemukan. Karakter ini mungkin belum masuk database, 
        atau URL-nya sudah berubah.
      </p>
      <div className="mt-8 flex gap-3">
        <Link href="/" className="btn-primary">
          Kembali ke Home
        </Link>
        <Link href="/characters" className="rounded-lg border border-line bg-surface-1 px-5 py-2.5 text-sm font-medium text-ink-1 hover:bg-surface-2 transition-colors">
          Cari Karakter
        </Link>
      </div>
    </div>
  );
}
