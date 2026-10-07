/**
 * Layer 6 — reasoning generator deterministik (PRD §17.4) + validator RG-1.
 *
 * Aturan anti-halusinasi: setiap kalimat menyimpan rujukan terstruktur
 * (`metric:*`, `edge:*`, `limitation:*`, `assumption:*`, `condition:*`).
 * `validateReasoningTraceability` menolak keluaran yang memuat klaim tanpa
 * rujukan — fail-closed, bukan fail-open.
 */

import type { BattleLength, Difficulty } from './difficulty.ts';
import type { DominanceResult } from './gates.ts';
import type {
  AbilityOutcome,
  BattleConditions,
  BattleReasoning,
  DecisiveEdge,
  ReasoningItem,
  RuleSet,
  ScoreContribution,
  SideData,
} from './types.ts';

// Satu sumber definisi untuk ReasoningItem: ./types.ts (dipakai juga oleh BattleResult).
export type { ReasoningItem };

export interface ReasoningBundle {
  primary: ReasoningItem;
  secondary: ReasoningItem[];
  criticalCounter: ReasoningItem;
  scenario: ReasoningItem;
}

export interface ReasoningContext {
  sideA: SideData;
  sideB: SideData;
  breakdown: ScoreContribution[];
  outcomes: AbilityOutcome[];
  edges: DecisiveEdge[];
  limitations: string[];
  assumptions: string[];
  conditions: BattleConditions;
  dominance: DominanceResult;
  winner: 'a' | 'b' | 'draw' | 'insufficient_data';
  probability: number;
  difficulty: Difficulty;
  battleLength: BattleLength;
  ruleSet: RuleSet;
}

const METRIC_LABEL: Record<string, string> = {
  tier: 'tier',
  attack_potency: 'attack potency',
  durability: 'durability',
  speed: 'speed',
  reaction_speed: 'reaction speed',
  combat_speed: 'combat speed',
  range: 'range',
  stamina: 'stamina',
  intelligence: 'intelligence',
  battle_iq: 'battle IQ',
  experience: 'experience',
  abilities: 'jumlah/kedalaman ability',
  hax: 'tekanan hax efektif',
  resistances: 'cakupan resistensi',
};

function label(metric: string): string {
  return METRIC_LABEL[metric] ?? metric;
}

function sideName(side: 'a' | 'b'): string {
  return side === 'a' ? 'Character A' : 'Character B';
}

/** Kontribusi dominan, terurut; hanya yang benar-benar bergerak. */
function dominantContributions(breakdown: ScoreContribution[], limit: number): ScoreContribution[] {
  return [...breakdown]
    .filter((row) => Math.abs(row.contribution) >= 0.005)
    .sort((x, y) => Math.abs(y.contribution) - Math.abs(x.contribution))
    .slice(0, limit);
}

function decisiveFor(edges: DecisiveEdge[], side: 'a' | 'b'): DecisiveEdge[] {
  return edges.filter((e) => e.decisive && e.side === side);
}

export function buildReasoning(ctx: ReasoningContext): ReasoningBundle {
  const {
    breakdown,
    edges,
    outcomes,
    limitations,
    assumptions,
    dominance,
    winner,
    probability,
    difficulty,
    battleLength,
    conditions,
  } = ctx;

  const contributions = dominantContributions(breakdown, 5);
  const decisiveA = decisiveFor(edges, 'a');
  const decisiveB = decisiveFor(edges, 'b');
  const winnerSide: 'a' | 'b' | null = winner === 'a' || winner === 'b' ? winner : null;
  const winnerDecisive = winnerSide ? (winnerSide === 'a' ? decisiveA : decisiveB) : [];

  // ---- primary reason
  let primary: ReasoningItem;
  if (winnerSide === null) {
    primary = {
      text:
        winner === 'draw'
          ? 'Tidak ada keunggulan yang cukup menentukan pada data yang tersedia; hasil dianggap seimbang.'
          : 'Data minimum tidak terpenuhi sehingga tidak ada pemenang yang dapat dinyatakan.',
      refs: limitations.map((l) => `limitation:${l}`),
    };
  } else if (dominance.applies && dominance.dominantSide === winnerSide) {
    primary = {
      text: `Dominasi statistik menyeluruh: selisih tier ${dominance.tierDelta} peringkat dan durability ${dominance.durabilityDelta} peringkat, sehingga tidak ada jalur bertahan yang terdokumentasi bagi lawan.`,
      refs: ['metric:tier', 'metric:durability'],
    };
  } else if (winnerDecisive.length > 0) {
    primary = {
      text: `Keunggulan kemampuan penentu: ${winnerDecisive
        .map((e) => e.ability_name)
        .join(', ')} berjalan efektif tanpa penangkalan yang terdokumentasi.`,
      refs: winnerDecisive.map((e) => `edge:${e.id}`),
    };
  } else {
    const top = contributions.slice(0, 3);
    primary = {
      text: `Keunggulan gabungan pada ${top.map((row) => label(row.metric)).join(', ')}.`,
      refs: top.map((row) => `metric:${row.metric}`),
    };
  }
  if (primary.refs.length === 0) {
    primary = { text: primary.text, refs: [`condition:win_condition`] };
  }

  // ---- secondary factors
  const secondary: ReasoningItem[] = [];
  for (const row of contributions) {
    if (row.a_value === 0) continue;
    const favored = row.a_value > 0 ? 'a' : 'b';
    secondary.push({
      text: `${sideName(favored)} unggul pada ${label(row.metric)}${
        row.note ? ` (${row.note})` : ''
      }`,
      refs: [`metric:${row.metric}`],
    });
    if (secondary.length >= 4) break;
  }
  if (secondary.length === 0) {
    secondary.push({
      text: 'Tidak ada metrik yang menunjukkan keunggulan berarti.',
      refs: contributions.length > 0 ? [`metric:${contributions[0]!.metric}`] : ['condition:mode'],
    });
  }

  // ---- critical counter
  const loserSide: 'a' | 'b' | null = winnerSide === 'a' ? 'b' : winnerSide === 'b' ? 'a' : null;
  let criticalCounter: ReasoningItem;
  if (loserSide) {
    const loserData = loserSide === 'a' ? ctx.sideA : ctx.sideB;
    const loserOutcomes = outcomes.filter((o) => o.side === loserSide);
    const usable = loserOutcomes.filter((o) => o.effectiveness > 0 && o.inactive_reason === null);
    if (usable.length > 0) {
      const best = [...usable].sort((x, y) => y.effectiveness - x.effectiveness)[0]!;
      criticalCounter = {
        text: `${sideName(loserSide)} hanya punya jalur menang realistis bila ${best.ability_name} berhasil lebih dulu (efektivitas ${best.effectiveness.toFixed(2)}, win condition ${conditions.win_condition}).`,
        refs: [`edge:${best.side}:${best.category_slug}:${best.ability_id}`],
      };
    } else if (loserData.abilities.filter((a) => a.is_offensive).length === 0) {
      criticalCounter = {
        text: `Tidak ada win condition yang terdokumentasi bagi ${sideName(loserSide)}: tidak ada ability ofensif yang tercatat.`,
        refs: [`assumption:no_documented_abilities:${loserSide}`],
      };
    } else {
      const blocked = loserOutcomes.filter((o) => o.status === 'blocked' || o.status === 'reduced');
      criticalCounter = {
        text:
          blocked.length > 0
            ? `Semua jalur menang ${sideName(loserSide)} tertahan: ${blocked
                .map((o) => `${o.ability_name} (${o.status})`)
                .join(', ')}.`
            : `Tidak ada jalur menang yang terdokumentasi bagi ${sideName(loserSide)} terhadap kombinasi ability dan resistensi lawan.`,
        refs: blocked.slice(0, 3).map((o) => `edge:${o.side}:${o.category_slug}:${o.ability_id}`),
      };
      if (criticalCounter.refs.length === 0) {
        criticalCounter = {
          text: criticalCounter.text,
          refs: [`metric:${contributions[0]?.metric ?? 'tier'}`],
        };
      }
    }
  } else {
    criticalCounter = {
      text: 'Tidak ada jalur menang yang dapat diidentifikasi karena tidak ada pemenang yang dinyatakan.',
      refs: limitations.length > 0 ? [`limitation:${limitations[0]!}`] : ['condition:win_condition'],
    };
  }

  // ---- potential scenario (template bercabang, tanpa bahasa absolut)
  const speedRow = breakdown.find((r) => r.metric === 'speed');
  const speedGap = speedRow ? Math.abs(speedRow.a_value) : 0;
  const rangeRow = breakdown.find((r) => r.metric === 'range');
  const scenarioParts: string[] = [];
  scenarioParts.push(
    battleLength === 'short'
      ? 'Pertarungan diperkirakan singkat: selisih daya tahan cukup besar atau salah satu pihak memiliki kemampuan yang langsung menentukan'
      : battleLength === 'long'
        ? 'Pertarungan diperkirakan berlangsung panjang karena daya tahan dan kemampuan pemulihan kedua pihak berimbang'
        : 'Pertarungan diperkirakan berlangsung sedang, dengan beberapa fase saling tukar tekanan',
  );
  if (speedGap >= 0.4) {
    scenarioParts.push('selisih kecepatan membuat salah satu pihak menentukan tempo');
  } else {
    scenarioParts.push('kecepatan kedua pihak relatif berdekatan sehingga urutan tindakan tidak otomatis ditentukan');
  }
  if (winnerDecisive.length > 0) {
    scenarioParts.push(
      `kemampuan penentu (${winnerDecisive.map((e) => e.ability_name).join(', ')}) menjadi jalur kemenangan utama`,
    );
  }
  const opening = openingContext(conditions);
  if (opening) scenarioParts.push(opening);
  scenarioParts.push(
    `kondisi yang dipilih (${conditions.mode}, ${conditions.knowledge_level} knowledge, ${conditions.win_condition}) membentuk jalannya pertarungan`,
  );

  const scenarioRefs = ['metric:speed', 'condition:mode', 'condition:win_condition'];
  if (rangeRow) scenarioRefs.push('metric:range');
  for (const edge of winnerDecisive) scenarioRefs.push(`edge:${edge.id}`);

  const scenario: ReasoningItem = {
    text: `Simulasi ini bersifat analitis, bukan narasi kanon: ${scenarioParts.join('; ')}. Hasil bergantung pada data yang tersedia dan asumsi yang dicatat.`,
    refs: [...new Set(scenarioRefs)],
  };

  return { primary, secondary, criticalCounter, scenario };
}

/** Catatan kondisi awal pertarungan, bila relevan untuk skenario. */
function openingContext(conditions: BattleConditions): string | null {
  const parts: string[] = [];
  if (conditions.starting_distance_rank !== null) parts.push('jarak awal membatasi kemampuan berjangkauan pendek');
  if (conditions.prep_time !== 'none') parts.push('waktu persiapan memberi ruang menyiapkan teknik tertentu');
  if (conditions.battlefield !== 'neutral') parts.push(`medan ${conditions.battlefield} memengaruhi ruang gerak`);
  return parts.length > 0 ? parts.join(' dan ') : null;
}

export interface TraceabilityResult {
  ok: boolean;
  unresolved: string[];
  checkedRefs: number;
}

/** Kode kondisi yang sah sebagai rujukan reasoning. */
const CONDITION_REF_KEYS = [
  'mode',
  'speed_equalized',
  'starting_distance_rank',
  'battlefield',
  'knowledge_level',
  'prep_time',
  'win_condition',
];

/** RG-1: setiap rujukan harus dapat diselesaikan ke data hasil. */
export function validateReasoningTraceability(input: {
  reasoning: BattleReasoning;
  breakdown: ScoreContribution[];
  edges: DecisiveEdge[];
  limitations: string[];
  assumptions: string[];
}): TraceabilityResult {
  const metrics = new Set<string>(input.breakdown.map((r) => r.metric));
  const edgeIds = new Set(input.edges.map((e) => e.id));
  const limitations = new Set(input.limitations);
  const assumptions = new Set(input.assumptions);
  const unresolved: string[] = [];
  let checked = 0;

  const items: ReasoningItem[] = [
    input.reasoning.primary,
    ...input.reasoning.secondary,
    input.reasoning.critical_counter,
    input.reasoning.scenario,
  ];

  for (const item of items) {
    if (item.refs.length === 0) unresolved.push('<item tanpa rujukan>');
    for (const ref of item.refs) {
      checked += 1;
      const [kind, ...rest] = ref.split(':');
      const value = rest.join(':');
      const ok =
        (kind === 'metric' && metrics.has(value)) ||
        (kind === 'edge' && edgeIds.has(value)) ||
        (kind === 'limitation' && limitations.has(value)) ||
        (kind === 'assumption' && assumptions.has(value)) ||
        (kind === 'condition' && CONDITION_REF_KEYS.includes(value));
      if (!ok) unresolved.push(ref);
    }
  }

  return { ok: unresolved.length === 0, unresolved: [...new Set(unresolved)], checkedRefs: checked };
}
