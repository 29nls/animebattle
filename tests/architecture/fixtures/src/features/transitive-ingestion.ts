// Fixture: berkas ini sendiri bersih — yang melanggar adalah berkas yang
// diimpornya. Itulah cara AC-25 tetap terjaga pada rantai transitif: lint
// memeriksa setiap berkas, sehingga memindahkan pemanggilan satu tingkat lebih
// dalam tidak menyembunyikannya.
import { runPipelineFromRequest } from './helper-that-taints-the-graph.ts';

export const page = String(runPipelineFromRequest);
