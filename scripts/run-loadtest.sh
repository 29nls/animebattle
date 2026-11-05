#!/usr/bin/env bash
# Jalankan uji beban lokal: Postgres embedded + next start + tiga skrip k6.
# Prasyarat: `npm run build` sudah hijau, `.tools/k6.../k6.exe` tersedia, dan
# `embedded-postgres` terpasang lokal (lihat tests/load/README.md).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
K6="${K6:-$ROOT/.tools/k6-v2.3.0-windows-amd64/k6.exe}"
[ -x "$K6" ] || { echo "k6 tidak ditemukan: $K6" >&2; exit 2; }
[ -f .next/BUILD_ID ] || { echo "jalankan npm run build lebih dulu" >&2; exit 2; }

rm -f .loadtest-env.json .loadtest-db.log .loadtest-server.log
node scripts/loadtest-db.mjs > .loadtest-db.log 2>&1 &
DB_PID=$!
SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  kill "$DB_PID" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 90); do
  grep -q '^READY ' .loadtest-db.log 2>/dev/null && break
  if ! kill -0 "$DB_PID" 2>/dev/null; then
    cat .loadtest-db.log >&2
    exit 1
  fi
  sleep 1
done
grep -q '^READY ' .loadtest-db.log || { cat .loadtest-db.log >&2; exit 1; }

DB_URL="$(grep '^READY ' .loadtest-db.log | awk '{print $2}')"
VERSION_A="$(node -p "require('./.loadtest-env.json').version_a")"
VERSION_B="$(node -p "require('./.loadtest-env.json').version_b")"
VERSUS_PATH="$(node -p "require('./.loadtest-env.json').versus_path")"
BASE_URL="http://127.0.0.1:3315"

DATABASE_URL="$DB_URL" NEXT_PUBLIC_SITE_URL="$BASE_URL" node_modules/.bin/next start -p 3315 \
  > .loadtest-server.log 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 60); do
  if curl -fsS "$BASE_URL/api/health" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then cat .loadtest-server.log >&2; exit 1; fi
  sleep 1
done
curl -fsS "$BASE_URL/api/health" >/dev/null || { cat .loadtest-server.log >&2; exit 1; }

echo "DB: $DB_URL"
echo "VERSUS: $VERSUS_PATH"
export MSYS_NO_PATHCONV=1
"$K6" run --summary-export .loadtest-search.json \
  -e BASE_URL="$BASE_URL" tests/load/search.js
"$K6" run --summary-export .loadtest-battle.json \
  -e BASE_URL="$BASE_URL" -e VERSION_A="$VERSION_A" -e VERSION_B="$VERSION_B" \
  tests/load/battle.js
"$K6" run --summary-export .loadtest-versus.json \
  -e BASE_URL="$BASE_URL" -e VERSUS_PATH="$VERSUS_PATH" tests/load/versus.js

echo "Ringkasan JSON: .loadtest-search.json .loadtest-battle.json .loadtest-versus.json"
