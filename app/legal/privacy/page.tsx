import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Kebijakan Privasi',
  description: 'Data yang diproses Anime VS Battle, tujuan, retensi, dan cara mengajukan permintaan.',
  alternates: { canonical: '/legal/privacy' },
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl animate-fade-in pb-16 pt-8">
      <h1 className="text-3xl font-black text-ink-0 sm:text-5xl">Kebijakan Privasi</h1>
      <p className="mt-3 text-xs text-ink-3">Berlaku sejak 5 November 2026.</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-ink-2">
        <section>
          <h2 className="text-xl font-bold text-ink-0">1. Pengelola</h2>
          <p className="mt-2">
            Anime VS Battle dikelola oleh operator proyek dengan nama yang sama. Identitas badan
            hukum, alamat, dan yurisdiksi pengelola belum ditetapkan; karena itu halaman ini tidak
            mengarang entitas atau alamat. Kontak untuk urusan privasi tersedia melalui formulir di
            bagian 7.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-0">2. Data yang diproses</h2>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>
              <strong>Laporan takedown/privacy:</strong> nama, surel, URL yang dilaporkan, deskripsi,
              pernyataan iktikad baik, kode tiket, status peninjauan, dan catatan penyelesaian.
            </li>
            <li>
              <strong>Data teknis:</strong> log server dan hash IP harian untuk pembatasan laju.
              IP mentah tidak disimpan oleh pembatas laju; log tidak memuat isi laporan.
            </li>
            <li>
              <strong>Sesi admin:</strong> bila Anda masuk ke panel admin, sesi dikelola Supabase Auth
              dan cookie sesi hanya digunakan untuk autentikasi.
            </li>
            <li>
              <strong>Tidak ada iklan atau pelacakan lintas situs.</strong> Situs tidak memasang
              cookie analytics pihak ketiga.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-0">3. Tujuan dan dasar pemrosesan</h2>
          <p className="mt-2">
            Data laporan diproses untuk menanggapi klaim hak cipta atau hak data, memverifikasi
            kewenangan pelapor, menjaga bukti penanganan, dan memenuhi kewajiban hukum yang berlaku.
            Data teknis diproses untuk keamanan, pencegahan penyalahgunaan, dan diagnosis gangguan.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-0">4. Retensi</h2>
          <p className="mt-2">
            Tiket legal disimpan maksimal 24 bulan setelah tiket ditutup, kecuali diperlukan lebih
            lama untuk menanggapi sengketa atau memenuhi kewajiban hukum. Setelah itu data pribadi
            dihapus atau dianonimkan; catatan agregat tanpa identitas dapat dipertahankan.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-0">5. Akses dan pembagian</h2>
          <p className="mt-2">
            Data laporan hanya dapat dibaca admin yang terautentikasi dan wajib MFA. Data tidak
            dijual. Data dapat diproses oleh penyedia hosting, database, autentikasi, dan pemantauan
            error yang diperlukan untuk menjalankan layanan, dengan akses terbatas pada kebutuhan
            operasional. Nama penyedia tertentu tidak dicantumkan sampai konfigurasi produksi
            final.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-0">6. Keamanan</h2>
          <p className="mt-2">
            Akses admin memakai autentikasi Supabase, TOTP untuk peran admin, serta RLS dan grant
            database. Laporan tidak menerima insert anonim langsung ke database; endpoint publik
            memvalidasi input, menolak permintaan lintas situs, dan membatasi laju.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-0">7. Hak dan cara menghubungi</h2>
          <p className="mt-2">
            Anda dapat meminta akses, koreksi, atau penghapusan data pribadi melalui formulir laporan
            dengan jenis <strong>privacy</strong>. Sertakan URL atau kode tiket yang relevan; jangan
            mengirim dokumen identitas melalui formulir. Permintaan akan ditinjau melalui kanal yang
            sama dengan takedown.
          </p>
          <a
            href="/legal/takedown?kind=privacy"
            className="mt-3 inline-flex rounded-lg border border-line bg-surface-2 px-4 py-2 font-medium text-ink-1 hover:bg-surface-3"
          >
            Buka formulir permintaan privacy
          </a>
        </section>

        <div className="rounded-xl border border-accent-flag/30 bg-accent-flag/10 p-4 text-xs text-ink-2">
          Halaman ini menjelaskan praktik yang sudah diterapkan di kode. Peninjauan legal formal
          (entitas, yurisdiksi, dan dasar hukum akhir) masih terbuka dan dicatat di checklist
          peluncuran.
        </div>
      </div>
    </div>
  );
}
