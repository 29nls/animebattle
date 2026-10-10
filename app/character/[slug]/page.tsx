import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { loadCharacterDetail } from '@/features/characters/detail-queries.ts';
import { attemptLoad } from '@/features/data-source.ts';
import { isAdminAuthenticated } from '@/features/admin/session.ts';
import { DatabaseUnavailable } from '@/components/database-unavailable.tsx';
import { DEMO_LABEL, DEMO_NOTICE } from '@/features/demo/provider.ts';

export const dynamic = 'force-dynamic';

function titleFromSlug(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  // Metadata tidak boleh gagal sendiri: bila database belum terhubung, judul
  // jatuh ke slug dan isi halaman menampilkan panel galat yang jujur.
  const outcome = await attemptLoad(() => loadCharacterDetail(slug));
  const bundle = outcome.status === 'ok' ? outcome.data : null;
  const name = bundle?.character.name ?? titleFromSlug(slug);

  return {
    title: name,
    description: bundle?.character.description ?? `Statistik, abilities, resistances, dan form dari ${name}.`,
    alternates: { canonical: `/character/${slug}` },
  };
}

function metricLabel(metric: string): string {
  return metric.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Urutan tampil yang stabil: metrik penentu lebih dulu, pengalaman terakhir. */
const METRIC_ORDER = [
  'tier',
  'attack_potency',
  'durability',
  'speed',
  'reaction_speed',
  'combat_speed',
  'range',
  'striking_strength',
  'lifting_strength',
  'stamina',
  'intelligence',
  'battle_iq',
  'experience',
];

export default async function CharacterPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ form?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const outcome = await attemptLoad(() => loadCharacterDetail(slug, query.form));

  if (outcome.status === 'failed') {
    // Detail teknis hanya untuk operator; pengunjung anonim menerima pesan generik.
    return (
      <DatabaseUnavailable
        detail={outcome.message}
        viewerIsOperator={await isAdminAuthenticated()}
      />
    );
  }

  const bundle = outcome.data;
  if (!bundle) notFound();

  const { character, forms, activeForm, statistics, abilities, resistances, sources, source } = bundle;
  const orderedStatistics = statistics.slice().sort((a, b) => {
    const indexA = METRIC_ORDER.indexOf(a.metric);
    const indexB = METRIC_ORDER.indexOf(b.metric);
    return (indexA === -1 ? 99 : indexA) - (indexB === -1 ? 99 : indexB);
  });

  return (
    <div className="animate-fade-in">
      {source === 'demo' && (
        <div className="mb-6 rounded-lg border border-accent-flag/30 bg-accent-flag/10 p-3 text-sm text-accent-flag flex items-start gap-2">
          <span className="mt-0.5">⚠️</span>
          <p>
            <strong>{DEMO_LABEL}.</strong> {DEMO_NOTICE}
          </p>
        </div>
      )}

      {/* ─── Hero Section ─── */}
      <div className="relative overflow-hidden rounded-2xl border border-line-strong bg-surface-1 shadow-card">
        <div className="absolute inset-0 bg-gradient-to-r from-accent-a/10 to-transparent opacity-50 pointer-events-none" />

        <div className="relative flex flex-col gap-6 p-6 sm:flex-row sm:items-end sm:p-8">
          <div className="relative h-32 w-32 shrink-0 sm:h-40 sm:w-40">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-accent-a to-accent-b blur-md opacity-40" />
            <div className="relative h-full w-full overflow-hidden rounded-2xl border-2 border-line-strong bg-surface-2">
              <div className="flex h-full w-full items-center justify-center text-4xl text-ink-3">👤</div>
            </div>
          </div>

          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              {activeForm?.tier_code && <span className="tier-badge tier-peak text-xs px-2 py-0.5">{activeForm.tier_code}</span>}
              <span className="rounded bg-surface-3 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-ink-1">
                {character.data_completeness === 'complete'
                  ? 'Data Lengkap'
                  : character.data_completeness === 'partial'
                    ? 'Data Sebagian'
                    : 'Data Minimal'}
              </span>
              {source === 'demo' && (
                <span className="rounded bg-accent-flag/10 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-accent-flag">
                  Demo
                </span>
              )}
            </div>

            <h1 className="text-3xl font-black text-ink-0 sm:text-5xl">{character.name}</h1>
            {character.native_name && <p className="mt-1 text-sm text-ink-3">{character.native_name}</p>}

            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-2">
              <p>
                <span className="font-semibold text-ink-3">Verse:</span>{' '}
                <a href={`/verse/${character.verse_slug}`} className="text-accent-b hover:underline">
                  {character.verse_name}
                </a>
              </p>
              {character.classification && (
                <p>
                  <span className="font-semibold text-ink-3">Klasifikasi:</span> {character.classification}
                </p>
              )}
              {character.gender && (
                <p>
                  <span className="font-semibold text-ink-3">Gender:</span> {character.gender}
                </p>
              )}
              {character.age && (
                <p>
                  <span className="font-semibold text-ink-3">Usia:</span> {character.age}
                </p>
              )}
            </div>
          </div>

          <div className="sm:ml-auto">
            <a
              href={`/versus?a=${character.slug}/${activeForm?.slug ?? 'base'}`}
              className="btn-battle flex w-full items-center justify-center gap-2 sm:w-auto"
            >
              Battle Character
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </a>
          </div>
        </div>
      </div>

      {/* ─── Form Tabs (Era/Versi) ─── */}
      <div className="mt-8 flex flex-wrap gap-2 border-b border-line pb-px">
        {forms.map((form) => {
          const isActive = form.id === activeForm?.id;
          return (
            <a
              key={form.id}
              href={`/character/${slug}?form=${form.slug}`}
              className={`relative rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-surface-2 text-accent-a border-x border-t border-line-strong'
                  : 'text-ink-2 hover:bg-surface-1 hover:text-ink-0'
              }`}
            >
              {form.name}
              {form.era && <span className="ml-2 text-[0.6rem] uppercase tracking-wider text-ink-3">{form.era}</span>}
              {form.is_default && <span className="ml-2 text-[0.6rem] uppercase tracking-wider text-ink-3">(Default)</span>}
            </a>
          );
        })}
      </div>

      {activeForm?.description && <p className="mt-4 text-sm text-ink-2">{activeForm.description}</p>}

      <div className="mt-6 grid gap-8 lg:grid-cols-[2fr_1fr]">
        {/* ─── Left Column (Stats & Abilities) ─── */}
        <div className="space-y-8">
          <section className="rounded-2xl border border-line bg-surface-1 p-6">
            <h2 className="mb-6 flex items-center gap-2 text-xl font-bold text-ink-0">
              <span className="text-accent-a">📊</span> Combat Statistics
            </h2>

            {orderedStatistics.length === 0 ? (
              <p className="text-sm text-ink-3">Belum ada statistik terdokumentasi untuk form ini.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {orderedStatistics.map((stat) => (
                  <div key={stat.metric} className="rounded-xl border border-line-strong bg-surface-0/50 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-ink-3">
                        {metricLabel(stat.metric)}
                      </p>
                      {stat.qualifier !== 'exact' && (
                        <span className="rounded bg-accent-flag/10 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-accent-flag">
                          {stat.qualifier}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm font-medium text-ink-0">{stat.raw_text}</p>
                    <p className="mt-1 text-[0.65rem] text-ink-3">
                      Confidence {Math.round(stat.confidence * 100)}%
                      {stat.source_name ? ` · ${stat.source_name}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-surface-1 p-6">
            <h2 className="mb-6 flex items-center gap-2 text-xl font-bold text-ink-0">
              <span className="text-accent-b">✨</span> Abilities &amp; Hax
            </h2>

            {abilities.length === 0 ? (
              <p className="text-sm text-ink-3">Tidak ada ability tercatat untuk form ini (bukan berarti tidak punya).</p>
            ) : (
              <div className="space-y-3">
                {abilities.map((ability) => (
                  <div
                    key={ability.id}
                    className="group rounded-xl border border-line-strong bg-surface-0/50 p-4 transition-colors hover:border-accent-b/50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-bold text-ink-0 group-hover:text-accent-b transition-colors">
                        {ability.ability_name}
                      </h3>
                      <span className="rounded bg-accent-b/10 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-accent-b">
                        {ability.proficiency}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[0.65rem] text-ink-3">
                      <span className="rounded bg-surface-2 px-1.5 py-0.5">{ability.category_name}</span>
                      <span className="rounded bg-surface-2 px-1.5 py-0.5">Aktivasi: {ability.activation_speed}</span>
                      {ability.is_passive && <span className="rounded bg-surface-2 px-1.5 py-0.5">Pasif</span>}
                      {ability.is_offensive && <span className="rounded bg-surface-2 px-1.5 py-0.5">Ofensif</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ─── Right Column (Resistances & Meta) ─── */}
        <div className="space-y-8">
          <section className="rounded-2xl border border-line bg-surface-1 p-6">
            <h2 className="mb-6 flex items-center gap-2 text-xl font-bold text-ink-0">
              <span className="text-accent-win">🛡️</span> Resistances
            </h2>

            {resistances.length === 0 ? (
              <p className="text-sm text-ink-3">Tidak ada resistensi tercatat — kemampuan hax lawan akan bekerja penuh.</p>
            ) : (
              <ul className="space-y-3">
                {resistances.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm border border-line"
                  >
                    <span className="font-medium text-ink-1">{entry.resistance_type_name}</span>
                    <span className="text-right">
                      <span className="block text-xs font-bold text-accent-win">{entry.level_label}</span>
                      <span className="block text-[0.6rem] text-ink-3">
                        {entry.verification_status === 'verified' ? 'Tersumber' : entry.verification_status}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-surface-1 p-6">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-ink-3">Data Traceability</h2>
            {sources.length === 0 ? (
              <p className="text-xs text-ink-3">
                Belum ada sumber tercatat untuk karakter ini — bertentangan dengan AC-09 dan perlu diperbaiki sebelum rilis.
              </p>
            ) : (
              <ul className="space-y-2 border-t border-line/50 pt-3">
                {sources.map((entry) => (
                  <li key={entry.source_id} className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-accent-b">{entry.source_name}</span>
                    <span className="text-[0.65rem] text-ink-3">
                      {entry.fetched_at ? `Diambil: ${entry.fetched_at.slice(0, 10)}` : 'Waktu pengambilan tidak diketahui'} ·{' '}
                      {entry.verification_status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
