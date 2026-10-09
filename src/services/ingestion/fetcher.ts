/**
 * Fetcher ber-policy (PRD §18.3, §28 "SSRF", §18.5).
 *
 * Fetcher ini sengaja **tidak** memakai `redirect: 'follow'`. Mengikuti redirect
 * secara otomatis berarti host akhir tidak pernah diperiksa — dan itu satu-satunya
 * celah yang membuat allow-list serta guard SSRF dapat dilewati hanya dengan
 * `302 Location: http://169.254.169.254/…`. Karena itu redirect diikuti manual,
 * maksimal tiga lompatan, dengan pemeriksaan ulang penuh di setiap lompatan.
 *
 * Urutan pemeriksaan sebelum satu byte pun diambil:
 *   skema → kredensial di URL → allow-list sumber → DNS/kelas alamat → robots
 *   → rate limit per host → fetch → (redirect? ulangi) → respons.
 *
 * Kegagalan sementara (timeout, 429, 5xx) dicoba ulang dengan backoff
 * eksponensial + jitter, menghormati `Retry-After`; kegagalan tetap (4xx lain,
 * pelanggaran kebijakan) dilempar sebagai error bertipe supaya worker menandai
 * job dengan `error_type` yang benar, bukan `ParserError` untuk semua hal.
 */

import { INGESTION_USER_AGENT, isLiteralIp, isPrivateAddress } from './http.ts';
import type { DnsLookup, FetchLike } from './http.ts';
import type { Clock } from './rate-limit.ts';
import { HostRateLimiter } from './rate-limit.ts';
import type { RobotsGate } from './robots.ts';
import { SourcePolicyError } from './sources.ts';
import type { IngestionSource } from './sources.ts';
import { resolveSourceForUrl } from './sources.ts';

export type FetchErrorType = 'SourceUnavailable' | 'RateLimited';

/** Kegagalan fetch yang tipenya diteruskan ke `ingestion_jobs.error_type`. */
export class IngestionFetchError extends Error {
  override readonly name = 'IngestionFetchError';
  readonly error_type: FetchErrorType;
  readonly http_status: number | null;
  /** `true` = percobaan ulang tidak akan menolong (mis. 401/403 dari sumber). */
  readonly terminal: boolean;
  /** Nilai `Retry-After` bila sumber mengirimnya; worker memakainya sebagai jeda dasar. */
  readonly retry_after_seconds: number | null;

  constructor(
    message: string,
    errorType: FetchErrorType,
    httpStatus: number | null = null,
    terminal = false,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.error_type = errorType;
    this.http_status = httpStatus;
    this.terminal = terminal;
    this.retry_after_seconds = retryAfterSeconds;
  }
}

export interface FetcherOptions {
  fetchImpl: FetchLike;
  dnsLookup: DnsLookup;
  clock: Clock;
  rateLimiter: HostRateLimiter;
  robots: RobotsGate;
  timeoutMs?: number;
  maxAttempts?: number;
  maxRedirects?: number;
  /** Sumber keacakan untuk jitter; disuntik agar uji deterministik. */
  jitter?: () => number;
}

export interface FetchPageOptions {
  /**
   * Nilai `If-Modified-Since` dari staging terakhir untuk URL yang sama.
   * 304 bukan kegagalan: artinya isi belum berubah dan pekerjaan bisa berhenti.
   */
  ifModifiedSince?: string | null;
}

export interface FetchPageResult {
  status: number;
  notModified: boolean;
  text: string;
  url: string;
}

const MAX_ATTEMPTS = 5;
const MAX_REDIRECTS = 3;
const RETRY_AFTER_CAP_SECONDS = 60;

function hostOf(url: URL): string {
  return url.host.toLowerCase();
}

function assertUrlShape(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SourcePolicyError(`Skema ${url.protocol} tidak diizinkan; hanya http/https.`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new SourcePolicyError('URL dengan kredensial tertanam ditolak (dapat membocorkan rahasia ke log).');
  }
}

async function assertHostIsPublic(url: URL, dnsLookup: DnsLookup): Promise<void> {
  if (isLiteralIp(url.hostname)) {
    if (isPrivateAddress(url.hostname)) {
      throw new SourcePolicyError(
        `Alamat ${url.hostname} berada di rentang privat/loopback; fetch ditolak (SSRF, PRD §28).`,
      );
    }
    return;
  }

  let addresses: string[];
  try {
    addresses = await dnsLookup(url.hostname);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new IngestionFetchError(
      `DNS ${url.hostname} gagal: ${detail}`,
      'SourceUnavailable',
      null,
      false,
    );
  }

  if (addresses.length === 0) {
    throw new IngestionFetchError(`DNS ${url.hostname} tidak mengembalikan alamat.`, 'SourceUnavailable');
  }
  const blocked = addresses.filter((address) => isPrivateAddress(address));
  if (blocked.length > 0) {
    throw new SourcePolicyError(
      `Host ${url.hostname} menuju alamat privat (${blocked.join(', ')}); fetch ditolak (SSRF, PRD §28).`,
    );
  }
}

function retryAfterSeconds(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(RETRY_AFTER_CAP_SECONDS, Math.ceil(seconds));
  }
  // Bentuk tanggal (RFC 7231) — dipakai sebagian server.
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.min(RETRY_AFTER_CAP_SECONDS, Math.max(0, Math.ceil((date - Date.now()) / 1000)));
}

/**
 * Mengambil satu halaman dari sumber allow-list. Melempar `SourcePolicyError`
 * (kebijakan) atau `IngestionFetchError` (jaringan/HTTP) — pemanggil tidak perlu
 * menebak kategori kegagalan dari pesan.
 */
export async function fetchSourcePage(
  source: IngestionSource,
  target: string,
  options: FetcherOptions,
  fetchOptions: FetchPageOptions = {},
): Promise<FetchPageResult> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const jitter = options.jitter ?? (() => 0.5);

  let current = new URL(target);
  assertUrlShape(current);

  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    // Allow-list diperiksa di setiap lompatan (termasuk URL awal).
    if (resolveSourceForUrl([source], current.toString()) === null) {
      throw new SourcePolicyError(
        `URL ${current.toString()} berada di luar base_url sumber "${source.slug}" (allow-list, PRD §18.5).`,
      );
    }
    await assertHostIsPublic(current, options.dnsLookup);

    if (source.respect_robots) {
      const allowed = await options.robots.allows(current);
      if (!allowed) {
        throw new SourcePolicyError(
          `robots.txt melarang ${current.pathname}; fetch dibatalkan (PRD §18.5).`,
        );
      }
    }

    let response;
    for (let attempt = 1; ; attempt += 1) {
      await options.rateLimiter.acquire(hostOf(current), source.rate_limit_rps);

      try {
        response = await options.fetchImpl(current.toString(), {
          redirect: 'manual',
          headers: {
            'user-agent': INGESTION_USER_AGENT,
            accept: 'application/json, text/plain;q=0.5, */*;q=0.1',
            ...(fetchOptions.ifModifiedSince
              ? { 'if-modified-since': fetchOptions.ifModifiedSince }
              : {}),
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        break;
      } catch (error) {
        if (attempt >= maxAttempts) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new IngestionFetchError(
            `Fetch ${current.toString()} gagal setelah ${maxAttempts} percobaan: ${detail}`,
            'SourceUnavailable',
          );
        }
        const backoff = Math.min(30_000, 2_000 * 2 ** (attempt - 1) + jitter() * 500);
        await options.clock.sleep(backoff);
      }
    }

    if (response.status === 304) {
      return { status: 304, notModified: true, text: '', url: current.toString() };
    }

    if (response.status === 429 || response.status >= 500) {
      // Kegagalan sementara tidak ditunggu di sini: job dikembalikan ke antrian
      // lewat `markJobFailed`, yang menaikkan `retry_count` dan memasang jeda
      // eksponensial. Menunggu di dalam worker akan menahan satu worker penuh
      // untuk satu sumber yang sedang sakit — persis yang dihindari oleh
      // arsitektur antrian (PRD §18.1).
      throw new IngestionFetchError(
        response.status === 429
          ? 'Sumber menjawab HTTP 429 (rate limited); job dikembalikan ke antrian dengan jeda (PRD §18.5).'
          : `Sumber menjawab HTTP ${response.status}; job dikembalikan ke antrian (PRD §18.5).`,
        response.status === 429 ? 'RateLimited' : 'SourceUnavailable',
        response.status,
        false,
        retryAfterSeconds(response.headers.get('retry-after')),
      );
    }

    if (response.status >= 301 && response.status <= 308) {
      const location = response.headers.get('location');
      if (location === null) {
        throw new IngestionFetchError(
          `Redirect HTTP ${response.status} tanpa header Location.`,
          'SourceUnavailable',
          response.status,
          true,
        );
      }
      const next = new URL(location, current);
      // Pemeriksaan penuh akan dijalan kan pada iterasi berikutnya;
      // di sini cegah hanya redirect yang jelas-jelas keluar skema aman.
      assertUrlShape(next);
      current = next;
      continue;
    }

    if (!response.ok) {
      throw new IngestionFetchError(
        `Sumber menjawab HTTP ${response.status}; fetch dihentikan.`,
        'SourceUnavailable',
        response.status,
        // 401/403/404/422 tidak berubah karena dicoba lagi.
        response.status >= 400 && response.status < 500,
      );
    }

    return { status: response.status, notModified: false, text: await response.text(), url: current.toString() };
  }

  throw new SourcePolicyError(
    `Terlalu banyak redirect (> ${maxRedirects}); fetch dihentikan (PRD §18.5).`,
  );
}
