import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Metodologi & Tentang',
  description:
    'Cara kerja Anime VS Battle: simulasi probabilistik deterministik, sumber data, confidence, keterbatasan, dan apa yang tidak diklaim oleh hasilnya.',
  // Mewarisi canonical '/' dari layout → audit Lighthouse `canonical` gagal
  // ("Points to the domain's root URL") — harus self-canonical (AC-22).
  alternates: { canonical: '/legal/methodology' },
};

const LAYERS = [
  {
    name: 'Layer 0 — Kelayakan',
    body: 'Memeriksa apakah kedua form punya metrik wajib yang cukup. Bila tidak, engine berhenti dengan insufficient_data, bukan menebak dari data yang hilang.',
  },
  {
    name: 'Layer 1 — Gerbang dominasi',
    body: 'Membandingkan selisih statistik yang ekstrem. Bila satu pihak berada jauh di atas pihak lain tanpa hax penyeimbang, hasilnya ditentukan di sini dan alasan itu ditulis eksplisit.',
  },
  {
    name: 'Layer 2 — Evaluasi hax',
    body: 'Setiap kemampuan diuji terhadap resistensi lawan memakai matriks interaksi. Resistensi tanpa bukti tidak boleh menghasilkan status blocked; statusnya diturunkan dan dicatat sebagai keterbatasan.',
  },
  {
    name: 'Layer 3 — Skor berbobot',
    body: 'Bila tidak ada kemenangan mutlak, metrik dinormalisasi, diberi bobot rule set, lalu diubah menjadi probabilitas lewat fungsi logistik. Angka ini adalah peluang model, bukan frekuensi kejadian nyata.',
  },
];

export default function MethodologyPage() {
  return (
    <div className="mx-auto max-w-3xl animate-fade-in pb-16 pt-8">
      <p className="text-xs font-bold uppercase tracking-widest text-ink-3">Tentang produk</p>
      <h1 className="mt-2 text-3xl font-black text-ink-0 sm:text-5xl">
        Metodologi &amp; <span className="text-gradient-vs">Keterbatasan</span>
      </h1>

      <div className="mt-6 space-y-6 text-sm leading-relaxed text-ink-2">
        <p className="text-base text-ink-1">
          Anime VS Battle membandingkan <strong>form</strong> karakter fiksi — bukan karakter secara
          umum — lalu menjalankan simulasi pertarungan yang deterministik. Hasilnya adalah{' '}
          <strong>simulasi probabilistik</strong>: perkiraan berbasis data dan aturan yang dapat
          diaudit, bukan putusan resmi, bukan klaim kanon, dan bukan ramalan.
        </p>

        <div className="rounded-2xl border border-accent-flag/30 bg-accent-flag/10 p-5 text-ink-1">
          <h2 className="text-base font-bold text-ink-0">Apa arti angka peluang menang?</h2>
          <p className="mt-2">
            Angka 70% berarti model memberi sisi tersebut keunggulan relatif sebesar itu{' '}
            <em>di bawah kondisi yang dipilih</em>. Angka itu bukan berarti pertarungan akan terjadi
            100 kali dan sisi tersebut menang 70 kali. Engine tidak memiliki data pertarungan nyata
            untuk mengkalibrasi frekuensi; ia mengubah skor ternormalisasi menjadi probabilitas
            logistik. Karena itu halaman hasil selalu menampilkan <strong>confidence</strong>,{' '}
            <strong>keterbatasan</strong>, <strong>asumsi</strong>, dan <strong>disclaimer</strong>.
          </p>
        </div>

        <section aria-labelledby="lapisan">
          <h2 id="lapisan" className="text-2xl font-bold text-ink-0">
            Lapisan evaluasi
          </h2>
          <ul className="mt-4 space-y-3">
            {LAYERS.map((layer) => (
              <li key={layer.name} className="rounded-xl border border-line bg-surface-1 p-4">
                <h3 className="font-bold text-ink-0">{layer.name}</h3>
                <p className="mt-1 text-ink-2">{layer.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="sumber">
          <h2 id="sumber" className="text-2xl font-bold text-ink-0">
            Sumber data dan lisensi
          </h2>
          <p className="mt-3">
            Setiap statistik, kemampuan, dan resistensi menyimpan <code className="text-accent-b">source_id</code>{' '}
            serta URL halaman sumbernya. Halaman karakter menampilkan tautan per baris dan panel
            jejak sumber; halaman daftar dan hasil pertarungan menampilkan ringkasan sumber serta
            lisensi. Data tidak diambil dari platform lain tanpa izin, dan tidak ada artwork
            berlisensi yang ditampilkan tanpa atribusi.
          </p>
          <p className="mt-2">
            Bila sebuah sumber mencabut izin atau meminta penghapusan, prosedurnya ada di{' '}
            <a href="/legal/takedown" className="text-accent-b underline underline-offset-2">
              halaman takedown
            </a>
            . Data yang diperbaiki akan mengubah hasil simulasi berikutnya — hasil lama yang sudah
            tersimpan diberi hash input sendiri dan tidak ditimpa diam-diam.
          </p>
          <p className="mt-2">
            Status lisensi per sumber, termasuk sumber yang masih <em>restricted</em>, ada di{' '}
            <a href="/legal/sources" className="text-accent-b underline underline-offset-2">
              halaman sumber &amp; lisensi
            </a>
            .
          </p>
        </section>

        <section aria-labelledby="batas">
          <h2 id="batas" className="text-2xl font-bold text-ink-0">
            Batas yang perlu dibaca
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <strong>Cakupan data tidak merata.</strong> Form tanpa metrik wajib akan menghasilkan{' '}
              <code className="text-accent-b">insufficient_data</code>; itu jawaban yang jujur, bukan
              bug.
            </li>
            <li>
              <strong>Kualifikasi sumber menurunkan keyakinan.</strong> Nilai “possibly”, “likely”,
              atau konflik sumber yang belum selesai membuat confidence turun.
            </li>
            <li>
              <strong>Kondisi mengubah hasil.</strong> Mode, medan, pengetahuan, persiapan, dan
              kecepatan yang disetarakan adalah bagian dari input. Permalink menyimpan kondisi
              non-default agar hasil yang dibagikan dapat direproduksi.
            </li>
            <li>
              <strong>Tidak ada RNG.</strong> Input dan rule set yang sama menghasilkan hash dan
              hasil yang sama. Perubahan rule set atau data akan mengubah hash — itu memang tujuannya.
            </li>
            <li>
              <strong>Bukan nasihat hukum atau komersial.</strong> Nama karakter dan karya adalah
              milik pemegang hak masing-masing.
            </li>
          </ul>
        </section>

        <section aria-labelledby="membaca">
          <h2 id="membaca" className="text-2xl font-bold text-ink-0">
            Cara membaca halaman hasil
          </h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5">
            <li>Lihat pemenang dan peluang menang — keduanya berasal dari satu simulasi yang sama.</li>
            <li>
              Periksa badge <strong>keyakinan</strong>. Di bawah ambang, hasil diberi peringatan
              karena asumsinya lebih besar.
            </li>
            <li>
              Baca <strong>rincian skor</strong> untuk melihat metrik mana yang menggerakkan hasil.
              Bar menunjukkan porsi relatif, bukan nilai mentah.
            </li>
            <li>
              Baca <strong>keunggulan penentu</strong>, lalu <strong>keterbatasan</strong> dan{' '}
              <strong>asumsi</strong>. Bagian itu menjelaskan apa yang tidak diketahui model.
            </li>
            <li>
              Gunakan <strong>permalink</strong> untuk membagikan matchup beserta kondisinya, dan
              buka <strong>jejak sumber</strong> bila ingin memeriksa angka aslinya.
            </li>
          </ol>
        </section>

        <div className="rounded-xl border border-line-strong bg-surface-2 p-6">
          <h2 className="font-bold text-ink-0">Disclaimer</h2>
          <p className="mt-2">
            Hasil engine sepenuhnya analitis berdasarkan data yang tersedia dan aturan yang
            dipublikasikan. Tidak ada hasil yang boleh dianggap sebagai kanon resmi pemegang hak
            cipta. Bila data atau aturan berubah, hasil dapat berubah — halaman hasil menyimpan
            versi engine, rule set, dan hash input supaya perubahan itu dapat ditelusuri.
          </p>
        </div>
      </div>
    </div>
  );
}
