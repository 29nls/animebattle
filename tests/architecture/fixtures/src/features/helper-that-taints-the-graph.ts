// Fixture: berkas ini melanggar; dipakai fixture berikutnya untuk menunjukkan
// bahwa pemanggilan ingestion tidak dapat disembunyikan satu tingkat lebih dalam.
import { runIngestionJob } from '@/services/ingestion/pipeline.ts';

export const runPipelineFromRequest = runIngestionJob;
