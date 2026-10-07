// Probe AC-25 di zona engine: impor relatif ke ingestion, tetapi keluar dari
// zona engine. Harus ditolak.
import { runIngestionJob } from '../../ingestion/pipeline.ts';

export const probe = runIngestionJob;
