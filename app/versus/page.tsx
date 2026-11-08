import type { Metadata } from 'next';

import { loadPickerBootstrap } from '@/features/battle/picker-queries.ts';
import { listPopularMatchups, type PopularMatchup } from '@/features/battle/matchup-queries.ts';
import { attemptLoad } from '@/features/data-source.ts';
import { isAdminAuthenticated } from '@/features/admin/session.ts';
import { DatabaseUnavailable } from '@/components/database-unavailable.tsx';
import { FighterPicker } from '@/components/fighter-picker.tsx';
import { DataAttribution } from '@/components/data-attribution.tsx';
import { loadAttribution } from '@/features/attribution/queries.ts';
import { DEMO_LABEL, DEMO_NOTICE } from '@/features/demo/provider.ts';
import { getSqlClient, isDatabaseConfigured } from '@/lib/db/client.ts';
import { parseMatchupSlug } from '@/features/battle/share.ts';

export const metadata: Metadata = {
  title: 'Pembuat Pertarungan',
  description:
    'Pilih dua form karakter, atur kondisi pertarungan, lalu jalankan simulasi dan lihat alasan di balik hasilnya.',
  alternates: { canonical: '/versus' },
};

export const dynamic = 'force-dynamic';

/**
 * "Pertarungan Populer" bersifat pelengkap: kegagalan membacanya tidak boleh
 * menjatuhkan builder. Daftar kosong ditampilkan sebagai tidak ada blok sama
 * sekali, bukan sebagai pesan galat yang menakutkan pengunjung.
 */
async function popularMatchups(): Promise<PopularMatchup[]> {
  if (!isDatabaseConfigured()) return [];
  try {
    return await listPopularMatchups(getSqlClient(), 8);
  } catch (error) {
    console.error('[versus] matchup populer tidak dapat dibaca:', error);
    return [];
  }
}

function matchupTitle(slug: string): string {
  const parsed = parseMatchupSlug(slug);
  if (!parsed) return slug;
  const pretty = (value: string) => value.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return `${pretty(parsed.sideA.characterSlug)} vs ${pretty(parsed.sideB.characterSlug)}`;
}

export default async function VersusPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string; form_a?: string; form_b?: string }>;
}) {
  const params = await searchParams;
  const requestedA = (params.a ?? params.form_a ?? '').trim();
  const requestedB = (params.b ?? params.form_b ?? '').trim();

  // Hanya jumlah form dan label dua sisi yang diminta URL — bukan seluruh
  // katalog. Combobox mengambil sisanya sendiri; lihat `FighterPicker`.
  const outcome = await attemptLoad(() => loadPickerBootstrap(requestedA, requestedB));

  if (outcome.status === 'failed') {
    return (
      <div className="animate-fade-in">
        <DatabaseUnavailable
          detail={outcome.message}
          viewerIsOperator={await isAdminAuthenticated()}
        />
      </div>
    );
  }

  const { source, totalForms, groups, initialA, initialB } = outcome.data;
  const demoSource = source === 'demo';
  const demoOptions = demoSource
    ? groups.flatMap((group) =>
        group.options.map((option) => ({
          value: option.value,
          label: `${group.label}: ${option.label}`,
        })),
      )
    : null;

  const [popular, attribution] = await Promise.all([popularMatchups(), loadAttribution()]);

  return (
    <div className="animate-fade-in">
      <div className="mb-8 text-center sm:text-left">
        <h1 className="text-3xl font-black tracking-tight text-ink-0 sm:text-4xl">
          Pembuat <span className="text-gradient-vs">Pertarungan</span>
        </h1>
        <p className="mt-2 text-sm text-ink-2 max-w-2xl mx-auto sm:mx-0">
          Konfigurasi kondisi pertarungan dan jalankan engine. Statistik tidak dilekatkan
          pada karakter secara umum, melainkan pada wujud (form/era) spesifik.
        </p>
      </div>

      {demoSource && (
        <div className="mb-6 rounded-xl border border-accent-flag/30 bg-accent-flag/10 p-4 text-sm text-accent-flag">
          <strong>{DEMO_LABEL}.</strong> {DEMO_NOTICE}
        </div>
      )}

      {totalForms === 0 ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface-1/50 p-8 text-center">
          <div className="h-12 w-12 text-4xl mb-4 opacity-50">⚔️</div>
          <h2 className="text-lg font-medium text-ink-0">Belum ada form karakter</h2>
          <p className="mt-1 text-sm text-ink-2 max-w-sm">
            Database belum berisi form (era/versi) yang dapat dipertarungkan. Jalankan ingestion
            lewat panel admin, lalu muat ulang halaman ini.
          </p>
        </div>
      ) : (
        <>
          <form action="/versus/result" method="GET" className="space-y-8">
            <div className="relative grid gap-4 sm:grid-cols-[1fr_auto_1fr] lg:gap-8 items-stretch">
              <div className="hidden sm:block absolute top-1/2 left-0 right-0 h-px bg-gradient-to-r from-line via-line-strong to-line -translate-y-1/2 -z-10" />

              <div className="rounded-2xl border border-line-strong bg-surface-1 p-5 shadow-card transition-all hover:border-accent-a/50">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-a/10 text-accent-a font-bold">
                    A
                  </div>
                  <h2 className="text-lg font-bold text-ink-0">Petarung A</h2>
                </div>
                <FighterPicker name="form_a" side="A" initial={initialA} demoOptions={demoOptions} />
              </div>

              <div className="flex justify-center items-center py-4 sm:py-0">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full bg-gradient-to-br from-accent-a to-accent-b blur-md" />
                  <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-line-strong bg-surface-1 shadow-lg">
                    <span className="text-xl font-black text-gradient-vs">VS</span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-line-strong bg-surface-1 p-5 shadow-card transition-all hover:border-accent-b/50">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-b/10 text-accent-b font-bold">
                    B
                  </div>
                  <h2 className="text-lg font-bold text-ink-0">Petarung B</h2>
                </div>
                <FighterPicker name="form_b" side="B" initial={initialB} demoOptions={demoOptions} />
              </div>
            </div>

            <div className="rounded-2xl border border-line bg-surface-1 p-6">
              <div className="flex items-center gap-2 mb-6">
                <svg className="h-5 w-5 text-ink-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <h3 className="text-lg font-bold text-ink-0">Kondisi Pertarungan</h3>
              </div>

              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label htmlFor="mode" className="mb-1.5 block text-xs font-medium text-ink-2">Mode pertarungan</label>
                  <select id="mode" name="mode" className="input-field text-sm">
                    <option value="standard">Standar (bawaan)</option>
                    <option value="in_character">Sesuai karakter (sifat asli)</option>
                    <option value="bloodlusted">Tanpa ragu (maksimal)</option>
                    <option value="random_encounter">Pertemuan acak</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="win_condition" className="mb-1.5 block text-xs font-medium text-ink-2">Kondisi menang</label>
                  <select id="win_condition" name="win_condition" className="input-field text-sm">
                    <option value="any">Apa pun</option>
                    <option value="death">Kematian / kehancuran</option>
                    <option value="ko">Knockout (KO)</option>
                    <option value="incapacitation">Tidak mampu bertarung</option>
                    <option value="bfr">Keluar dari medan (BFR)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="knowledge" className="mb-1.5 block text-xs font-medium text-ink-2">Tingkat pengetahuan</label>
                  <select id="knowledge" name="knowledge" className="input-field text-sm">
                    <option value="none">Tidak tahu lawan</option>
                    <option value="partial">Tahu dasar</option>
                    <option value="full">Tahu semua rahasia</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="prep" className="mb-1.5 block text-xs font-medium text-ink-2">Waktu persiapan</label>
                  <select id="prep" name="prep" className="input-field text-sm">
                    <option value="none">Tidak ada (spontan)</option>
                    <option value="short">Singkat (menit/jam)</option>
                    <option value="extended">Panjang (berhari-hari)</option>
                  </select>
                </div>

                <div className="sm:col-span-2 lg:col-span-1">
                  <label className="mb-1.5 block text-xs font-medium text-ink-2">Pengubah</label>
                  <label className="flex items-center gap-3 rounded-lg border border-line bg-surface-0/50 px-4 py-2.5 cursor-pointer hover:border-line-strong transition-colors">
                    <input
                      type="checkbox"
                      name="speed_equalized"
                      value="1"
                      className="h-4 w-4 rounded border-line bg-surface-2 text-accent-b focus:ring-accent-b focus:ring-offset-surface-1"
                    />
                    <span className="text-sm text-ink-1">Kecepatan disetarakan</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="flex justify-center pt-4">
              <button type="submit" className="btn-battle text-lg px-8 py-4 flex items-center gap-3">
                Jalankan Simulasi
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </button>
            </div>
          </form>

          {popular.length > 0 && (
            <section className="mt-12" aria-labelledby="popular-battles">
              <h2 id="popular-battles" className="text-lg font-bold text-ink-0">
                Pertarungan Populer
              </h2>
              <p className="mt-1 text-sm text-ink-2">
                Pertarungan yang paling sering disimulasikan. Angkanya dihitung dari hasil yang
                tersimpan, bukan dari daftar pilihan editor.
              </p>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {popular.map((matchup) => (
                  <li key={matchup.slug}>
                    <a
                      href={`/versus/${matchup.slug}`}
                      className="flex items-center justify-between rounded-xl border border-line bg-surface-1 px-4 py-3 text-sm text-ink-1 transition-colors hover:border-line-strong hover:text-ink-0"
                    >
                      <span className="font-medium">{matchupTitle(matchup.slug)}</span>
                      <span className="text-xs text-ink-3">{matchup.simulations} simulasi</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <DataAttribution attribution={attribution} />
    </div>
  );
}
