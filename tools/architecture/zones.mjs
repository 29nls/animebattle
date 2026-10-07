/**
 * Zona arsitektur — satu-satunya tempat aturan batas didefinisikan.
 *
 * `eslint.config.mjs` membangun konfigurasi dari berkas ini, dan
 * `scripts/check-architecture.mjs` memverifikasi bahwa zona-zona ini menutupi
 * setiap berkas di repo tepat satu kali. Konsekuensinya: menambah direktori baru
 * tidak bisa "lolos diam-diam" dari aturan batas — berkas baru tanpa zona akan
 * menggagalkan pemeriksaan, bukan diabaikan.
 *
 * Aturan yang ditegakkan berasal dari PRD §39 ("Aturan arsitektur yang ditegakkan
 * tooling") dan acceptance criteria terkait.
 */

/** Zona tempat modul hanya boleh berisi perhitungan murni. */
const ENGINE_PURITY = {
  /** Modul Node/browser yang boleh dipakai: hanya yang murni dan allow-list-nya eksplisit. */
  allowedNodeModules: {
    // `createHash` deterministik: input sama → hash sama. Itu sebabnya ia boleh,
    // sedangkan `randomUUID`/`randomBytes` tidak (lihat denyMembers).
    'node:crypto': ['createHash'],
  },
  /**
   * Nilai global yang dilarang di dalam engine. Semuanya punya satu sifat yang
   * sama: membuat hasil bergantung pada sesuatu di luar argumen fungsi — waktu,
   * lingkungan, jaringan, atau keluaran terminal.
   */
  denyGlobals: [
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'process',
    'console',
    'setTimeout',
    'setInterval',
    'setImmediate',
    'queueMicrotask',
    'performance',
    'Date',
    'localStorage',
    'sessionStorage',
    'navigator',
    'crypto',
  ],
  /**
   * Anggota objek yang dilarang. Dipisah dari `denyGlobals` karena melarang
   * seluruh `Math` akan menghukum `Math.max`, yang murni.
   */
  denyMembers: ['Math.random', 'JSON.parse', 'globalThis.process', 'globalThis.fetch'],
};

export const ZONES = [
  {
    name: 'engine',
    label: 'Battle engine (murni)',
    reason:
      'PRD §39 — engine bebas I/O. Kesucian ini yang membuat hasil dapat direproduksi dari input_hash saja, dan membuat 39 kasus uji bisa dijalankan tanpa database.',
    files: ['src/services/battle/**/*.ts'],
    // Akar zona: impor relatif hanya sah selama tetap berada di dalam direktori
    // ini. Tanpa batas ini, `../ingestion/pipeline.ts` dari dalam engine akan
    // dianggap "impor relatif" yang aman — dan engine diam-diam dapat memuat
    // fetcher, parser, serta seluruh beban ingestion ke dalam graf impornya.
    root: 'src/services/battle',
    relativeImportsOnly: false,
    purity: ENGINE_PURITY,
  },
  {
    name: 'node-runtime',
    label: 'Modul Node yang tetap dapat dicapai jalur request (lib, queue)',
    reason:
      'Dimuat Node dengan type stripping, sehingga alias `@/` tidak dikenali dan ekstensi `.ts` wajib eksplisit. Selain itu modul ini diimpor route, jadi ia tidak boleh menarik ingestion ke dalam graf impornya.',
    files: ['src/lib/**/*.ts', 'src/services/queue/**/*.ts'],
    relativeImportsOnly: true,
    deny: [
      {
        // Inti aturannya: begitu ingestion dapat dicapai dari modul yang dipakai
        // route, AC-25 batal tanpa perlu satu baris pun di route berubah.
        pattern: 'services/ingestion',
        reason:
          'Modul ini diimpor jalur request; menarik ingestion ke dalamnya membuat ingestion dapat dicapai dari request (AC-25).',
        prd: 'AC-25',
      },
    ],
  },
  {
    name: 'ingestion-worker',
    label: 'Worker ingestion (proses terpisah)',
    reason:
      'Tempat sah menjalankan ingestion: proses terpisah dari web (PRD §37.2), sehingga pekerjaan lambat tidak menahan respons pengguna. Karena itu zona ini justru HARUS dapat mengimpor ingestion.',
    files: ['worker/**/*.ts', 'src/services/ingestion/**/*.ts'],
    relativeImportsOnly: true,
  },
  {
    name: 'web-request',
    label: 'Jalur request pengguna (route, page, komponen, features)',
    reason:
      'PRD §18.1 & AC-25 — ingestion tidak pernah berjalan di jalur request pengguna. Route hanya boleh menulis baris antrian.',
    files: [
      'app/**/*.{ts,tsx}',
      'src/features/**/*.{ts,tsx}',
      'src/components/**/*.{ts,tsx}',
    ],
    // Endpoint cron dipicu penjadwal, bukan pengguna, dan memang tempat sah
    // menjalankan pekerjaan berat. Pengecualiannya selebar satu pola ini dan
    // lebarnya diverifikasi `scripts/check-architecture.mjs`.
    ignores: ['app/api/cron/**'],
    relativeImportsOnly: false,
    deny: [
      {
        pattern: 'services/ingestion',
        reason:
          'Ingestion tidak boleh berjalan di jalur request pengguna: pekerjaan berat akan menahan respons sampai timeout, kehilangan hasil, dan menyembunyikan status dari admin. Jalur request hanya menulis baris antrian (lihat services/queue/ingestion-jobs.ts).',
        prd: 'AC-25',
      },
    ],
  },
  {
    name: 'scheduled-worker',
    label: 'Endpoint terjadwal (cron)',
    reason:
      'Satu-satunya jalur request yang boleh mengerjakan antrian ingestion; dipicu penjadwal platform, bukan pengguna (PRD §39: cron/ingest-worker).',
    files: ['app/api/cron/**/*.ts'],
    relativeImportsOnly: false,
  },
];

/**
 * Pengecualian terhadap larangan ingestion. Dipakai `check-architecture.mjs`
 * untuk memastikan daftarnya tidak melebar tanpa keputusan sadar.
 */
export const INGESTION_ALLOWED_FILES = [
  'src/services/ingestion/**',
  'worker/**',
  'app/api/cron/**',
];

import { matchesZone } from './glob.mjs';

/** Zona yang berlaku untuk sebuah jalur, atau `undefined` bila tidak ada. */
export function zoneFor(path) {
  return ZONES.find((zone) => matchesZone(path, zone));
}
