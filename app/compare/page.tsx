import type { Metadata } from 'next';

import { loadPickerBootstrap } from '@/features/battle/picker-queries.ts';
import { loadCharacterDetail, type CharacterDetailBundle, type FormStatistic } from '@/features/characters/detail-queries.ts';
import { attemptLoad } from '@/features/data-source.ts';
import { isAdminAuthenticated } from '@/features/admin/session.ts';
import { loadAttribution } from '@/features/attribution/queries.ts';
import { DatabaseUnavailable } from '@/components/database-unavailable.tsx';
import { DataAttribution } from '@/components/data-attribution.tsx';
import { FighterPicker } from '@/components/fighter-picker.tsx';
import { DEMO_LABEL, DEMO_NOTICE } from '@/features/demo/provider.ts';
import { METRIC_ORDER, metricLabel } from '@/lib/metric-label.ts';

export const metadata: Metadata = {
  title: 'Bandingkan Statistik',
  description:
    'Bandingkan statistik dua form karakter tanpa menjalankan engine pertarungan. Setiap baris menampilkan sumbernya.',
  alternates: { canonical: '/compare' },
};

export const dynamic = 'force-dynamic';

function splitSelection(value: string): { slug: string; form?: string } | null {
  const [slug, form] = value.split('/');
  if (!slug) return null;
  return form ? { slug, form } : { slug };
}

function externalHttpUrl(value: string | null): string | null {
  return value !== null && (value.startsWith('https://') || value.startsWith('http://')) ? value : null;
}

function SourceLink({ name, url }: { name: string | null; url: string | null }) {
  if (name === null && url === null) return null;
  const href = externalHttpUrl(url);
  const label = name ?? url ?? '';
  return href ? (
    <a href={href} target="_blank" rel="nofollow noopener" className="text-accent-b hover:underline">
      {label} ↗
    </a>
  ) : (
    <span>{label}</span>
  );
}

type Indicator = 'a' | 'b' | 'equal' | 'unknown';

const INDICATOR_LABEL: Record<Indicator, string> = {
  a: 'Unggul A',
  b: 'Unggul B',
  equal: 'Setara',
  unknown: 'Tidak diketahui',
};

function compareMetric(
  a: FormStatistic | undefined,
  b: FormStatistic | undefined,
): { indicator: Indicator; reason: string } {
  if (!a && !b) return { indicator: 'unknown', reason: 'Kedua form tidak punya metrik ini.' };
  if (!a) return { indicator: 'unknown', reason: 'Form A tidak punya metrik ini.' };
  if (!b) return { indicator: 'unknown', reason: 'Form B tidak punya metrik ini.' };
  if (a.scale_rank === null || b.scale_rank === null) {
    return {
      indicator: 'unknown',
      reason: 'Kedua nilai tidak memakai skala yang dapat dibandingkan secara numerik.',
    };
  }
  if (a.scale_rank > b.scale_rank) return { indicator: 'a', reason: 'Peringkat skala A lebih tinggi.' };
  if (a.scale_rank < b.scale_rank) return { indicator: 'b', reason: 'Peringkat skala B lebih tinggi.' };
  return { indicator: 'equal', reason: 'Kedua nilai berada pada peringkat skala yang sama.' };
}

function formLabel(bundle: CharacterDetailBundle): string {
  const form = bundle.activeForm;
  if (!form) return 'Tanpa form';
  return form.era && form.era.toLowerCase() !== form.name.toLowerCase()
    ? `${form.name} — ${form.era}`
    : form.name;
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const params = await searchParams;
  const valueA = (params.a ?? '').trim();
  const valueB = (params.b ?? '').trim();
  const bothChosen = valueA !== '' && valueB !== '';

  const [bootstrapOutcome, attribution] = await Promise.all([
    attemptLoad(() => loadPickerBootstrap(valueA, valueB)),
    loadAttribution(),
  ]);

  if (bootstrapOutcome.status === 'failed') {
    return (
      <DatabaseUnavailable
        detail={bootstrapOutcome.message}
        viewerIsOperator={await isAdminAuthenticated()}
      />
    );
  }

  const { source, groups, initialA, initialB } = bootstrapOutcome.data;
  const demoSource = source === 'demo';
  const demoOptions = demoSource
    ? groups.flatMap((group) =>
        group.options.map((option) => ({
          value: option.value,
          label: `${group.label} — ${option.label}`,
        })),
      )
    : null;

  let bundles: { a: CharacterDetailBundle | null; b: CharacterDetailBundle | null } | null = null;
  let loadFailure: string | null = null;

  if (bothChosen) {
    const outcome = await attemptLoad(async () => {
      const selectionA = splitSelection(valueA);
      const selectionB = splitSelection(valueB);
      const [a, b] = await Promise.all([
        selectionA ? loadCharacterDetail(selectionA.slug, selectionA.form) : Promise.resolve(null),
        selectionB ? loadCharacterDetail(selectionB.slug, selectionB.form) : Promise.resolve(null),
      ]);
      return { a, b };
    });
    if (outcome.status === 'failed') loadFailure = outcome.message;
    else bundles = outcome.data;
  }

  const metrics = bundles?.a && bundles?.b
    ? [...new Set([...bundles.a.statistics, ...bundles.b.statistics].map((entry) => entry.metric))].sort(
        (left, right) => {
          const indexLeft = METRIC_ORDER.indexOf(left as (typeof METRIC_ORDER)[number]);
          const indexRight = METRIC_ORDER.indexOf(right as (typeof METRIC_ORDER)[number]);
          return (indexLeft === -1 ? 99 : indexLeft) - (indexRight === -1 ? 99 : indexRight) ||
            left.localeCompare(right);
        },
      )
    : [];

  const statFor = (bundle: CharacterDetailBundle, metric: string): FormStatistic | undefined =>
    bundle.statistics.find((entry) => entry.metric === metric);

  return (
    <div className="animate-fade-in">
      {demoSource && (
        <div className="mb-6 rounded-lg border border-accent-flag/30 bg-accent-flag/10 p-3 text-sm text-accent-flag">
          <strong>{DEMO_LABEL}.</strong> {DEMO_NOTICE}
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight text-ink-0 sm:text-4xl">
          Bandingkan <span className="text-gradient-vs">Statistik</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-2">
          Perbandingan mentah dua form tanpa menjalankan engine. Hanya peringkat skala yang
          dibandingkan; bila salah satu nilai tidak memakai skala, hasilnya “tidak diketahui”, bukan
          tebakan.
        </p>
      </div>

      <form action="/compare" method="get" className="space-y-6">
        <div className="grid items-stretch gap-4 sm:grid-cols-[1fr_auto_1fr] lg:gap-8">
          <div className="glass-strong rounded-2xl border border-line-strong p-5 shadow-card">
            <h2 className="mb-4 text-lg font-bold text-ink-0">Form A</h2>
            <FighterPicker name="a" side="A" initial={initialA} demoOptions={demoOptions} />
          </div>

          <div className="flex items-center justify-center py-2 sm:py-0">
            <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-line-strong bg-surface-1 text-sm font-black text-gradient-vs">
              VS
            </span>
          </div>

          <div className="glass-strong rounded-2xl border border-line-strong p-5 shadow-card">
            <h2 className="mb-4 text-lg font-bold text-ink-0">Form B</h2>
            <FighterPicker name="b" side="B" initial={initialB} demoOptions={demoOptions} />
          </div>
        </div>

        <div className="flex justify-center">
          <button type="submit" className="btn-primary px-8 py-3 text-sm">
            Bandingkan
          </button>
        </div>
      </form>

      {!bothChosen ? (
        <div className="mt-8 flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface-1/50 p-8 text-center">
          <div aria-hidden="true" className="mb-4 text-4xl opacity-50">
            ⚖️
          </div>
          <h2 className="text-lg font-medium text-ink-0">Pilih dua form</h2>
          <p className="mt-1 max-w-sm text-sm text-ink-2">
            Ketik nama karakter pada kedua kolom dan pilih form (era/wujud) yang ingin dibandingkan.
            Perbandingan tidak mengubah data apa pun.
          </p>
        </div>
      ) : loadFailure ? (
        <DatabaseUnavailable detail={loadFailure} viewerIsOperator={await isAdminAuthenticated()} />
      ) : !bundles?.a || !bundles?.b ? (
        <div className="mt-8 rounded-2xl border border-accent-flag/30 bg-accent-flag/10 p-6 text-sm">
          <h2 className="text-lg font-bold text-ink-0">Pilihan tidak ditemukan</h2>
          <p className="mt-2 text-ink-1">
            Salah satu karakter atau form tidak ada di sumber data. Muat ulang halaman dan pilih
            kembali dari daftar saran — nilai yang dikirim harus berbentuk{' '}
            <code className="text-accent-b">karakter/form</code>.
          </p>
          <a href="/compare" className="btn-primary mt-5 inline-flex text-sm">
            Mulai ulang perbandingan
          </a>
        </div>
      ) : (
        <div className="mt-10 animate-fade-in-up">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { side: 'A', bundle: bundles.a, accent: 'text-accent-a' },
              { side: 'B', bundle: bundles.b, accent: 'text-accent-b' },
            ].map(({ side, bundle, accent }) => (
              <div key={side} className="rounded-2xl border border-line bg-surface-1 p-5">
                <p className="text-[0.65rem] font-bold uppercase tracking-widest text-ink-3">
                  Sisi {side}
                </p>
                <p className={`mt-1 text-xl font-black ${accent}`}>{bundle.character.name}</p>
                <p className="text-sm text-ink-2">{formLabel(bundle)}</p>
                <p className="mt-1 text-xs text-ink-3">
                  {bundle.character.verse_name}
                  {bundle.activeForm?.tier_code ? ` · Tier ${bundle.activeForm.tier_code}` : ''}
                </p>
                <a
                  href={`/character/${bundle.character.slug}${
                    bundle.activeForm ? `?form=${bundle.activeForm.slug}` : ''
                  }`}
                  className="mt-2 inline-block text-xs text-accent-b hover:underline"
                >
                  Buka halaman karakter ↗
                </a>
              </div>
            ))}
          </div>

          <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface-1">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)] items-center gap-2 border-b border-line bg-surface-2 p-3 text-center text-xs font-bold uppercase tracking-wider text-ink-3 sm:p-4">
              <span>{bundles.a.character.name}</span>
              <span>Metrik</span>
              <span>{bundles.b.character.name}</span>
            </div>

            <ul className="divide-y divide-line/50">
              {metrics.map((metric) => {
                const a = statFor(bundles.a as CharacterDetailBundle, metric);
                const b = statFor(bundles.b as CharacterDetailBundle, metric);
                const comparison = compareMetric(a, b);
                return (
                  <li
                    key={metric}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)] items-start gap-2 p-3 text-xs sm:p-4"
                  >
                    <div className="min-w-0 break-words">
                      <p className="font-medium text-ink-1">{a?.raw_text ?? '—'}</p>
                      {a && (
                        <p className="mt-1 text-[0.65rem] text-ink-3">
                          Keyakinan {Math.round(a.confidence * 100)}% ·{' '}
                          <SourceLink name={a.source_name} url={a.source_url} />
                        </p>
                      )}
                    </div>

                    <div className="text-center">
                      <p className="font-bold text-ink-2">{metricLabel(metric)}</p>
                      <span
                        className={`mt-1 inline-block rounded-full border border-line px-2 py-0.5 text-[0.6rem] font-bold ${
                          comparison.indicator === 'a'
                            ? 'text-accent-a'
                            : comparison.indicator === 'b'
                              ? 'text-accent-b'
                              : 'text-ink-3'
                        }`}
                        title={comparison.reason}
                      >
                        {INDICATOR_LABEL[comparison.indicator]}
                      </span>
                    </div>

                    <div className="min-w-0 break-words text-right">
                      <p className="font-medium text-ink-1">{b?.raw_text ?? '—'}</p>
                      {b && (
                        <p className="mt-1 text-[0.65rem] text-ink-3">
                          Keyakinan {Math.round(b.confidence * 100)}% ·{' '}
                          <SourceLink name={b.source_name} url={b.source_url} />
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-xs text-ink-3">
              Perbandingan ini tidak mempertimbangkan hax, resistensi, kondisi, atau bobot engine.
              Untuk itu, jalankan simulasi penuh.
            </p>
            <a
              href={`/versus?a=${encodeURIComponent(valueA)}&b=${encodeURIComponent(valueB)}`}
              className="btn-battle px-6 py-3 text-sm"
            >
              Jalankan Simulasi ⚔️
            </a>
          </div>
        </div>
      )}

      <DataAttribution attribution={attribution} />
    </div>
  );
}
