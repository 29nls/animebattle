/**
 * Registry sumber ingestion: allow-list, lisensi, dan prioritas.
 *
 * Aturan yang dikunci di sini berasal dari PRD §18.5 (kebijakan sumber) dan
 * LP-6: sumber non-`allowed`, sumber nonaktif, dan sumber tanpa metadata
 * lisensi **tidak boleh** diimpor. Ketiganya gagal di sini — sebelum fetch,
 * sebelum parse, sebelum satu baris pun masuk tabel kanonik — dengan
 * `SourcePolicyError` yang tipenya `PolicyBlocked`, sehingga kegagalannya
 * terlihat sebagai keputusan kebijakan di `/admin/ingestion`, bukan sebagai
 * bug parser.
 *
 * Prioritas sumber dipakai lapisan upsert: angka lebih kecil = lebih kuat.
 * Nilai yang datang dari sumber berprioritas lebih lemah tidak menimpa nilai
 * sumber yang lebih kuat (PRD §18.3, "upsert layer").
 */

import type { SqlClient } from '../../lib/db/client.ts';
import { resolveSourceForUrl as resolveAllowListedSource } from '../../lib/source-allow-list.ts';

export interface IngestionSource {
  id: string;
  slug: string;
  name: string;
  base_url: string;
  source_type: string;
  priority: number;
  legal_status: string;
  respect_robots: boolean;
  rate_limit_rps: number;
  max_fetches_per_day: number;
  license: string | null;
  license_url: string | null;
  attribution_text: string | null;
  is_active: boolean;
}

/** Ditolak oleh kebijakan, bukan oleh data atau jaringan. */
export class SourcePolicyError extends Error {
  override readonly name = 'SourcePolicyError';
  readonly error_type = 'PolicyBlocked' as const;
  readonly http_status: number | null = null;

  constructor(message: string) {
    super(message);
  }
}

const SOURCE_COLUMNS = `id, slug, name, base_url, source_type, priority, legal_status,
                        respect_robots, rate_limit_rps::float8 as rate_limit_rps,
                        max_fetches_per_day, license, license_url, attribution_text, is_active`;

export async function loadSourceBySlug(sql: SqlClient, slug: string): Promise<IngestionSource | null> {
  const rows = await sql.query<IngestionSource>(
    `select ${SOURCE_COLUMNS} from sources where slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}

export async function loadSourceById(sql: SqlClient, id: string): Promise<IngestionSource | null> {
  const rows = await sql.query<IngestionSource>(
    `select ${SOURCE_COLUMNS} from sources where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Sumber yang boleh dipakai worker: aktif dan legal. */
export async function listEnabledSources(sql: SqlClient): Promise<IngestionSource[]> {
  return sql.query<IngestionSource>(
    `select ${SOURCE_COLUMNS}
       from sources
      where is_active and legal_status = 'allowed'
      order by priority, slug`,
  );
}

/**
 * Mencocokkan URL target dengan sumber allow-list.
 *
 * Implementasinya tinggal di `src/lib/source-allow-list.ts` karena jalur request
 * memakai aturan yang sama untuk menolak impor URL non-allowed dengan 409
 * `SOURCE_DISABLED` sebelum menulis antrian (AC-19). Dua salinan algoritma ini
 * akan membuat UI dan worker tidak sepakat tentang URL mana yang sah.
 * Sumber berskema `about:` (impor internal/dataset) sengaja tidak pernah cocok:
 * ia bukan alamat yang boleh di-fetch.
 */
export function resolveSourceForUrl(
  sources: readonly IngestionSource[],
  target: string,
): IngestionSource | null {
  return resolveAllowListedSource(sources, target);
}

/**
 * Pemeriksaan kebijakan wajib sebelum impor. Melempar `SourcePolicyError`
 * dengan pesan yang menyebut penyebabnya, karena pesan inilah yang dibaca
 * admin di panel error.
 */
export function assertSourceUsable(source: IngestionSource): void {
  if (source.legal_status !== 'allowed') {
    throw new SourcePolicyError(
      `Sumber "${source.slug}" berstatus legal ${source.legal_status}; impor ditolak sampai review legal selesai (PRD §18.5).`,
    );
  }
  if (!source.is_active) {
    throw new SourcePolicyError(`Sumber "${source.slug}" tidak aktif.`);
  }
  if (source.license === null || source.license.trim() === '') {
    throw new SourcePolicyError(
      `Sumber "${source.slug}" tidak mencantumkan lisensi; LP-6 menolak impor tanpa metadata lisensi.`,
    );
  }
}

/** Teks atribusi yang ditampilkan di UI; dijamin ada karena lisensi sudah diperiksa. */
export function attributionFor(source: IngestionSource): string {
  return source.attribution_text ?? `Data berasal dari ${source.name}.`;
}
