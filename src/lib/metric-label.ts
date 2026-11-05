/**
 * Label metrik untuk tampilan.
 *
 * Nama metrik di engine adalah identifier stabil (`attack_potency`,
 * `battle_iq`, …). Menampilkannya mentah-mentah membuat antarmuka berbahasa
 * Indonesia tetap terasa Inggris; menerjemahkan di setiap komponen membuat dua
 * halaman dapat menyebut metrik yang sama dengan kata berbeda. Modul murni ini
 * adalah satu-satunya tempat pemetaan itu.
 */

const LABELS: Record<string, string> = {
  tier: 'Tier',
  attack_potency: 'Potensi Serangan',
  durability: 'Ketahanan',
  speed: 'Kecepatan',
  reaction_speed: 'Kecepatan Reaksi',
  combat_speed: 'Kecepatan Tempur',
  range: 'Jangkauan',
  striking_strength: 'Kekuatan Pukulan',
  lifting_strength: 'Kekuatan Angkat',
  stamina: 'Stamina',
  intelligence: 'Kecerdasan',
  battle_iq: 'Kecerdasan Bertarung',
  experience: 'Pengalaman',
};

export function metricLabel(metric: string): string {
  return LABELS[metric] ?? metric.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Urutan tampil yang stabil: metrik penentu lebih dulu, pengalaman terakhir. */
export const METRIC_ORDER = [
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
] as const;
