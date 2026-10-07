// Fixture: PELANGGARAN. Rantai builder pada tabel besar — pola Supabase.
const db = {
  from: (_table: string) => ({ select: (_columns: string) => [] as unknown[] }),
};

export const ALL_COLUMNS = db.from('statistics').select('*');

export const ALL_FROM_RESULTS = db.from('battle_results').select('*');

// Tanpa `.from(...)` pada rantai yang sama, tabelnya tidak dapat ditentukan.
const scoped = { select: (_columns: string) => [] as unknown[] };
export const UNKNOWN_TARGET = scoped.select('*');
