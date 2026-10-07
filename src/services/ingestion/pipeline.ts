/**
 * Jalur ingestion — **hanya untuk worker**.
 *
 * Zona ini dilarang diimpor dari jalur request pengguna (PRD §18.1, AC-25).
 * Pelarangan itu bukan konvensi: `tools/architecture/zones.mjs` mendaftarkannya
 * sebagai zona terlarang, dan `npm run lint` gagal bila ada route, page, atau
 * modul `features/*` yang mengimpornya — termasuk secara transitif, karena lint
 * memeriksa setiap berkas, bukan hanya berkas puncak.
 *
 * Isi pipeline (fetcher ber-`robots.txt`, rate limiter, parser, normalizer,
 * validator, dedupe) belum diimplementasikan: itu Sprint 2 (PRD §40). Yang ada
 * sekarang adalah kontraknya, supaya batas arsitektur punya bentuk nyata yang
 * dapat ditegakkan dan diuji — bukan sekadar aturan di atas kertas.
 */

import type { ClaimedIngestionJob } from '../queue/job-lifecycle.ts';

/** Keluaran wajib setiap job (PRD §3) — dipakai dashboard admin. */
export interface IngestionOutcome {
  records_found: number;
  records_created: number;
  records_updated: number;
  records_failed: number;
  /** Diisi bila hasil parsial; penyebabnya harus dapat dilacak (PRD §39). */
  error_code: string | null;
  error_message: string | null;
}

export class IngestionNotImplementedError extends Error {
  override readonly name = 'IngestionNotImplementedError';
  readonly job_id: string;

  // Tanpa parameter property: `erasableSyntaxOnly` melarang sintaks yang
  // menghasilkan kode, karena modul ini juga dimuat Node dengan type stripping.
  constructor(job_id: string) {
    super(
      `Pipeline ingestion belum diimplementasikan (job ${job_id}). Sprint 2 memasang fetcher, rate limiter, dan parser.`,
    );
    this.job_id = job_id;
  }
}

/**
 * Menjalankan satu job. Sengaja **melempar** alih-alih mengembalikan angka nol:
 * job yang dilaporkan "selesai 0 record" tanpa pekerjaan apa pun akan membuat
 * dashboard admin berbohong, dan itu tepat jenis kegagalan yang dilarang
 * prinsip "jangan mengarang data" (PRD §43).
 */
export function runIngestionJob(job: ClaimedIngestionJob): Promise<IngestionOutcome> {
  throw new IngestionNotImplementedError(job.job_id);
}
