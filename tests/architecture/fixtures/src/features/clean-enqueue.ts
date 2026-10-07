// Fixture: BENAR. Jalur request memicu ingestion dengan cara yang sah: satu
// insert ke antrian, tanpa menyentuh modul ingestion.
import { enqueueIngestionJob } from '../services/queue/ingestion-jobs.ts';
import type { SqlClient } from '../lib/db/client.ts';

export async function POST(sql: SqlClient): Promise<{ job_id: string }> {
  const job = await enqueueIngestionJob(sql, { scope: 'manual_run', target_ref: 'x' });
  return { job_id: job.job_id };
}
