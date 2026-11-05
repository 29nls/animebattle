import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';

import { loadBattleResult } from '@/features/battle/queries.ts';
import { parseBattleConditionsFromQuery } from '@/features/battle/conditions.ts';
import { defaultRuleSet } from '@/features/battle/rule-set.ts';
import { canonicalRedirectTarget, parseMatchupSlug } from '@/features/battle/share.ts';
import { attemptLoad } from '@/features/data-source.ts';
import { isAdminAuthenticated } from '@/features/admin/session.ts';
import { DatabaseUnavailable } from '@/components/database-unavailable.tsx';
import { BattleResultView } from '@/components/battle-result-view.tsx';
import { DataAttribution } from '@/components/data-attribution.tsx';
import { loadAttribution } from '@/features/attribution/queries.ts';
import { DEMO_LABEL, DEMO_NOTICE } from '@/features/demo/provider.ts';
import { siteUrl } from '@/lib/site-url.ts';
import type { BattleConditions, SideData } from '@/services/battle/types.ts';

export const dynamic = 'force-dynamic';

interface PageProps {
  /**
   * Catch-all: slug kanonik berbentuk `karakter/form-vs-karakter/form`, jadi
   * selalu berisi dua segmen path. `[matchup]` biasa hanya menangkap satu
   * segmen dan membuat setiap permalink 404.
   */
  params: Promise<{ matchup: string[] }>;
}

/** Segmen path → slug; segmen yang hilang/berlebih ditolak `parseMatchupSlug`. */
function slugFrom(params: { matchup: string[] }): string {
  return params.matchup.join('/');
}

/** `karakter/form` → `Karakter (Form)` untuk judul yang dapat dibaca. */
function sideTitle(selection: { characterSlug: string; formSlug: string }): string {
  const pretty = (slug: string) => slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return `${pretty(selection.characterSlug)} (${pretty(selection.formSlug)})`;
}

const MODE_LABELS: Record<string, string> = {
  standard: 'mode standar',
  in_character: 'sesuai karakter',
  bloodlusted: 'tanpa ragu',
  random_encounter: 'pertemuan acak',
};

const WIN_LABELS: Record<string, string> = {
  any: 'apa pun',
  death: 'kematian/kehancuran',
  ko: 'knockout',
  incapacitation: 'tidak mampu bertarung',
  bfr: 'keluar dari medan',
};

function conditionsLabel(conditions: BattleConditions): string {
  const parts = [
    MODE_LABELS[conditions.mode] ?? conditions.mode.replace(/_/g, ' '),
    conditions.battlefield === 'neutral' ? null : `medan ${conditions.battlefield}`,
    conditions.speed_equalized ? 'kecepatan disetarakan' : null,
    `kondisi menang ${WIN_LABELS[conditions.win_condition] ?? conditions.win_condition}`,
  ].filter(Boolean);
  return parts.join(', ');
}

/**
 * URL kanonik halaman ini.
 *
 * Kondisi pertarungan ikut di query string hanya bila bukan default: permalink
 * yang dapat dibagikan harus membuka hasil yang sama, dan hasil bergantung pada
 * kondisi. Default tidak ditulis supaya URL biasa tetap pendek.
 */
function canonicalPath(slug: string, conditions: BattleConditions): string {
  const query = new URLSearchParams();
  if (conditions.mode !== 'standard') query.set('mode', conditions.mode);
  if (conditions.battlefield !== 'neutral') query.set('battlefield', conditions.battlefield);
  if (conditions.speed_equalized) query.set('speed_equalized', '1');
  if (conditions.knowledge_level !== 'partial') query.set('knowledge', conditions.knowledge_level);
  if (conditions.prep_time !== 'none') query.set('prep', conditions.prep_time);
  if (conditions.win_condition !== 'incapacitation') query.set('win_condition', conditions.win_condition);
  const suffix = query.toString();
  return `/versus/${slug}${suffix ? `?${suffix}` : ''}`;
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps & {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const matchup = slugFrom(await params);
  const parsed = parseMatchupSlug(matchup);
  // Slug tak sah tidak punya metadata yang bermakna; halaman menjawab 404.
  if (!parsed) return { title: 'Matchup tidak ditemukan', robots: { index: false } };

  const title = `${sideTitle(parsed.sideA)} vs ${sideTitle(parsed.sideB)}`;
  const description = `Simulasi pertarungan ${sideTitle(parsed.sideA)} melawan ${sideTitle(parsed.sideB)}: probabilitas menang, alasan utama, dan rujukan datanya.`;
  // Canonical memuat kondisi yang benar-benar dipakai, bukan default: dua URL
  // dengan kondisi berbeda menghasilkan angka berbeda dan tidak boleh dianggap
  // duplikat satu sama lain.
  const canonical = canonicalPath(matchup, parseBattleConditionsFromQuery(await searchParams));

  // Gambar sosial ditautkan eksplisit: konvensi `opengraph-image` tidak dapat
  // dipakai di bawah segmen catch-all, jadi gambarnya dilayani route handler
  // `/og/versus/[...matchup]`. Nama file gambar memuat slug agar perayap dan CDN
  // tidak menyajikan gambar matchup lain dari cache yang sama.
  const image = `/og/versus/${matchup}`;
  const images = [{ url: image, width: 1200, height: 630, alt: title }];

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'article',
      title,
      description,
      url: canonical,
      siteName: 'Anime VS Battle',
      images,
    },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

/** Data terstruktur: hasil sebagai `Article` dengan dua entitas yang dibandingkan. */
function structuredData(params: {
  slug: string;
  title: string;
  description: string;
  sideA: SideData;
  sideB: SideData;
  winnerName: string;
  probabilityA: number;
  probabilityB: number;
}): string {
  const url = `${siteUrl()}/versus/${params.slug}`;
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: params.title,
    description: params.description,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    about: [
      { '@type': 'Thing', name: params.sideA.character.name, description: params.sideA.form.name },
      { '@type': 'Thing', name: params.sideB.character.name, description: params.sideB.form.name },
    ],
    // Angka yang sama dengan yang tampil di halaman — bukan klaim terpisah.
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'Pemenang simulasi', value: params.winnerName },
      { '@type': 'PropertyValue', name: 'Probabilitas sisi A', value: params.probabilityA },
      { '@type': 'PropertyValue', name: 'Probabilitas sisi B', value: params.probabilityB },
    ],
    isAccessibleForFree: true,
  }).replace(/</g, '\\u003c');
}

export default async function MatchupPage({ params, searchParams }: PageProps & {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const matchup = slugFrom(await params);
  const query = await searchParams;

  // 1. Bentuk slug harus sah. `parseMatchupSlug` menolak jumlah pemisah ≠ 1 dan
  //    sisi yang sama, jadi yang lolos selalu punya dua form berbeda.
  const parsed = parseMatchupSlug(matchup);
  if (!parsed) notFound();

  // 2. Urutan terbalik dialihkan permanen ke bentuk kanonik (308), bukan
  //    dirender: dua URL untuk satu pertarungan akan terpecah di indeks pencarian.
  const target = canonicalRedirectTarget(matchup);
  if (target) {
    // `permanentRedirect` = 308; kondisi di query string dipertahankan supaya
    // pengalihan tidak diam-diam mengubah pertarungan yang diminta.
    // Path dibangun dari slug yang sudah divalidasi; `RouteImpl` generik hanya
    // mengenal literal rute, jadi cast-nya sempit dan lokal.
    permanentRedirect(canonicalPath(target, parseBattleConditionsFromQuery(query)) as never);
  }

  const conditions = parseBattleConditionsFromQuery(query);
  const valueA = `${parsed.sideA.characterSlug}/${parsed.sideA.formSlug}`;
  const valueB = `${parsed.sideB.characterSlug}/${parsed.sideB.formSlug}`;

  const [outcome, attribution] = await Promise.all([
    attemptLoad(() => loadBattleResult({ valueA, valueB, conditions, rule_set: defaultRuleSet() })),
    loadAttribution(),
  ]);

  if (outcome.status === 'failed') {
    return (
      <div className="animate-fade-in mx-auto max-w-2xl">
        <DatabaseUnavailable detail={outcome.message} viewerIsOperator={await isAdminAuthenticated()} />
      </div>
    );
  }

  // Form yang tidak ada di database adalah 404, bukan halaman "simulasi gagal":
  // URL yang dibagikan menunjuk konten yang memang tidak pernah ada.
  if (outcome.data.status === 'invalid') notFound();

  const { result, sideA, sideB, source } = outcome.data.bundle;
  const winnerName =
    result.winner === 'a'
      ? sideA.character.name
      : result.winner === 'b'
        ? sideB.character.name
        : result.winner === 'draw'
          ? 'Seri'
          : 'Data tidak cukup';

  const title = `${sideA.character.name} (${sideA.form.name}) vs ${sideB.character.name} (${sideB.form.name})`;
  const outcomeLabel =
    result.winner === 'draw'
      ? 'seri'
      : result.winner === 'insufficient_data'
        ? 'data tidak cukup untuk menentukan pemenang'
        : `${winnerName} menang`;
  const description = `Simulasi ${title}: ${outcomeLabel} dengan probabilitas ${(result.win_probability.a * 100).toFixed(1)}% vs ${(result.win_probability.b * 100).toFixed(1)}%.`;

  return (
    <>
      <script
        type="application/ld+json"
        // JSON sudah di-escape (`<` → `\u003c`) sehingga tidak dapat menutup tag.
        dangerouslySetInnerHTML={{
          __html: structuredData({
            slug: matchup,
            title,
            description,
            sideA,
            sideB,
            winnerName,
            probabilityA: result.win_probability.a,
            probabilityB: result.win_probability.b,
          }),
        }}
      />

      <div className="animate-fade-in mx-auto mb-6 max-w-3xl text-center">
        <p className="text-xs font-bold uppercase tracking-widest text-ink-3">Permalink pertarungan</p>
        <h1 className="mt-2 text-2xl font-black text-ink-0 sm:text-3xl">{title}</h1>
        <p className="mt-2 text-sm text-ink-2">{conditionsLabel(conditions)}</p>
      </div>

      <BattleResultView
        result={result}
        sideA={sideA}
        sideB={sideB}
        demoSource={source === 'demo'}
        demoLabel={DEMO_LABEL}
        demoNotice={DEMO_NOTICE}
        footer={
          <a href="/versus" className="btn-primary text-xs !py-2 !px-4">
            Simulasi lain
          </a>
        }
      />
      <DataAttribution attribution={attribution} />
    </>
  );
}
