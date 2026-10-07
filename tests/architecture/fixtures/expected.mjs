/**
 * Harapan per fixture: berkas → rule id yang HARUS dilaporkan, beserta jumlahnya.
 *
 * Ditulis sebagai data, bukan `assert` yang tersebar, supaya pemeriksa dapat
 * membandingkan secara eksak dua arah: pelanggaran yang **kurang** (aturan tidak
 * menggigit) dan pelanggaran yang **berlebih** (aturan salah menuduh) sama-sama
 * menggagalkan pemeriksaan. Berkas fixture di disk yang tidak terdaftar di sini
 * juga menggagalkan pemeriksaan tersendiri — fixture tanpa harapan tidak menguji
 * apa pun.
 *
 * Susunan direktori fixture meniru susunan nyata (`app/`, `src/`, `worker/`)
 * karena pola zona asli dipakai apa adanya setelah diawali
 * `tests/architecture/fixtures/`.
 */

export const EXPECTED = {
  // --- zona engine: hanya perhitungan murni ---------------------------------
  'tests/architecture/fixtures/src/services/battle/io-and-nondeterminism.ts': {
    // 3 impor terlarang (node:fs, node:path, @/lib/db/client.ts)
    // + 1 anggota modul tak diizinkan (randomUUID, sementara createHash boleh)
    // + 3 global (Date, console, process) + 1 anggota (Math.random)
    'architecture/engine-purity': 8,
  },
  'tests/architecture/fixtures/src/services/battle/clean-pure.ts': {},
  'tests/architecture/fixtures/src/services/battle/types.ts': {},
  'tests/architecture/fixtures/src/services/battle/metrics.ts': {},
  'tests/architecture/fixtures/src/services/battle/probes/probe-ingestion.ts': {
    'architecture/engine-purity': 1,
  },

  // --- zona node-runtime: bukan engine, tetap tidak boleh menarik ingestion --
  'tests/architecture/fixtures/src/services/queue/ingestion-import.ts': {
    'architecture/boundary-import': 1,
  },
  'tests/architecture/fixtures/src/services/queue/probes/probe-ingestion.ts': {
    'architecture/boundary-import': 1,
  },
  'tests/architecture/fixtures/src/lib/alias-import.ts': {
    'architecture/boundary-import': 1,
  },

  // --- zona worker: SATU-SATUNYA tempat ingestion dijalankan -----------------
  'tests/architecture/fixtures/src/services/ingestion/pipeline.ts': {},
  'tests/architecture/fixtures/worker/probes/probe-ingestion.ts': {},

  // --- zona endpoint terjadwal: sah mengerjakan antrian ----------------------
  'tests/architecture/fixtures/app/api/cron/probes/probe-ingestion.ts': {},

  // --- zona jalur request: ingestion terlarang (AC-25) -----------------------
  'tests/architecture/fixtures/app/page.tsx': {},
  'tests/architecture/fixtures/src/features/ingestion-import.ts': {
    'architecture/boundary-import': 1,
  },
  'tests/architecture/fixtures/src/features/probes/probe-ingestion.ts': {
    'architecture/boundary-import': 1,
  },
  'tests/architecture/fixtures/src/features/helper-that-taints-the-graph.ts': {
    'architecture/boundary-import': 1,
  },
  'tests/architecture/fixtures/src/features/transitive-ingestion.ts': {},
  'tests/architecture/fixtures/src/features/clean-enqueue.ts': {},

  // --- aturan select * (lintas zona) ----------------------------------------
  'tests/architecture/fixtures/select-star/raw-sql.ts': {
    'architecture/no-select-star': 3,
  },
  'tests/architecture/fixtures/select-star/builder-chain.ts': {
    'architecture/no-select-star': 3,
  },
  'tests/architecture/fixtures/select-star/unverifiable.ts': {
    'architecture/no-select-star': 1,
  },
  'tests/architecture/fixtures/select-star/indirect-constant.ts': {
    'architecture/no-select-star': 3,
  },
  'tests/architecture/fixtures/select-star/clean-columns.ts': {},
};

/**
 * Matriks AC-25: hasil yang harus muncul saat satu berkas yang sama secara
 * semantik (`probes/probe-ingestion.ts`) dilinting di dalam setiap zona.
 *
 * Yang dibuktikan adalah **efeknya** — zona mana yang benar-benar dapat mencapai
 * ingestion — bukan cara aturannya ditulis. Kalau larangannya suatu saat
 * diganti dari `deny` menjadi mekanisme lain, matriks ini tetap benar selama
 * efeknya tidak berubah.
 *
 * Semua probe memakai impor **relatif** karena bentuk itu sah di setiap zona
 * (engine membolehkan relatif selama tidak keluar zonanya; zona Node mewajibkan
 * relatif). Dengan begitu perbandingan antar zona benar-benar mengukur
 * keterjangkauan ingestion, bukan kebijakan gaya impor alias.
 */
export const INGESTION_ZONE_MATRIX = {
  'tests/architecture/fixtures/src/services/battle/probes/probe-ingestion.ts': 'blocked',
  'tests/architecture/fixtures/src/services/queue/probes/probe-ingestion.ts': 'blocked',
  'tests/architecture/fixtures/src/features/probes/probe-ingestion.ts': 'blocked',
  'tests/architecture/fixtures/worker/probes/probe-ingestion.ts': 'allowed',
  'tests/architecture/fixtures/app/api/cron/probes/probe-ingestion.ts': 'allowed',
};
