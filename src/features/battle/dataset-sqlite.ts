/**
 * `battle_dataset` untuk SQLite/D1.
 *
 * Versi Postgres (`docs/schema.sql`) membangun satu jsonb berisi dua sisi.
 * SQLite tidak punya `jsonb_build_object`, tetapi punya `json_object` /
 * `json_group_array` — jadi bentuk keluarannya tetap **sama** dan engine tidak
 * perlu tahu dari database mana datanya datang.
 *
 * Kenapa tetap satu round-trip: seluruh statistik, ability, resistensi, dan
 * trait diagregasi sebagai subquery berkorelasi di dalam satu `select`. Dua
 * panggilan terpisah (satu per sisi) akan menggandakan biaya query terberat di
 * aplikasi ini, persis bentuk N+1 yang dilarang PRD §29.
 */

import type { SqlClient } from '../../lib/db/client.ts';
import type { SideData } from '../../services/battle/types.ts';

/**
 * Satu baris hasil: `payload` berupa JSON teks (D1) yang sudah dinormalisasi
 * menjadi objek oleh klien.
 */
const DATASET_SQL = `
select json_object(
  'version_id', cv.id,
  'character', json_object('id', c.id, 'slug', c.slug, 'name', c.name),
  'verse', json_object('id', v.id, 'slug', v.slug, 'name', v.name),
  'form', json_object(
    'id', cv.id, 'slug', cv.slug, 'name', cv.name, 'era', cv.era,
    'is_variant', json(case when cv.is_variant = 1 then 'true' else 'false' end),
    'media_type', cv.media_type,
    'experience_years', cv.experience_years,
    'data_completeness', cv.data_completeness
  ),
  'tier', json_object(
    'code', t.tier_code, 'rank', t.numerical_rank,
    'rankable', json(case when t.is_rankable = 1 then 'true' else 'false' end)
  ),
  'metrics', json_object(
    'tier', t.numerical_rank,
    'attack_potency', ap.rank, 'durability', du.rank, 'striking_strength', st.rank,
    'lifting_strength', li.rank, 'speed', sp.rank, 'reaction_speed', rs.rank,
    'combat_speed', cs.rank, 'range', rg.rank, 'stamina', sa.rank,
    'intelligence', it.rank, 'battle_iq', bi.rank,
    'experience', cv.experience_years,
    'attack_potency_physical', json(case when ap.is_physical = 1 then 'true' else 'false' end),
    'speed_physical', json(case when sp.is_physical = 1 then 'true' else 'false' end)
  ),
  'nonphysical_metrics', json_array(
    case when ap.is_physical = 0 then 'attack_potency' end,
    case when sp.is_physical = 0 then 'speed' end
  ),
  'statistics', (
    select coalesce(json_group_array(json_object(
             'metric', s.metric, 'raw_text', s.raw_text, 'qualifier', s.qualifier,
             'scale_rank', sc.rank, 'confidence', s.confidence,
             'source_id', s.source_id, 'status', s.status)), json_array())
      from statistics s left join stat_scales sc on sc.id = s.scale_id
     where s.character_version_id = cv.id
  ),
  'abilities', (
    select coalesce(json_group_array(json_object(
             'id', ab.id, 'name', ab.name, 'category_id', ab.category_id,
             'category_slug', ac.slug,
             'category_is_negation', json(case when ac.is_negation = 1 then 'true' else 'false' end),
             'activation_speed', ab.activation_speed,
             'is_offensive', json(case when ab.is_offensive = 1 then 'true' else 'false' end),
             'is_passive', json(case when ab.is_passive = 1 then 'true' else 'false' end),
             'is_prep_required', json(case when ab.is_prep_required = 1 then 'true' else 'false' end),
             'proficiency', ca.proficiency, 'confidence', ca.confidence,
             'effective_range_rank', ars.rank)), json_array())
      from character_abilities ca
      join abilities ab on ab.id = ca.ability_id
      join ability_categories ac on ac.id = ab.category_id
      left join stat_scales ars on ars.id = ca.effective_range_scale_id
     where ca.character_version_id = cv.id
  ),
  'resistances', (
    select coalesce(json_group_array(json_object(
             'resistance_type_id', cr.resistance_type_id,
             'resistance_type_slug', rt.slug,
             'category_id', rt.category_id,
             'category_slug', rac.slug,
             'level', cr.level,
             'level_label', cr.level_label,
             'verification_status', cr.verification_status,
             'confidence', cr.confidence)), json_array())
      from character_resistances cr
      join resistance_types rt on rt.id = cr.resistance_type_id
      join ability_categories rac on rac.id = rt.category_id
     where cr.character_version_id = cv.id
  ),
  'traits', (
    select coalesce(json_group_array(ct.trait), json_array())
      from character_traits ct
     where ct.character_version_id = cv.id
  )
) as payload
  from character_versions cv
  join characters c on c.id = cv.character_id
  join verses v on v.id = c.verse_id
  left join tiers t on t.id = cv.tier_id
  left join stat_scales ap on ap.id = cv.attack_potency_scale_id
  left join stat_scales du on du.id = cv.durability_scale_id
  left join stat_scales st on st.id = cv.striking_scale_id
  left join stat_scales li on li.id = cv.lifting_scale_id
  left join stat_scales sp on sp.id = cv.speed_scale_id
  left join stat_scales rs on rs.id = cv.reaction_speed_scale_id
  left join stat_scales cs on cs.id = cv.combat_speed_scale_id
  left join stat_scales rg on rg.id = cv.range_scale_id
  left join stat_scales sa on sa.id = cv.stamina_scale_id
  left join stat_scales it on it.id = cv.intelligence_scale_id
  left join stat_scales bi on bi.id = cv.battle_iq_scale_id
 where cv.id in ($1, $2) and cv.deleted_at is null
`;

/**
 * Muat dua sisi dari D1. Urutan hasil tidak dijamin, jadi pemetaan dilakukan
 * lewat `version_id` — sama seperti jalur Postgres.
 */
export async function loadBattleSidesSqlite(
  sql: SqlClient,
  versionA: string,
  versionB: string,
): Promise<{ sideA: SideData; sideB: SideData } | null> {
  const rows = await sql.query<{ payload: SideData | string }>(DATASET_SQL, [versionA, versionB]);

  const sides = rows
    .map((row) => (typeof row.payload === 'string' ? (JSON.parse(row.payload) as SideData) : row.payload))
    .filter((side): side is SideData => Boolean(side && typeof side === 'object'));

  const sideA = sides.find((side) => side.version_id === versionA);
  const sideB = sides.find((side) => side.version_id === versionB);
  if (!sideA || !sideB) return null;
  return { sideA, sideB };
}
