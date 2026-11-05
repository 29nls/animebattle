/**
 * Atribusi sumber untuk halaman data.
 *
 * PRD mewajibkan setiap fakta dapat ditelusuri ke `source_id`, dan halaman
 * karakter sudah menampilkan panel per-karakter. Halaman daftar (karakter,
 * verse, hasil battle, homepage) tidak punya satu karakter pun sebagai pemilik
 * panel itu, sehingga atribusi tingkat dataset perlu dibaca terpisah di sini.
 *
 * Keputusan penting: kegagalan memuat atribusi **tidak boleh menjatuhkan
 * halaman**. Atribusi adalah kewajiban, bukan data utama; bila query gagal,
 * komponen menampilkan keadaan "atribusi belum dapat dimuat" dan halaman tetap
 * merender data yang sudah berhasil dimuat. Karena itu fungsi ini menangkap
 * galatnya sendiri, berbeda dari query data yang sengaja melempar.
 */

import { getSqlClient, isDatabaseConfigured, type SqlClient } from '../../lib/db/client.ts';
import { demoEnabled } from '../demo/provider.ts';

export interface AttributionEntry {
  source_name: string;
  source_url: string | null;
  license: string | null;
  license_url: string | null;
  attribution_text: string | null;
}

export type AttributionStatus = 'database' | 'demo' | 'unavailable' | 'failed';

export interface Attribution {
  rows: AttributionEntry[];
  status: AttributionStatus;
}

/**
 * Satu baris per kombinasi sumber + lisensi.
 *
 * `character_sources` menyimpan metadata lisensi dari envelope dataset dan
 * menang atas registry `sources` lewat `coalesce` — alasan yang sama dengan
 * panel Data Traceability: registry dipakai bersama banyak dataset, sedangkan
 * lisensi sebenarnya melekat pada impor.
 */
export async function listAttribution(sql: SqlClient, limit = 20): Promise<AttributionEntry[]> {
  const capped = Math.min(Math.max(1, Math.floor(limit)), 50);
  return sql.query<AttributionEntry>(
    `select distinct s.name as source_name,
            s.base_url as source_url,
            coalesce(cs.license, s.license) as license,
            coalesce(cs.license_url, s.license_url) as license_url,
            coalesce(cs.attribution_text, s.attribution_text) as attribution_text
       from character_sources cs
       join sources s on s.id = cs.source_id
      order by s.name asc
      limit $1`,
    [capped],
  );
}

/**
 * Atribusi yang aman dirender: tidak pernah melempar.
 *
 * Status dibedakan supaya komponen tidak berbohong: `demo` berarti dataset
 * sintetis (tidak ada sumber eksternal), `unavailable` berarti database belum
 * dikonfigurasi, dan `failed` berarti query gagal — tiga keadaan yang tidak
 * boleh tampil sebagai "tidak ada sumber".
 */
export async function loadAttribution(): Promise<Attribution> {
  if (demoEnabled() && !isDatabaseConfigured()) {
    return { rows: [], status: 'demo' };
  }
  if (!isDatabaseConfigured()) {
    return { rows: [], status: 'unavailable' };
  }

  try {
    return { rows: await listAttribution(getSqlClient()), status: 'database' };
  } catch (error) {
    console.error('[attribution] sumber data tidak dapat dibaca:', error);
    return { rows: [], status: 'failed' };
  }
}
