/**
 * Tipe HTTP dan pemeriksaan alamat untuk fetcher ingestion.
 *
 * Fetch dan resolusi DNS sengaja ditulis sebagai antarmuka yang dapat disuntik
 * (`FetchLike`, `DnsLookup`), bukan panggilan langsung ke global. Dua alasan:
 * (1) uji dapat mensimulasikan 429, 304, timeout, dan robots yang melarang
 * **tanpa** menyentuh jaringan, sehingga hasil ujinya deterministik; dan
 * (2) seluruh kebijakan SSRF dapat diuji dengan daftar alamat yang dibuat,
 * bukan dengan bergantung pada DNS nyata yang isinya berubah.
 *
 * `isPrivateAddress` dikerjakan di sini — bukan diserahkan ke pustaka — karena
 * inilah satu-satunya pertahanan antara fetcher dan metadata layanan internal
 * (169.254.169.254 dan kawan-kawan, PRD §28 "SSRF").
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Bentuk respons yang benar-benar dipakai fetcher (subset dari `Response`). */
export interface FetchResponseLike {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface FetchInitLike {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  redirect?: 'follow' | 'manual' | 'error';
}

export type FetchLike = (url: string, init?: FetchInitLike) => Promise<FetchResponseLike>;

export type DnsLookup = (hostname: string) => Promise<string[]>;

export const systemFetch: FetchLike = (url, init) => fetch(url, init);

export const systemDnsLookup: DnsLookup = async (hostname) => {
  const records = await lookup(hostname, { all: true });
  return records.map((record) => record.address);
};

/** UA yang jelas dan dapat dihubungi — bagian dari kepatuhan, bukan kosmetik. */
export const INGESTION_USER_AGENT =
  'AVB-Ingestion/0.1 (+https://animevsbattle.invalid/bot; contact: admin@animevsbattle.invalid)';

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return numbers;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ipv4Parts(ip);
  if (!parts) return true; // bentuk tak dikenal: perlakukan sebagai tidak aman
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 169 && b === 254) return true; // link-local (metadata cloud)
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true; // 192.0.0/24, 192.0.2/24
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().split('%')[0];

  // IPv4-mapped (::ffff:169.254.169.254) harus dinilai sebagai IPv4-nya,
  // kalau tidak, blokir IPv4 dapat dilewati hanya dengan menulis ulang bentuknya.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped) return isPrivateIpv4(mapped[1]);

  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fe80')) return true; // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local
  if (normalized.startsWith('ff')) return true; // multicast
  if (normalized.startsWith('64:ff9b')) return true; // NAT64
  if (normalized.startsWith('2001:db8')) return true; // dokumentasi
  return false;
}

/**
 * `true` bila alamat IP tidak boleh dihubungi fetcher.
 *
 * Alamat yang tidak dikenali diperlakukan sebagai privat (gagal tertutup):
 * lebih baik satu sumber sah ditolak dan dilaporkan daripada satu alamat
 * internal lolos karena bentuk penulisannya tidak terduga.
 */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return true;
}

/** Apakah string host adalah alamat IP literal (bukan nama domain)? */
export function isLiteralIp(host: string): boolean {
  return isIP(host) !== 0;
}
