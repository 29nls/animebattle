import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'VS builder',
  description:
    'Pilih dua form karakter, atur kondisi pertarungan, lalu jalankan simulasi dan lihat alasan di balik hasilnya.',
  alternates: { canonical: '/versus' },
};

/**
 * VS builder (PRD §16). Bentuknya sengaja HTML biasa: pemilih karakter, pemilih
 * form, dan pengaturan kondisi dikirim sebagai satu form. Interaktivitas klien
 * ditambahkan pada Sprint 3 hanya sebatas yang tidak dapat dilakukan server —
 * setiap byte JS yang tidak perlu adalah byte yang membebani halaman ini.
 */
export default async function VersusPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const params = await searchParams;
  const sideA = params.a?.trim() ?? '';
  const sideB = params.b?.trim() ?? '';
  const bothChosen = sideA !== '' && sideB !== '';

  return (
    <>
      <h1 className="text-2xl font-semibold text-ink-0">Battle builder</h1>
      <p className="mt-1 text-sm text-ink-2">
        Form karakter dipilih per pertarungan. Statistik tidak dilekatkan pada karakter, melainkan
        pada form/eranya.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <div className="rounded-lg border border-line bg-surface-1 p-4">
          <p className="text-xs uppercase tracking-wide text-ink-3">Character A</p>
          <p className="mt-1 font-medium text-ink-0">{sideA || '— belum dipilih —'}</p>
        </div>
        <span aria-hidden className="text-center text-lg font-bold text-accent-a">
          VS
        </span>
        <div className="rounded-lg border border-line bg-surface-1 p-4">
          <p className="text-xs uppercase tracking-wide text-ink-3">Character B</p>
          <p className="mt-1 font-medium text-ink-0">{sideB || '— belum dipilih —'}</p>
        </div>
      </div>

      <section className="mt-8 rounded-lg border border-line bg-surface-1 p-5 text-sm">
        <h2 className="font-medium text-ink-0">Langkah berikutnya</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-2">
          <li>Pemilih form per sisi (menggantikan input teks bebas).</li>
          <li>Pengaturan kondisi: mode, knowledge, prep time, jarak awal, win condition.</li>
          <li>
            Tombol simulasi memanggil{' '}
            <code className="font-mono text-xs text-ink-1">POST /api/battle/simulate</code> dengan
            dua <code className="font-mono text-xs text-ink-1">character_version_id</code>.
          </li>
        </ul>
        <p className="mt-3 text-xs text-ink-3">
          {bothChosen
            ? 'Kedua sisi terisi. Pemilih form dan pemanggilan engine dipasang pada Sprint 3.'
            : 'Pilih dua karakter dari homepage untuk mengisi kedua sisi.'}
        </p>
      </section>
    </>
  );
}
