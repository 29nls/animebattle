/**
 * Rangka pemuatan bersama untuk route yang membaca database.
 *
 * Server component: tidak menambah JavaScript klien. `role="status"` +
 * `aria-busy` memberi tahu pembaca layar bahwa halaman sedang dimuat, sementara
 * bentuk kartu menjaga layout tidak melompat saat konten datang.
 */
export function PageSkeleton({ label = 'Memuat halaman…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="animate-fade-in">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="space-y-6">
        <div className="space-y-3">
          <div className="skeleton h-9 w-2/3 max-w-md" />
          <div className="skeleton h-4 w-full max-w-xl" />
          <div className="skeleton h-4 w-1/2 max-w-sm" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="rounded-xl border border-line bg-surface-1 p-4">
              <div className="flex items-start gap-4">
                <div className="skeleton h-16 w-16 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-4 w-3/4" />
                  <div className="skeleton h-3 w-1/2" />
                  <div className="skeleton h-5 w-16" />
                </div>
              </div>
              <div className="skeleton mt-4 h-3 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
