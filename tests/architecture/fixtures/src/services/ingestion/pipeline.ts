// Fixture: modul ingestion. Zona ini MEMANG boleh diimpor dari worker, jadi
// berkas ini diharapkan bersih — probe di direktori lain yang membuktikan
// batasnya menggigit.
export const runIngestionJob = (job: { job_id: string }): Promise<void> =>
  Promise.resolve(void job);
