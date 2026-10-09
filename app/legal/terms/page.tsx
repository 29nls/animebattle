import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Use',
  description: 'Ketentuan penggunaan layanan Anime VS Battle.',
  // Tanpa ini, halaman mewarisi canonical '/' dari layout dan audit Lighthouse
  // `canonical` gagal: "Points to the domain's root URL" (AC-22).
  alternates: { canonical: '/legal/terms' },
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl animate-fade-in pb-16 pt-8">
      <h1 className="text-3xl font-black text-ink-0 sm:text-5xl mb-8">Terms of Use</h1>
      
      <div className="space-y-8 text-sm text-ink-2 leading-relaxed">
        <section>
          <h2 className="text-xl font-bold text-ink-0 mb-3">1. Tentang Layanan</h2>
          <p>
            Anime VS Battle (&quot;Layanan&quot;) adalah platform database karakter fiksi yang menyediakan 
            perbandingan statistik dan simulasi pertarungan analitis. Layanan ini bersifat informasional 
            dan bukan merupakan otoritas resmi atas kekuatan kanon karakter.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-0 mb-3">2. Sifat Hasil Simulasi</h2>
          <p>
            Semua hasil pertarungan yang ditampilkan adalah <strong className="text-ink-0">simulasi analitis</strong> berdasarkan 
            data yang tersedia di database. Hasil ini:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Bukan hasil resmi dari pemegang hak cipta karakter</li>
            <li>Bukan klaim kanon</li>
            <li>Dapat berubah seiring pembaruan data dan aturan engine</li>
            <li>Bersifat deterministik: input yang sama menghasilkan output yang sama</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-0 mb-3">3. Hak Kekayaan Intelektual</h2>
          <p>
            Nama karakter, judul seri, dan elemen cerita yang disebutkan dalam database adalah milik 
            pemegang hak cipta masing-masing. Penggunaan nama-nama tersebut dalam Layanan ini dilakukan 
            untuk keperluan referensi, informasi, dan analisis komparatif.
          </p>
          <p className="mt-2">
            Jika Anda adalah pemegang hak cipta dan ingin mengajukan permintaan penghapusan data, 
            silakan kunjungi halaman <a href="/legal/takedown" className="text-accent-b underline underline-offset-2 hover:text-ink-0">Takedown Request</a>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-0 mb-3">4. Penggunaan yang Dilarang</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Mengakses API secara masif untuk mengambil dump database (rate limited)</li>
            <li>Menyajikan hasil simulasi sebagai &quot;kebenaran kanon resmi&quot;</li>
            <li>Menggunakan data untuk tujuan komersial tanpa izin</li>
            <li>Melakukan serangan terhadap infrastruktur Layanan</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-0 mb-3">5. Sumber Data</h2>
          <p>
            Data dalam database dikumpulkan dari sumber publik yang tercantum pada setiap halaman karakter. 
            Setiap klaim statistik menyimpan referensi ke sumber aslinya (<code className="text-accent-b">source_url</code>, 
            <code className="text-accent-b">fetched_at</code>, <code className="text-accent-b">parser_version</code>).
          </p>
        </section>

        <div className="mt-12 rounded-xl border border-line-strong bg-surface-2 p-6">
          <p className="text-xs text-ink-3">
            Terakhir diperbarui: Oktober 2026. Ketentuan ini dapat berubah sewaktu-waktu. 
            Penggunaan Layanan setelah perubahan dianggap sebagai persetujuan terhadap ketentuan terbaru.
          </p>
        </div>
      </div>
    </div>
  );
}
