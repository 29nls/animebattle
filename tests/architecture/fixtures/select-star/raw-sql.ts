// Fixture: PELANGGARAN. `select *` pada tabel besar.
export const LIST = `select * from characters order by popularity_score desc limit $1`;

export const ALIASED = 'select c.* from characters c where c.slug = $1';

export const MIXED = `select id, * from battle_results where input_hash = $1`;
