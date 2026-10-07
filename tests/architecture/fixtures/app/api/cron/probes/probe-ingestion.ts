// Probe AC-25 di zona endpoint terjadwal: sah mengerjakan antrian. Tidak boleh
// ada satu pun laporan terhadap berkas ini.
import { runIngestionJob } from '../../../../src/services/ingestion/pipeline.ts';

export const probe = runIngestionJob;
