// Fixture: PELANGGARAN. Zona Node tidak boleh memakai alias `@/`.
import type { SqlClient } from '@/lib/db/client.ts';

export function wrap(sql: SqlClient): SqlClient {
  return sql;
}
