/**
 * Probe uptime untuk `/api/health/ready`.
 *
 * Dipakai workflow `.github/workflows/uptime.yml`. Kegagalan probe membuat job
 * GitHub gagal; notifikasi kegagalan workflow adalah alert bawaan. Bila
 * ALERT_WEBHOOK_URL diisi, ringkasan juga dikirim ke webhook Slack-compatible.
 *
 *   DEPLOY_URL=https://... node scripts/check-health.mjs
 */

const base = process.env.HEALTHCHECK_URL?.trim() || process.env.DEPLOY_URL?.trim();
if (!base) {
  console.error('check:health TIDAK DIJALANKAN — set DEPLOY_URL atau HEALTHCHECK_URL.');
  process.exit(2);
}

let url;
try {
  url = new URL('/api/health/ready', base).toString();
} catch {
  console.error('check:health GAGAL — DEPLOY_URL bukan URL yang sah.');
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
    if (!response.ok) console.error(`check:health: webhook HTTP ${response.status}.`);
  } catch (error) {
    console.error(`check:health: webhook gagal: ${error.message}`);
  }
}

const started = Date.now();
let response;
let body = null;
try {
  response = await fetch(url, {
    headers: { 'user-agent': 'animebattle-uptime/1.0' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  body = await response.json().catch(() => null);
} catch (error) {
  const message = `check:health GAGAL — ${url} tidak dapat dihubungi: ${error.message}`;
  console.error(message);
  await notify(message);
  process.exit(1);
}

const latencyMs = Date.now() - started;
const ready = response.status === 200 && body?.status === 'ready';
const summary = {
  ok: ready,
  status: response.status,
  health: typeof body?.status === 'string' ? body.status : null,
  reason: typeof body?.reason === 'string' ? body.reason : null,
  latency_ms: latencyMs,
};

console.log(JSON.stringify(summary));
if (!ready) {
  await notify(
    `check:health GAGAL — ${url} menjawab HTTP ${response.status}` +
      `${summary.health ? ` (${summary.health})` : ''}` +
      `${summary.reason ? ` reason=${summary.reason}` : ''}.`,
  );
  process.exit(1);
}
