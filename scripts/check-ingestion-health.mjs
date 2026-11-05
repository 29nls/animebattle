/**
 * Alert kesehatan antrian ingestion.
 *
 * Query hanya menghitung status; tidak membaca isi job. Exit 1 bila ada job
 * gagal/macet, sehingga workflow GitHub berubah merah dan notifikasinya menjadi
 * alert. ALERT_WEBHOOK_URL (opsional) mengirim ringkasan ke Slack-compatible
 * webhook.
 *
 *   DATABASE_URL=... node scripts/check-ingestion-health.mjs
 */

import postgres from 'postgres';

import { evaluateIngestionHealth } from '../src/lib/observability/ingestion-health.ts';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error('check:ingestion-health TIDAK DIJALANKAN — DATABASE_URL belum diset.');
  process.exit(2);
}

async function notify(text) {
  const webhook = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!webhook) return;
  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) console.error(`check:ingestion-health: webhook HTTP ${response.status}.`);
  } catch (error) {
    console.error(`check:ingestion-health: webhook gagal: ${error.message}`);
  }
}

let sql;
try {
  sql = postgres(databaseUrl, { max: 1, connect_timeout: 15, onnotice: () => {} });
  const rows = await sql.unsafe(
    `select
       (select count(*)::int from ingestion_jobs
         where status = 'failed'
           and completed_at > now() - interval '24 hours') as failed_jobs,
       (select count(*)::int from ingestion_jobs
         where status = 'processing'
           and started_at < now() - interval '15 minutes') as stuck_jobs,
       (select count(*)::int from ingestion_jobs
         where status = 'pending'
           and created_at < now() - interval '30 minutes') as stale_pending_jobs,
       (select coalesce(max(extract(epoch from (now() - created_at))), 0)::int
          from ingestion_jobs where status = 'pending') as oldest_pending_age_seconds,
       (select coalesce(max(extract(epoch from (now() - started_at))), 0)::int
          from ingestion_jobs where status = 'processing') as oldest_processing_age_seconds`,
  );

  const row = rows[0];
  if (!row) throw new Error('query kesehatan tidak mengembalikan baris');
  const snapshot = {
    failed_jobs: Number(row.failed_jobs),
    stuck_jobs: Number(row.stuck_jobs),
    stale_pending_jobs: Number(row.stale_pending_jobs),
    oldest_pending_age_seconds: Number(row.oldest_pending_age_seconds),
    oldest_processing_age_seconds: Number(row.oldest_processing_age_seconds),
  };
  const verdict = evaluateIngestionHealth(snapshot);
  console.log(JSON.stringify(verdict));

  if (!verdict.healthy) {
    await notify(`check:ingestion-health GAGAL — ${verdict.issues.join('; ')}.`);
    process.exitCode = 1;
  }
} catch (error) {
  const message = `check:ingestion-health GAGAL — pemeriksaan tidak dapat dijalankan: ${error.message}`;
  console.error(message);
  await notify(message);
  process.exitCode = 2;
} finally {
  if (sql) await sql.end({ timeout: 5 });
}
