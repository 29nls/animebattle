import type { Metadata } from 'next';

import { TakedownForm } from '@/components/takedown-form.tsx';

export const metadata: Metadata = {
  title: 'Permintaan Takedown',
  description: 'Kirim permintaan penghapusan konten dan simpan kode tiket untuk penelusuran.',
  alternates: { canonical: '/legal/takedown' },
};

export default async function TakedownPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const params = await searchParams;
  const kind = params.kind === 'privacy' ? 'privacy' : 'takedown';

  return (
    <div className="mx-auto max-w-3xl animate-fade-in pb-16 pt-8">
      <h1 className="mb-4 text-3xl font-black text-ink-0 sm:text-5xl">
        {kind === 'privacy' ? 'Permintaan Privasi' : 'Permintaan Takedown'}
      </h1>
      <p className="mb-6 text-sm leading-relaxed text-ink-2">
        {kind === 'privacy'
          ? 'Gunakan formulir ini untuk meminta akses, koreksi, atau penghapusan data pribadi. Jangan mengirim dokumen identitas melalui formulir.'
          : 'Anime VS Battle menghormati hak kekayaan intelektual. Jika Anda pemegang hak dan menemukan konten yang melanggar, kirim laporan dengan informasi yang lengkap.'}
      </p>

      <div className="space-y-6 text-sm leading-relaxed text-ink-2">
        <div className="rounded-xl border border-line-strong bg-surface-2 p-5">
          <h2 className="text-lg font-bold text-ink-0">Kanal aktif</h2>
          <p className="mt-2">
            Laporan disimpan sebagai tiket dengan kode unik dan hanya dapat dibaca admin. Setelah
            mengirim, simpan kode tiket yang muncul. Kami tidak menampilkan alamat surel contoh yang
            tidak dipantau; komunikasi lanjutan dilakukan operator melalui surel yang Anda berikan.
          </p>
          <p className="mt-2 text-xs text-ink-3">
            Jangan masukkan kata sandi, token, atau dokumen identitas. Bukti kepemilikan dapat diminta
            setelah tiket dibuat.
          </p>
        </div>

        <section aria-labelledby="formulir">
          <h2 id="formulir" className="mb-3 text-xl font-bold text-ink-0">
            Formulir laporan
          </h2>
          <TakedownForm kind={kind} />
        </section>

        <section>
          <h2 className="mb-3 text-xl font-bold text-ink-0">Proses penanganan</h2>
          <ol className="list-decimal space-y-2 pl-5">
            <li>Tiket dibuat dan masuk status <strong>new</strong>.</li>
            <li>Operator memverifikasi kelengkapan dan kewenangan pelapor.</li>
            <li>Konten yang terbukti melanggar disembunyikan atau sumbernya dinonaktifkan.</li>
            <li>Operator mencatat keputusan dan menghubungi pelapor melalui surel.</li>
          </ol>
          <p className="mt-3 text-xs text-ink-3">
            Target penanganan mengikuti runbook internal: verifikasi ≤ 3 hari kerja dan tindakan ≤ 7
            hari kerja. Ini target operasional, bukan janji hukum.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-bold text-ink-0">Sebelum mengajukan</h2>
          <p>
            Setiap klaim statistik mencantumkan sumbernya. Jika masalahnya adalah data yang keliru,
            lihat{' '}
            <a href="/legal/methodology" className="text-accent-b underline underline-offset-2">
              metodologi
            </a>{' '}
            dan panel “Jejak Sumber Data” pada halaman karakter. Untuk informasi tentang data pribadi,
            baca{' '}
            <a href="/legal/privacy" className="text-accent-b underline underline-offset-2">
              kebijakan privasi
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
