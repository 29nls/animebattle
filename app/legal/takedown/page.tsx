import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Takedown Request',
  description: 'Ajukan permintaan penghapusan konten yang melanggar hak cipta.',
  // Self-canonical seperti halaman legal lain (warisan '/' dari layout tidak
  // valid menurut audit Lighthouse `canonical`).
  alternates: { canonical: '/legal/takedown' },
};

export default function TakedownPage() {
  return (
    <div className="mx-auto max-w-3xl animate-fade-in pb-16 pt-8">
      <h1 className="text-3xl font-black text-ink-0 sm:text-5xl mb-8">Takedown Request</h1>
      
      <div className="space-y-6 text-sm text-ink-2 leading-relaxed">
        <div className="rounded-xl border border-accent-flag/30 bg-accent-flag/10 p-5">
          <p className="text-accent-flag font-medium">
            Anime VS Battle menghormati hak kekayaan intelektual. Jika Anda adalah pemegang hak cipta 
            dan menemukan konten yang melanggar hak Anda, silakan ajukan permintaan penghapusan melalui 
            formulir di bawah.
          </p>
        </div>

        <section>
          <h2 className="text-xl font-bold text-ink-0 mb-3">Proses Penghapusan</h2>
          <ol className="list-decimal pl-5 space-y-2">
            <li>Kirimkan permintaan dengan informasi lengkap tentang konten yang dimaksud</li>
            <li>Tim kami akan meninjau permintaan dalam waktu 3–5 hari kerja</li>
            <li>Konten yang terbukti melanggar akan dihapus atau dimodifikasi</li>
            <li>Anda akan menerima konfirmasi setelah tindakan diambil</li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-0 mb-3">Informasi yang Dibutuhkan</h2>
          <form className="mt-4 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-3">Nama Anda / Organisasi</label>
              <input type="text" className="input-field" placeholder="Nama lengkap atau nama organisasi" required />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-3">Email Kontak</label>
              <input type="email" className="input-field" placeholder="email@example.com" required />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-3">URL Konten yang Dilaporkan</label>
              <input type="url" className="input-field" placeholder="https://animevsbattle.com/character/..." required />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-3">Deskripsi Pelanggaran</label>
              <textarea className="input-field min-h-[120px] resize-y" placeholder="Jelaskan konten yang melanggar dan hak yang Anda miliki..." required />
            </div>
            <div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" className="mt-1 h-4 w-4 rounded border-line bg-surface-2 text-accent-b" required />
                <span className="text-xs text-ink-2">
                  Saya menyatakan bahwa informasi dalam permintaan ini akurat dan saya berwenang 
                  untuk bertindak atas nama pemegang hak cipta.
                </span>
              </label>
            </div>
            <button type="submit" className="btn-primary w-full sm:w-auto">
              Kirim Permintaan Takedown
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
