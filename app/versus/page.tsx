import type { Metadata } from 'next';

import { demoBattleOptionGroups, demoEnabled } from '@/features/demo/provider.ts';
import { isDatabaseConfigured } from '@/lib/db/client.ts';

export const metadata: Metadata = {
  title: 'Battle Builder',
  description:
    'Pilih dua form karakter, atur kondisi pertarungan, lalu jalankan simulasi dan lihat alasan di balik hasilnya.',
  alternates: { canonical: '/versus' },
};

export default async function VersusPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const params = await searchParams;
  const sideA = params.a?.trim() ?? '';
  const sideB = params.b?.trim() ?? '';
  const bothChosen = sideA !== '' && sideB !== '';
  // Picker berbasis dataset demo dipakai HANYA bila database belum dikonfigurasi
  // dan operator mengaktifkan ALLOW_DEMO_DATA=1; jalur database tidak diubah.
  const demoPicker = demoEnabled() && !isDatabaseConfigured();
  const optionGroups = demoPicker ? demoBattleOptionGroups() : null;
  const canSubmit = demoPicker ? true : bothChosen;

  return (
    <div className="animate-fade-in">
      {/* ─── Header ─── */}
      <div className="mb-8 text-center sm:text-left">
        <h1 className="text-3xl font-black tracking-tight text-ink-0 sm:text-4xl">
          Battle <span className="text-gradient-vs">Builder</span>
        </h1>
        <p className="mt-2 text-sm text-ink-2 max-w-2xl mx-auto sm:mx-0">
          Konfigurasi kondisi pertarungan dan jalankan engine. Statistik tidak dilekatkan 
          pada karakter secara umum, melainkan pada wujud (form/era) spesifik.
        </p>
      </div>

      {/* ─── Builder Form ─── */}
      <form action="/versus/result" method="GET" className="space-y-8">
        {demoPicker && (
          <div className="rounded-xl border border-accent-flag/30 bg-accent-flag/10 p-4 text-sm text-accent-flag">
            <strong>Mode demo.</strong> Pilihan di bawah berasal dari dataset demo sintetis (bukan data kanon);
            simulasi dihitung engine asli dengan rule set default.
          </div>
        )}
        {/* Character Selection Grid */}
        <div className="relative grid gap-4 sm:grid-cols-[1fr_auto_1fr] lg:gap-8 items-stretch">
          
          {/* Decorative connection line for desktop */}
          <div className="hidden sm:block absolute top-1/2 left-0 right-0 h-px bg-gradient-to-r from-line via-line-strong to-line -z-10 -translate-y-1/2" />

          {/* Character A Panel */}
          <div className="glass-strong rounded-2xl border border-line-strong p-5 shadow-card transition-all hover:border-accent-a/50">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-a/10 text-accent-a font-bold">A</div>
              <h2 className="text-lg font-bold text-ink-0">Fighter A</h2>
            </div>
            
            <div className="space-y-4">
              {demoPicker && optionGroups ? (
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-3">Character &amp; Form</label>
                  <select
                    name="form_a"
                    className="input-field"
                    required
                    defaultValue={
                      optionGroups.some((group) => group.options.some((option) => option.value === sideA))
                        ? sideA
                        : optionGroups[0]?.options[0]?.value
                    }
                  >
                    {optionGroups.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              ) : (
                <>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-3">Character</label>
                    <div className="relative">
                      <input
                        type="text"
                        name="char_a"
                        defaultValue={sideA}
                        placeholder="Pilih karakter..."
                        className="input-field"
                        required
                      />
                    </div>
                  </div>

                  <div className={sideA ? 'opacity-100' : 'opacity-50 pointer-events-none'}>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-3">Version / Era</label>
                    <select name="form_a" className="input-field">
                      <option value="">Pilih form...</option>
                      <option value="default">Default Form (Auto-selected)</option>
                    </select>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* VS Badge */}
          <div className="flex justify-center items-center py-4 sm:py-0">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-accent-a to-accent-b blur-md animate-pulse-glow" />
              <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-line-strong bg-surface-1 shadow-lg">
                <span className="text-xl font-black text-gradient-vs">VS</span>
              </div>
            </div>
          </div>

          {/* Character B Panel */}
          <div className="glass-strong rounded-2xl border border-line-strong p-5 shadow-card transition-all hover:border-accent-b/50">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-b/10 text-accent-b font-bold">B</div>
              <h2 className="text-lg font-bold text-ink-0">Fighter B</h2>
            </div>
            
            <div className="space-y-4">
              {demoPicker && optionGroups ? (
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-3">Character &amp; Form</label>
                  <select name="form_b" className="input-field" required defaultValue={optionGroups[1]?.options[0]?.value}>
                    {optionGroups.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              ) : (
                <>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-3">Character</label>
                    <div className="relative">
                      <input
                        type="text"
                        name="char_b"
                        defaultValue={sideB}
                        placeholder="Pilih karakter..."
                        className="input-field"
                        required
                      />
                    </div>
                  </div>

                  <div className={sideB ? 'opacity-100' : 'opacity-50 pointer-events-none'}>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-3">Version / Era</label>
                    <select name="form_b" className="input-field">
                      <option value="">Pilih form...</option>
                      <option value="default">Default Form (Auto-selected)</option>
                    </select>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ─── Battle Conditions ─── */}
        <div className="rounded-2xl border border-line bg-surface-1 p-6">
          <div className="flex items-center gap-2 mb-6">
            <svg className="h-5 w-5 text-ink-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <h3 className="text-lg font-bold text-ink-0">Battle Conditions</h3>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-2">Battle Mode</label>
              <select name="mode" className="input-field text-sm">
                <option value="standard">Standard (Default)</option>
                <option value="in_character">In Character (Sifat Asli)</option>
                <option value="bloodlusted">Bloodlusted (Maksimal)</option>
                <option value="random_encounter">Random Encounter</option>
              </select>
            </div>
            
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-2">Win Condition</label>
              <select name="win_condition" className="input-field text-sm">
                <option value="any">Any (Apapun)</option>
                <option value="death">Death / Destruction</option>
                <option value="ko">Knockout (KO)</option>
                <option value="incapacitation">Incapacitation</option>
                <option value="bfr">BFR (Battlefield Removal)</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-2">Knowledge Level</label>
              <select name="knowledge" className="input-field text-sm">
                <option value="none">None (Tidak tahu lawan)</option>
                <option value="partial">Partial (Tahu dasar)</option>
                <option value="full">Full (Tahu semua rahasia)</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-2">Prep Time</label>
              <select name="prep" className="input-field text-sm">
                <option value="none">None (Spontan)</option>
                <option value="short">Short (Beberapa menit/jam)</option>
                <option value="extended">Extended (Berhari-hari)</option>
              </select>
            </div>

            <div className="sm:col-span-2 lg:col-span-1">
              <label className="mb-1.5 block text-xs font-medium text-ink-2">Modifiers</label>
              <label className="flex items-center gap-3 rounded-lg border border-line bg-surface-0/50 px-4 py-2.5 cursor-pointer hover:border-line-strong transition-colors">
                <input type="checkbox" name="speed_equalized" className="h-4 w-4 rounded border-line bg-surface-2 text-accent-b focus:ring-accent-b focus:ring-offset-surface-1" />
                <span className="text-sm text-ink-1">Speed Equalized</span>
              </label>
            </div>
          </div>
        </div>

        {/* ─── Submit Action ─── */}
        <div className="flex justify-center pt-4">
          <button
            type="submit"
            disabled={!canSubmit}
            className={`btn-battle text-lg px-8 py-4 flex items-center gap-3 ${!canSubmit ? 'opacity-50 cursor-not-allowed' : 'animate-vs-pulse'}`}
          >
            Run Simulation
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </button>
        </div>
        
        {!bothChosen && !demoPicker && (
          <p className="text-center text-xs text-ink-3 mt-4">
            Pilih Character A dan Character B untuk mengaktifkan simulasi.
          </p>
        )}
      </form>
    </div>
  );
}
