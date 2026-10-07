import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Battle Result',
  description: 'Hasil simulasi engine pertarungan.',
};

export default async function VersusResultPage({
  searchParams,
}: {
  searchParams: Promise<{ char_a?: string; char_b?: string; mode?: string }>;
}) {
  const params = await searchParams;
  const sideA = params.char_a || 'Character A';
  const sideB = params.char_b || 'Character B';

  // Mock Result
  const winner = (params as any).winner === 'b' ? 'b' : (params as any).winner === 'draw' ? 'draw' : 'a';
  const winProb = 0.85;
  
  return (
    <div className="animate-fade-in">
      
      {/* ─── Winner Banner ─── */}
      <div className={`relative overflow-hidden rounded-2xl border p-6 sm:p-10 text-center shadow-card ${winner === 'a' ? 'border-accent-a/50 bg-accent-a/5' : winner === 'b' ? 'border-accent-b/50 bg-accent-b/5' : 'border-line-strong bg-surface-1'}`}>
        <div className="absolute inset-0 bg-[url('/noise.png')] opacity-10 mix-blend-overlay" />
        
        {winner === 'a' && (
          <div className="absolute -left-32 -top-32 h-64 w-64 rounded-full bg-accent-a/20 blur-[80px]" />
        )}
        
        <h2 className="text-sm font-bold uppercase tracking-widest text-ink-3 mb-2">Battle Concluded</h2>
        
        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-8 my-6">
          <div className={`text-2xl sm:text-4xl font-black ${winner === 'a' ? 'text-accent-a drop-shadow-md' : 'text-ink-2 opacity-60'}`}>
            {sideA}
          </div>
          
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-2 border border-line-strong">
            <span className="text-xs font-bold text-ink-3">VS</span>
          </div>
          
          <div className={`text-2xl sm:text-4xl font-black ${winner === 'b' ? 'text-accent-b drop-shadow-md' : 'text-ink-2 opacity-60'}`}>
            {sideB}
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center gap-2">
          <p className="text-base font-medium text-ink-1">
            Winner: <strong className="text-2xl text-ink-0">{winner === 'a' ? sideA : sideB}</strong>
          </p>
          <div className="flex items-center gap-4 w-full max-w-sm mt-2">
            <span className="text-xs font-bold text-accent-a">{(winProb * 100).toFixed(1)}%</span>
            <div className="prob-bar-wrapper flex-1 border border-line">
              <div className="prob-bar-a" style={{ width: `${winProb * 100}%` }} />
              <div className="prob-bar-b" style={{ width: `${(1 - winProb) * 100}%` }} />
            </div>
            <span className="text-xs font-bold text-accent-b">{((1 - winProb) * 100).toFixed(1)}%</span>
          </div>
          <p className="text-[0.65rem] text-ink-3 uppercase tracking-wider mt-2">Win Probability Curve</p>
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* ─── Reasoning (Deterministik) ─── */}
        <section className="rounded-2xl border border-line bg-surface-1 p-6 sm:p-8">
          <h3 className="flex items-center gap-2 text-xl font-bold text-ink-0 mb-6">
            <span className="text-accent-win">📝</span> Engine Narrative
          </h3>
          
          <div className="space-y-6 text-sm text-ink-1">
            <div>
              <h4 className="font-bold text-ink-0 mb-2">Primary Reason</h4>
              <p className="leading-relaxed border-l-2 border-accent-a pl-4">
                {sideA} memegang keunggulan absolut karena memiliki Decisive Edge melalui kemampuan Existence Erasure yang tidak dapat ditahan oleh {sideB}.
              </p>
            </div>
            
            <div>
              <h4 className="font-bold text-ink-0 mb-2">Secondary Factors</h4>
              <ul className="list-disc pl-5 space-y-1 text-ink-2">
                <li>Attack Potency {sideA} lebih tinggi 2 tingkat.</li>
                <li>Kecepatan {sideA} unggul sehingga dapat mendaratkan serangan mematikan lebih dulu.</li>
              </ul>
            </div>
            
            <div className="rounded-xl bg-surface-2 p-4 border border-line">
              <h4 className="font-bold text-ink-0 mb-2">Potential Scenario</h4>
              <p className="text-ink-2 italic">
                "{sideA} menginisiasi pertarungan dengan Existence Erasure seketika; {sideB} tidak menyadarinya karena perbedaan combat speed yang jauh, mengakhiri pertarungan seketika."
              </p>
            </div>
          </div>
        </section>

        {/* ─── Stat Breakdown ─── */}
        <section className="rounded-2xl border border-line bg-surface-1 p-6 sm:p-8">
          <h3 className="flex items-center gap-2 text-xl font-bold text-ink-0 mb-6">
            <span className="text-accent-b">📈</span> Score Breakdown
          </h3>
          
          <div className="space-y-4">
            {['Attack Potency', 'Speed', 'Durability', 'Hax Arsenal'].map((metric, i) => {
              const aVal = i < 3 ? 0.8 : 0.4;
              const bVal = i < 3 ? 0.3 : 0.6;
              return (
                <div key={metric} className="group">
                  <div className="flex justify-between text-xs font-bold text-ink-2 mb-1">
                    <span>{metric}</span>
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity">Bobot: 1.5</span>
                  </div>
                  <div className="flex h-6 rounded border border-line bg-surface-2 overflow-hidden">
                    <div className="bg-accent-a/80 h-full transition-all" style={{ width: `${(aVal / (aVal + bVal)) * 100}%` }} />
                    <div className="bg-accent-b/80 h-full transition-all" style={{ width: `${(bVal / (aVal + bVal)) * 100}%` }} />
                  </div>
                </div>
              );
            })}
            
            <div className="mt-6 border-t border-line/50 pt-4 text-xs text-ink-3">
              * Breakdowns dihitung melalui normalisasi logistik berdasarkan `rule_set_version` 1.0.0.
            </div>
          </div>
        </section>
      </div>

    </div>
  );
}
