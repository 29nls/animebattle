// Probe AC-25 di zona worker: ini tempat SAH menjalankan ingestion. Tidak boleh
// ada satu pun laporan terhadap berkas ini.
import { runIngestionJob } from '../../src/services/ingestion/pipeline.ts';

export const probe = runIngestionJob;
