/**
 * Evaluasi kesehatan antrian ingestion.
 *
 * Dipisahkan dari skrip agar ambang batas dan keputusan sehat/tidak sehat dapat
 * diuji tanpa database. Skrip hanya menjalankan query dan meneruskan angka.
 */

export interface IngestionHealthSnapshot {
  /** Job `failed` yang selesai dalam jendela pemantauan. */
  failed_jobs: number;
  /** Job `processing` yang mulai lebih lama dari ambang. */
  stuck_jobs: number;
  /** Job `pending` yang dibuat lebih lama dari ambang. */
  stale_pending_jobs: number;
  oldest_pending_age_seconds: number;
  oldest_processing_age_seconds: number;
}

export interface IngestionHealthThresholds {
  failed_jobs: number;
  stuck_jobs: number;
  stale_pending_jobs: number;
}

export const DEFAULT_INGESTION_THRESHOLDS: IngestionHealthThresholds = {
  // Satu kegagalan terminal adalah sinyal yang harus dilihat manusia. Job yang
  // masih punya retry tidak masuk hitungan ini (statusnya `pending`).
  failed_jobs: 0,
  stuck_jobs: 0,
  // Antrian boleh punya jeda, tetapi job pending setengah jam tanpa diproses
  // berarti worker/cron berhenti bekerja.
  stale_pending_jobs: 0,
};

export interface IngestionHealthVerdict {
  healthy: boolean;
  issues: string[];
  snapshot: IngestionHealthSnapshot;
}

export function evaluateIngestionHealth(
  snapshot: IngestionHealthSnapshot,
  thresholds: IngestionHealthThresholds = DEFAULT_INGESTION_THRESHOLDS,
): IngestionHealthVerdict {
  const issues: string[] = [];
  if (snapshot.failed_jobs > thresholds.failed_jobs) {
    issues.push(`${snapshot.failed_jobs} job ingestion gagal dalam 24 jam terakhir`);
  }
  if (snapshot.stuck_jobs > thresholds.stuck_jobs) {
    issues.push(`${snapshot.stuck_jobs} job processing macet lebih dari 15 menit`);
  }
  if (snapshot.stale_pending_jobs > thresholds.stale_pending_jobs) {
    issues.push(`${snapshot.stale_pending_jobs} job pending lebih dari 30 menit`);
  }
  return { healthy: issues.length === 0, issues, snapshot };
}
