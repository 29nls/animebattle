# Load test k6

Tiga skenario: `/api/search`, `/api/battle/simulate`, dan
`/versus/[karakter/form]-vs-[karakter/form]`.

## Prasyarat lokal (Windows)

```bash
# k6 resmi, tidak di-commit
mkdir -p .tools
curl -sSL -o .tools/k6.zip \
  https://github.com/grafana/k6/releases/download/v2.3.0/k6-v2.3.0-windows-amd64.zip
unzip -oq .tools/k6.zip -d .tools

# Postgres embedded hanya untuk harness lokal
npm install --no-save --package-lock=false \
  embedded-postgres@16.15.0-beta.19 @embedded-postgres/windows-x64@16.15.0-beta.19
```

`scripts/loadtest-db.mjs` menerapkan skema + seed + dataset One-Punch Man lewat
`applyDataset` produksi, lalu menulis `.loadtest-env.json`. `scripts/run-loadtest.sh`
menjalankan Postgres, `next start`, dan ketiga skrip, lalu menulis
`.loadtest-{search,battle,versus}.json`.

```bash
npm run build
bash scripts/run-loadtest.sh
```

Angka p50/p95 diambil dari `--summary-export`, bukan dari perkiraan. Hasil yang
dilaporkan ada di `docs/benchmarks/load-2026-11-05.md`; database embedded adalah
Postgres asli tetapi berjalan di mesin yang sama, jadi angka ini **bukan**
prediksi latency Supabase/Vercel (jaringan dan connection pool berbeda).
