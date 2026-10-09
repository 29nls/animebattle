/**
 * Gerbang `robots.txt` (PRD §18.3, §18.5).
 *
 * Tiga perilaku yang disengaja dan mudah salah:
 *
 * 1. **Gagal tertutup.** Bila `robots.txt` tidak dapat diambil (jaringan mati,
 *    timeout, 5xx), halaman **tidak** boleh diambil. Menafsirkan kegagalan
 *    sebagai izin adalah cara paling umum aturan ini dilanggar tanpa sadar.
 * 2. **404 = tidak ada batasan.** Sebaliknya, 404 memang berarti "tidak ada
 *    berkas"; itu jawaban yang sah dan tidak perlu memblokir. Membedakan kedua
 *    kasus ini adalah inti implementasinya.
 * 3. **Pencocokan terpanjang menang, Allow menang pada panjang yang sama.**
 *    `Disallow: /` + `Allow: /api/public/` hanya melarang yang pertama untuk
 *    jalur `/api/public/...`.
 *
 * Cache disimpan per origin dengan TTL, dan TTL disuntik bersama jam sehingga
 * kebijakan kedaluwarsa dapat diuji tanpa menunggu 24 jam.
 */

import { SourcePolicyError } from './sources.ts';
import type { Clock } from './rate-limit.ts';
import { INGESTION_USER_AGENT } from './http.ts';
import type { FetchLike } from './http.ts';

export interface RobotsRule {
  allow: boolean;
  path: string;
}

/** Token UA yang dibaca untuk mencocokkan grup `User-agent`. */
const UA_TOKEN = 'avb-ingestion';

/**
 * Mengurai `robots.txt` menjadi aturan untuk UA kita: aturan dari grup `*`
 * digabung dengan aturan dari grup yang cocok dengan token UA. Grup yang lebih
 * spesifik tidak "menimpa" `*`; keduanya berlaku, dan pencocokan terpanjang
 * yang memutuskan — itu perilaku yang sama dengan crawler besar.
 */
export function parseRobots(text: string): RobotsRule[] {
  const rules: RobotsRule[] = [];
  let applies = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (line === '') continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      const agent = value.toLowerCase();
      applies = agent === '*' || agent === UA_TOKEN || UA_TOKEN.startsWith(agent);
      continue;
    }
    if (!applies) continue;

    if (field === 'disallow' || field === 'allow') {
      // Baris `Disallow:` kosong berarti "izinkan semua" — tidak ada aturan
      // yang ditambahkan, dan aturan `Disallow: /` lain (bila ada) tetap berlaku.
      if (value === '' && field === 'disallow') continue;
      rules.push({ allow: field === 'allow', path: value });
    }
  }

  return rules;
}

/** Apakah `path` (termasuk query) diizinkan oleh aturan? */
export function isPathAllowed(rules: readonly RobotsRule[], path: string): boolean {
  let bestLength = -1;
  let bestAllow = true;

  for (const rule of rules) {
    if (!path.startsWith(rule.path)) continue;
    if (rule.path.length > bestLength) {
      bestLength = rule.path.length;
      bestAllow = rule.allow;
    } else if (rule.path.length === bestLength && rule.allow) {
      bestAllow = true;
    }
  }

  return bestAllow;
}

interface CachedRobots {
  rules: RobotsRule[];
  fetchedAtMs: number;
}

export interface RobotsGateOptions {
  fetchImpl: FetchLike;
  clock: Clock;
  /** TTL cache; PRD §18.5 menyebut 24 jam. */
  ttlMs?: number;
  timeoutMs?: number;
}

export class RobotsGate {
  private readonly fetchImpl: FetchLike;
  private readonly clock: Clock;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, CachedRobots>();

  constructor(options: RobotsGateOptions) {
    this.fetchImpl = options.fetchImpl;
    this.clock = options.clock;
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /**
   * Memutuskan apakah satu URL boleh diambil. Melempar bila `robots.txt`
   * tidak dapat diverifikasi (gangguan sementara → job layak dicoba ulang),
   * dan mengembalikan `false` bila verifikasi berhasil tetapi jalurnya dilarang.
   */
  async allows(url: URL): Promise<boolean> {
    const origin = url.origin;
    const cached = this.cache.get(origin);
    if (cached && this.clock.now() - cached.fetchedAtMs < this.ttlMs) {
      return isPathAllowed(cached.rules, `${url.pathname}${url.search}`);
    }

    const robotsUrl = new URL('/robots.txt', origin).toString();
    let response;
    try {
      response = await this.fetchImpl(robotsUrl, {
        headers: { 'user-agent': INGESTION_USER_AGENT },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new SourcePolicyError(
        `robots.txt ${origin} tidak dapat diambil (${detail}); fetch ditolak (fail-closed, PRD §18.5).`,
      );
    }

    if (response.status === 404 || response.status === 410) {
      // Tidak ada berkas: tidak ada batasan. Ini bukan kegagalan.
      this.cache.set(origin, { rules: [], fetchedAtMs: this.clock.now() });
      return true;
    }

    if (!response.ok) {
      throw new SourcePolicyError(
        `robots.txt ${origin} menjawab HTTP ${response.status}; fetch ditolak (fail-closed, PRD §18.5).`,
      );
    }

    const text = await response.text();
    const rules = parseRobots(text);
    this.cache.set(origin, { rules, fetchedAtMs: this.clock.now() });
    return isPathAllowed(rules, `${url.pathname}${url.search}`);
  }
}
