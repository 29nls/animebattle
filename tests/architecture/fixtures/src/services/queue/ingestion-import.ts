// Fixture: PELANGGARAN. Modul antrian dapat dicapai jalur request, jadi ia tidak
// boleh menarik ingestion — termasuk lewat jalur relatif.
import { runIngestionJob } from '../ingestion/pipeline.ts';

export const enqueueThenRun = runIngestionJob;
