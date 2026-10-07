// Fixture: PELANGGARAN. Bintang disembunyikan lewat konstanta lokal.
//
// Bentuk ini yang membuat uji mutasi M2 sempat lolos (exit 0): memindahkan '*'
// ke sebuah variabel cukup untuk melewati aturan yang hanya membaca SQL harfiah.
const db = {
  from: (_table: string) => ({ select: (_columns: string) => [] as unknown[] }),
};

const columns = '*';
const wide = '*, id';

export const VIA_CHAIN = db.from('characters').select(columns);

export const VIA_TEMPLATE = `select ${columns} from characters where slug = $1`;

export const VIA_CHAIN_LITERAL = db.from('battle_results').select(wide);
