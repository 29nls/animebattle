import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Methodology',
  description: 'Metodologi dan cara kerja Anime VS Battle Engine.',
};

export default function MethodologyPage() {
  return (
    <div className="mx-auto max-w-3xl animate-fade-in pb-16 pt-8">
      <h1 className="text-3xl font-black text-ink-0 sm:text-5xl mb-6">
        Battle <span className="text-gradient-vs">Methodology</span>
      </h1>
      
      <div className="prose prose-invert prose-p:text-ink-2 prose-headings:text-ink-0 prose-a:text-accent-b max-w-none">
        <p className="lead text-lg text-ink-1">
          Anime VS Battle menggunakan <strong>Layered Battle Engine</strong> deterministik yang dirancang untuk menghilangkan bias manusia dalam perbandingan kekuatan karakter fiksi.
        </p>

        <h2 className="text-2xl font-bold mt-12 mb-4">1. Pendekatan Berbasis Lapisan (Layered Engine)</h2>
        <p>Pertarungan tidak diselesaikan dengan satu rumus angka. Engine mengevaluasi dalam beberapa lapisan:</p>
        <ul className="list-disc pl-5 space-y-2 mt-4 text-ink-2">
          <li><strong>Layer 0 (Eligibility):</strong> Verifikasi apakah kedua karakter memiliki data metrik yang cukup untuk diadu. Jika kurang, engine menolak simulasi.</li>
          <li><strong>Layer 1 (Dominance Gate):</strong> Memeriksa apakah satu pihak memiliki perbedaan statistik yang terlalu masif (mis. Multiverse vs Building level) dan tidak ada hax penyeimbang.</li>
          <li><strong>Layer 2 (Hax Evaluation):</strong> Menguji setiap kemampuan khusus (hax) terhadap daftar resistensi lawan untuk menemukan "Decisive Edge" (keunggulan mematikan).</li>
          <li><strong>Layer 3 (Weighted Scoring):</strong> Jika tidak ada kemenangan mutlak, engine melakukan normalisasi statistik yang tersisa dan menghitung fungsi logistik untuk menentukan probabilitas kemenangan.</li>
        </ul>

        <h2 className="text-2xl font-bold mt-12 mb-4">2. Hax Interaction Rules</h2>
        <p>Setiap kemampuan tidak hanya diukur berdasarkan ada/tidaknya, melainkan melalui <em>Hax Interaction Matrix</em>. Contoh:</p>
        <div className="rounded-xl border border-line bg-surface-1 p-4 my-4 font-mono text-xs overflow-x-auto">
          <code>{`// Jika A memiliki Mind Manipulation dan B memiliki Mind Resistance (Level: Moderate)
Result: Reduced Effectiveness (30% impact)

// Jika A memiliki Reality Warping dan B memiliki Acasuality (Type 4)
Result: Bypasses attack completely`}</code>
        </div>

        <h2 className="text-2xl font-bold mt-12 mb-4">3. Kualifikasi Klaim & Confidence</h2>
        <p>Tidak semua klaim dari sumber setara. Engine memberikan penalti "confidence" untuk statistik yang menggunakan kualifikasi lemah seperti "possibly" atau "likely", serta konflik sumber yang belum terpecahkan.</p>

        <h2 className="text-2xl font-bold mt-12 mb-4">4. Determinisme & Auditability</h2>
        <p>Tidak ada probabilitas acak (RNG). Input yang sama dengan versi rule set yang sama selalu menghasilkan <code>input_hash</code> dan hasil yang 100% identik. Setiap angka yang mempengaruhi hasil dilampirkan pada halaman hasil pertarungan.</p>
        
        <div className="mt-12 rounded-xl border border-line-strong bg-surface-2 p-6">
          <h3 className="font-bold text-ink-0">Legal Disclaimer</h3>
          <p className="mt-2 text-sm text-ink-2">
            Hasil engine ini murni analitis berdasarkan data yang dimasukkan oleh komunitas. Tidak ada hasil yang boleh dianggap sebagai "kanon resmi" dari pemegang hak cipta. Sistem ini adalah proyek eksperimen logika berskala besar.
          </p>
        </div>
      </div>
    </div>
  );
}
