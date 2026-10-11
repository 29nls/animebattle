#!/usr/bin/env node
/**
 * Apakah *mesin ini* dapat menghubungi database, dan bila tidak — mengapa?
 *
 *   npm run diagnose:db                       # membaca .env
 *   DATABASE_URL=... node scripts/diagnose-db-connection.mjs
 *
 * Kenapa ada: `GET /api/health/ready` benar menyembunyikan pesan driver dari
 * pemanggil anonim, tetapi itu membuat diagnosis insiden bergantung pada
 * reproduksi manual dari mesin operator. Skrip ini melakukan reproduksi itu
 * secara terkendali dan mencetak **kategori** kegagalannya (TLS? DNS? kredensial?
 * batas koneksi?), sehingga hasilnya dapat dibandingkan dengan `reason` di
 * `/api/health/ready` dan langkah di `docs/runbooks/incident.md`.
 *
 * Yang **tidak** pernah dicetak skrip ini: password, user lengkap, token, atau
 * connection string utuh. Host:port ditampilkan karena justru itu yang perlu
 * dibandingkan operator dengan dashboard Supabase (pooler vs direct).
 *
 * Batas yang jujur: sukses di sini berarti *mesin ini* dapat menghubungi
 * database. Ia tidak membuktikan Vercel dapat melakukannya — jaringan dan
 * environment deployment berbeda. Bandingkan hasilnya dengan `/api/health/ready`
 * di URL produksi.
 *
 * Keluar: 0 = `select 1` berhasil · 1 = koneksi gagal · 2 = DATABASE_URL tidak
 * ada · 3 = koneksi berhasil tetapi skema aplikasi tidak lengkap.
 */
import postgres from 'postgres';

import { resolveDatabaseSsl } from '../src/lib/db/client.ts';
import { summarizeDatabaseFailure } from '../src/lib/db/diagnostics.ts';

/** Tabel yang wajib ada agar aplikasi tidak menjawab 500 saat data diminta. */
const REQUIRED_TABLES = [
  'verses',
  'characters',
  'character_versions',
  'statistics',
  'character_abilities',
  'character_resistances',
  'character_sources',
  'sources',
  'ingestion_jobs',
  'ingestion_errors',
];

/** Langkah berikutnya per kategori — sejajar tabel triase di runbook insiden. */
const NEXT_STEPS = {
  not_configured: 'Setel DATABASE_URL di environment yang menjalankan proses ini.',
  tls_untrusted:
    'CA yang dipakai tidak memuat root server. Pada host Supabase, root bawaan seharusnya dipakai — periksa apakah host DATABASE_URL memang host Supabase/pooler, dan jangan pakai sslmode=require sebagai jalan pintas.',
  tls_expired: 'Sertifikat server kedaluwarsa/ belum berlaku — periksa status instance database.',
  tls_hostname_mismatch:
    'Nama host tidak cocok dengan sertifikat: DATABASE_URL menunjuk host/proxy yang salah.',
  dns: 'Host tidak dapat diresolusi: periksa ejaan host dan apakah project/instance masih ada.',
  refused:
    'Tidak ada yang menerima di host:port: port salah (pooler 6543/5432), project paused, atau IP allow-list menolak.',
  reset: 'Koneksi diputus di tengah jalan: biasanya pooler/instance tidak stabil — coba lagi dan periksa status instance.',
  timeout:
    'Tidak ada jawaban sebelum batas waktu: instance sibuk/paused, atau host hanya IPv6 dan runtime ini IPv4 (pakai connection string pooler).',
  unreachable:
    'Host tidak terjangkau dari runtime ini — kombinasi paling umum: koneksi *direct* IPv6 dari runtime IPv4 (serverless). Pakai connection string Transaction pooler.',
  auth: 'Kredensial ditolak: password/user di DATABASE_URL salah atau sudah dirotasi.',
  database_missing: 'Database pada URL tidak ada — periksa nama database di DATABASE_URL.',
  schema_missing:
    'Skema aplikasi belum diterapkan di database tujuan (atau URL menunjuk project lain): terapkan docs/schema.sql lalu docs/seed.sql.',
  connection_limit:
    'Batas koneksi tercapai: kurangi `max` koneksi per instance atau gunakan pooler.',
  server_unavailable: 'Server menutup koneksi/sedang memulihkan diri: coba lagi setelah beberapa detik.',
  connection_lost: 'Koneksi hilang setelah terbentuk — periksa log server database.',
  unclassified: 'Bukan kategori yang dikenal: baca pesan di atas dan log server database.',
};

const url = process.env.DATABASE_URL;
if (typeof url !== 'string' || url.trim() === '') {
  console.log('DATABASE_URL: TIDAK ADA di environment proses ini.');
  console.log('Langkah berikutnya:', NEXT_STEPS.not_configured);
  process.exit(2);
}

/** Ringkasan target tanpa kredensial: host, port, mode, dan asal CA. */
function describeTarget(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false };
  }
  const host = parsed.hostname;
  const user = parsed.username;
  return {
    ok: true,
    host: parsed.port ? `${host}:${parsed.port}` : host,
    database: parsed.pathname.replace(/^\//, '') || '(kosong)',
    user: user === '' ? '(tidak ada)' : `${user.slice(0, 1)}***`,
    sslmode: parsed.searchParams.get('sslmode') ?? '(tidak ditulis)',
    sslrootcert: parsed.searchParams.get('sslrootcert') ? 'ADA di URL' : 'tidak ada',
    isPooler: /(^|\.)pooler\./.test(host) || parsed.port === '6543',
    isSupabase: /(^|\.)supabase\.(co|com|in)$/.test(host.replace(/^[^.]+\./, '')),
  };
}

const target = describeTarget(url);
const resolution = resolveDatabaseSsl(url);

console.log('--- target (tanpa kredensial) ---');
if (!target.ok) {
  console.log('DATABASE_URL tidak dapat diurai sebagai URL.');
} else {
  console.log(`host            : ${target.host}`);
  console.log(`database        : ${target.database}`);
  console.log(`user            : ${target.user}`);
  console.log(`sslmode         : ${target.sslmode}`);
  console.log(`sslrootcert     : ${target.sslrootcert}`);
  console.log(`pooler          : ${target.isPooler ? 'ya' : 'TIDAK (koneksi direct?)'}`);
}
console.log(`CA yang dipakai : ${resolution.source}`);

const sql = postgres(url, {
  max: 1,
  connect_timeout: 10,
  ...resolution.options,
  onnotice: () => {},
});

let exitCode = 0;
try {
  const started = Date.now();
  const rows = await sql.unsafe('select 1 as ok');
  const elapsed = Date.now() - started;
  if (rows[0]?.ok !== 1) {
    console.log('\nRespons tak terduga dari `select 1`:', rows);
    exitCode = 3;
  } else {
    console.log(`\nselect 1        : OK (${elapsed} ms)`);
    const [version] = await sql.unsafe('select current_user as "user", version() as version');
    console.log(`server          : ${String(version.version).split(' on ')[0]}`);
    console.log(`user server     : ${version.user}`);
    console.log(`kategori        : (tidak ada kegagalan)`);

    const present = await sql.unsafe(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name = any($1::text[])`,
      [REQUIRED_TABLES],
    );
    const found = new Set(present.map((row) => row.table_name));
    const missing = REQUIRED_TABLES.filter((table) => !found.has(table));
    if (missing.length > 0) {
      console.log(`\nSKEMA BELUM LENGKAP — tabel hilang: ${missing.join(', ')}`);
      console.log('Langkah berikutnya:', NEXT_STEPS.schema_missing);
      exitCode = 3;
    } else {
      const [counts] = await sql.unsafe(
        'select (select count(*) from characters)::int as characters, (select count(*) from character_versions)::int as versions, (select count(*) from statistics)::int as statistics',
      );
      console.log(`baris           : ${counts.characters} karakter, ${counts.versions} form, ${counts.statistics} statistik`);
    }
  }
} catch (error) {
  const failure = summarizeDatabaseFailure(error);
  console.log('\n--- kegagalan koneksi ---');
  console.log(`kategori        : ${failure.category}`);
  console.log(`jenis error     : ${failure.name}`);
  if (failure.code !== undefined) console.log(`code            : ${failure.code}`);
  if (failure.errno !== undefined) console.log(`errno           : ${failure.errno}`);
  if (failure.syscall !== undefined) console.log(`syscall         : ${failure.syscall}`);
  if (failure.target !== undefined) console.log(`target          : ${failure.target}`);
  console.log(`pesan (bersih)  : ${failure.message}`);
  console.log(`\nLangkah berikutnya: ${NEXT_STEPS[failure.category] ?? NEXT_STEPS.unclassified}`);
  exitCode = 1;
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}

process.exit(exitCode);
