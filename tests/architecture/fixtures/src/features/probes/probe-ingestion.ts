// Probe AC-25 di zona web-request: jalur request tidak boleh mencapai ingestion.
// Harus ditolak.
import { runIngestionJob } from '../../services/ingestion/pipeline.ts';

export const probe = runIngestionJob;
