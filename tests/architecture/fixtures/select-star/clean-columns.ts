// Fixture: BENAR untuk aturan select-star.
export const EXPLICIT = `select id, slug, name from characters limit $1`;

export const COUNT = `select count(*)::text as total from characters`;

export const ARITHMETIC = `select popularity_score * 2 as weighted from characters where id = $1`;

export const SMALL_TABLE = `select * from tiers order by display_order`;

export const RPC = `select * from public.search_characters($1, $2, true)`;

export const BUILDER = `db.from('characters').select('id, slug, name').limit(20)`;
