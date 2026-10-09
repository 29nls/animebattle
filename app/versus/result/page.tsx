import type { Metadata } from 'next';

import { parseBattleConditionsFromQuery } from '@/features/battle/conditions.ts';
import { defaultRuleSet } from '@/features/battle/rule-set.ts';
import { simulateFromSides } from '@/features/battle/simulate.ts';
import { DEMO_LABEL, DEMO_NOTICE, DemoDataError, demoBattleInput, demoEnabled } from '@/features/demo/provider.ts';
import type { BattleResult, SideData } from '@/services/battle/types.ts';

export const metadata: Metadata = {
  title: 'Battle Result',
  description: 'Hasil simulasi engine pertarungan.',
  alternates: { canonical: '/versus/result' },
};

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function sideName(side: SideData): string {
  return side.character.name;
}

function sideFormLabel(side: SideData): string {
  return `${side.form.name}${side.form.era ? ` — ${side.form.era}` : ''}`;
}

/** `metric_slug` → `Metric Slug` untuk tampilan breakdown. */
function metricLabel(metric: string): string {
  return metric.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Satu blok reasoning dengan rujukan terstruktur (AC-34 tampil ke pengguna). */
function ReasoningBlock({
  title,
  text,
  refs,
  accent,
}: {
  title: string;
  text: string;
  refs: string[];
  accent: string;
}) {
  return (
    <div>
      <h4 className="font-bold text-ink-0 mb-2">{title}</h4>
      <p className={`leading-relaxed border-l-2 ${accent} pl-4`}>{text}</p>
      {refs.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5 pl-4">
          {refs.map((ref) => (
            <li
              key={ref}
              className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.6rem] text-ink-3 border border-line"
            >
              {ref}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function VersusResultPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  const valueA = (single(params.form_a) ?? single(params.char_a) ?? '').trim();
  const valueB = (single(params.form_b) ?? single(params.char_b) ?? '').trim();
  const demoSource = demoEnabled();

  let result: BattleResult | null = null;
  let sideA: SideData | null = null;
  let sideB: SideData | null = null;
  let failure: string | null = null;

  if (valueA === '' || valueB === '') {
    failure = 'Pilih Character A dan Character B terlebih dahulu di halaman Battle Builder.';
  } else if (!demoSource) {
    failure =
      'Simulasi halaman ini membutuhkan data: aktifkan dataset demo (ALLOW_DEMO_DATA=1) atau hubungkan PostgreSQL (DATABASE_URL).';
  } else {
    try {
      const input = demoBattleInput(valueA, valueB, parseBattleConditionsFromQuery(params));
      sideA = input.side_a;
      sideB = input.side_b;
      result = simulateFromSides(input, defaultRuleSet());
    } catch (error) {
      failure =
        error instanceof DemoDataError
          ? error.message
          : `Simulasi gagal dijalankan: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  if (failure || !result || !sideA || !sideB) {
    return (
      <div className="animate-fade-in mx-auto max-w-2xl">
        <div className="rounded-2xl border border-accent-flag/30 bg-accent-flag/10 p-6 text-sm">
          <h1 className="text-lg font-bold text-ink-0">Simulasi belum dapat dijalankan</h1>
          <p className="mt-2 leading-relaxed text-ink-1">{failure}</p>
          <a href="/versus" className="btn-primary mt-6 inline-flex text-sm px-6">
            Kembali ke Battle Builder
          </a>
        </div>
      </div>
    );
  }

  const winnerName =
    result.winner === 'a'
      ? sideName(sideA)
      : result.winner === 'b'
        ? sideName(sideB)
        : 'Tidak ada pemenang';

  const probabilityA = result.win_probability.a * 100;

  return (
    <div className="animate-fade-in">
      {demoSource && (
        <div className="mb-6 rounded-lg border border-accent-flag/30 bg-accent-flag/10 p-3 text-sm text-accent-flag">
          <strong>{DEMO_LABEL}.</strong> {DEMO_NOTICE}
        </div>
      )}

      {/* ─── Winner Banner ─── */}
      <div
        className={`relative overflow-hidden rounded-2xl border p-6 sm:p-10 text-center shadow-card ${
          result.winner === 'a'
            ? 'border-accent-a/50 bg-accent-a/5'
            : result.winner === 'b'
              ? 'border-accent-b/50 bg-accent-b/5'
              : 'border-line-strong bg-surface-1'
        }`}
      >
        <h2 className="text-sm font-bold uppercase tracking-widest text-ink-3 mb-2">Battle Concluded</h2>

        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-8 my-6">
          <div className={`text-center ${result.winner === 'a' ? 'text-accent-a' : 'text-ink-2 opacity-60'}`}>
            <p className="text-2xl sm:text-4xl font-black drop-shadow-md">{sideName(sideA)}</p>
            <p className="mt-1 text-xs text-ink-3">{sideFormLabel(sideA)}</p>
          </div>

          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-2 border border-line-strong">
            <span className="text-xs font-bold text-ink-3">VS</span>
          </div>

          <div className={`text-center ${result.winner === 'b' ? 'text-accent-b' : 'text-ink-2 opacity-60'}`}>
            <p className="text-2xl sm:text-4xl font-black drop-shadow-md">{sideName(sideB)}</p>
            <p className="mt-1 text-xs text-ink-3">{sideFormLabel(sideB)}</p>
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center gap-2">
          <p className="text-base font-medium text-ink-1">
            {result.winner === 'insufficient_data' ? (
              <strong className="text-xl text-ink-0">Data tidak cukup untuk menentukan pemenang</strong>
            ) : (
              <>
                Winner: <strong className="text-2xl text-ink-0">{winnerName}</strong>
              </>
            )}
          </p>

          <div className="flex items-center gap-4 w-full max-w-sm mt-2">
            <span className="text-xs font-bold text-accent-a">{percent(result.win_probability.a)}</span>
            <div className="prob-bar-wrapper flex-1 border border-line">
              <div className="prob-bar-a" style={{ width: `${probabilityA}%` }} />
              <div className="prob-bar-b" style={{ width: `${100 - probabilityA}%` }} />
            </div>
            <span className="text-xs font-bold text-accent-b">{percent(result.win_probability.b)}</span>
          </div>
          <p className="text-[0.65rem] text-ink-3 uppercase tracking-wider mt-2">Win Probability</p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[0.65rem] font-bold uppercase tracking-wider">
            <span className={`rounded px-2 py-0.5 border ${result.low_confidence ? 'border-accent-flag/40 bg-accent-flag/10 text-accent-flag' : 'border-line bg-surface-2 text-ink-2'}`}>
              Confidence {percent(result.confidence)}
            </span>
            <span className="rounded border border-line bg-surface-2 px-2 py-0.5 text-ink-2">
              Difficulty {result.difficulty}
            </span>
            <span className="rounded border border-line bg-surface-2 px-2 py-0.5 text-ink-2">
              Length {result.battle_length}
            </span>
            <span className="rounded border border-line bg-surface-2 px-2 py-0.5 font-mono text-ink-3 normal-case">
              {result.rule_set_version}
            </span>
          </div>
        </div>
      </div>

      {result.low_confidence && (
        <div className="mt-6 rounded-lg border border-accent-flag/30 bg-accent-flag/10 p-3 text-sm text-accent-flag">
          Confidence berada di bawah ambang {percent(0.45)} — hasil ini memuat asumsi yang perlu dibaca sebelum dipakai.
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* ─── Reasoning (Deterministik) ─── */}
        <section className="rounded-2xl border border-line bg-surface-1 p-6 sm:p-8">
          <h3 className="flex items-center gap-2 text-xl font-bold text-ink-0 mb-6">
            <span className="text-accent-win">📝</span> Engine Narrative
          </h3>

          <div className="space-y-6 text-sm text-ink-1">
            <ReasoningBlock
              title="Primary Reason"
              text={result.reasoning.primary.text}
              refs={result.reasoning.primary.refs}
              accent="border-accent-a"
            />

            {result.reasoning.secondary.length > 0 && (
              <div>
                <h4 className="font-bold text-ink-0 mb-2">Secondary Factors</h4>
                <ul className="list-disc pl-5 space-y-2 text-ink-2">
                  {result.reasoning.secondary.map((item) => (
                    <li key={item.text}>
                      {item.text}
                      {item.refs.length > 0 && (
                        <span className="ml-1 font-mono text-[0.6rem] text-ink-3">[{item.refs.join(', ')}]</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <ReasoningBlock
              title="Critical Counter"
              text={result.reasoning.critical_counter.text}
              refs={result.reasoning.critical_counter.refs}
              accent="border-accent-flag"
            />

            <div className="rounded-xl bg-surface-2 p-4 border border-line">
              <h4 className="font-bold text-ink-0 mb-2">Potential Scenario</h4>
              <p className="text-ink-2 italic">{result.reasoning.scenario.text}</p>
              {result.reasoning.scenario.refs.length > 0 && (
                <p className="mt-2 font-mono text-[0.6rem] text-ink-3">{result.reasoning.scenario.refs.join(', ')}</p>
              )}
            </div>
          </div>
        </section>

        {/* ─── Score Breakdown ─── */}
        <section className="rounded-2xl border border-line bg-surface-1 p-6 sm:p-8">
          <h3 className="flex items-center gap-2 text-xl font-bold text-ink-0 mb-6">
            <span className="text-accent-b">📈</span> Score Breakdown
          </h3>

          <div className="space-y-4">
            {result.score_breakdown
              .filter((entry) => entry.weight > 0)
              .map((entry) => {
                const aShare = ((entry.a_value + 1) / 2) * 100;
                return (
                  <div key={entry.metric} className="group">
                    <div className="flex justify-between text-xs font-bold text-ink-2 mb-1">
                      <span>{metricLabel(entry.metric)}</span>
                      <span className="text-ink-3">Bobot {entry.weight}</span>
                    </div>
                    <div className="flex h-6 rounded border border-line bg-surface-2 overflow-hidden">
                      <div className="bg-accent-a/80 h-full" style={{ width: `${aShare}%` }} />
                      <div className="bg-accent-b/80 h-full" style={{ width: `${100 - aShare}%` }} />
                    </div>
                    {entry.note && <p className="mt-1 text-[0.65rem] text-ink-3">{entry.note}</p>}
                  </div>
                );
              })}

            <div className="mt-6 border-t border-line/50 pt-4 text-xs text-ink-3">
              S = {result.weighted_score.toFixed(3)} (sebelum transformasi logistik, k = 2,2) · engine {result.engine_version} ·
              hash <span className="font-mono">{result.input_hash.slice(0, 12)}</span>
            </div>
          </div>
        </section>
      </div>

      {/* ─── Decisive Edges ─── */}
      {result.decisive_edges.length > 0 && (
        <section className="mt-6 rounded-2xl border border-line bg-surface-1 p-6 sm:p-8">
          <h3 className="mb-6 flex items-center gap-2 text-xl font-bold text-ink-0">
            <span>⚡</span> Decisive Edges
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {result.decisive_edges.map((edge) => (
              <div key={edge.id} className="rounded-xl border border-line-strong bg-surface-0/50 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-bold text-ink-0">{edge.ability_name}</h4>
                  <span
                    className={`rounded px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider ${
                      edge.status === 'effective' || edge.status === 'bypasses'
                        ? 'bg-accent-win/10 text-accent-win'
                        : 'bg-accent-flag/10 text-accent-flag'
                    }`}
                  >
                    {edge.status}
                  </span>
                </div>
                <p className="mt-2 text-xs text-ink-2">
                  Sisi {edge.side.toUpperCase()} · efektivitas {percent(edge.effectiveness)}
                  {edge.satisfies_win_condition && ' · memenuhi win condition'}
                </p>
                {edge.blocked_by && (
                  <p className="mt-1 text-xs text-ink-3">
                    Ditahan oleh resistensi {edge.blocked_by.level_label} ({edge.blocked_by.resistance_type_id})
                  </p>
                )}
                {edge.inactive_reason && <p className="mt-1 text-xs text-ink-3">{edge.inactive_reason}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─── Limitations & Assumptions ─── */}
      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface-1 p-6">
          <h3 className="text-sm font-bold uppercase tracking-wider text-ink-3 mb-3">Limitations</h3>
          {result.limitations.length > 0 ? (
            <ul className="list-disc pl-5 space-y-1 text-sm text-ink-2">
              {result.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">Tidak ada keterbatasan yang terdeteksi pada data ini.</p>
          )}
        </div>
        <div className="rounded-2xl border border-line bg-surface-1 p-6">
          <h3 className="text-sm font-bold uppercase tracking-wider text-ink-3 mb-3">Assumptions</h3>
          {result.assumptions.length > 0 ? (
            <ul className="list-disc pl-5 space-y-1 text-sm text-ink-2">
              {result.assumptions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">Tidak ada asumsi tambahan di luar kondisi yang dipilih.</p>
          )}
        </div>
      </section>

      {/* ─── Disclaimer (AC-13, verbatim dari engine) ─── */}
      <div className="mt-6 rounded-2xl border border-line-strong bg-surface-2 p-5 text-xs leading-relaxed text-ink-2">
        {result.disclaimer}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-3">
        <span>
          battle_id <span className="font-mono">{result.battle_id.slice(0, 16)}</span>
        </span>
        <a href="/versus" className="btn-primary text-xs !py-2 !px-4">
          Simulasi lain
        </a>
      </div>
    </div>
  );
}
