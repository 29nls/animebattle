// Probe AC-25 di zona node-runtime: modul antrian dapat dicapai jalur request,
// jadi ia tidak boleh menarik ingestion. Harus ditolak.
import { runIngestionJob } from '../../ingestion/pipeline.ts';

export const probe = runIngestionJob;
