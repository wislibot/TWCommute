#!/usr/bin/env bash
# How much of the day each bus operator reports live times: samples the backend's live-prediction
# counts (ingest /health → busLive) and appends them to data/run/live-coverage.csv as
# "time,feed,live" rows. Run it on the server while the backend runs, e.g. for a full day:
#
#   nohup infra/scripts/live-coverage.sh 24 10 >/dev/null 2>&1 &
#   (hours to run, minutes between samples; defaults 24 and 10)
#
# "live" counts stop/route pairs with a predicted arrival. 0 in the daytime means that operator's
# buses are not running or not reporting (the app then warns that buses may not run).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/data/run/live-coverage.csv"
hours="${1:-24}"
every="${2:-10}"
mkdir -p "$(dirname "$OUT")"
[ -s "$OUT" ] || echo "time,feed,live" > "$OUT"
end=$(($(date +%s) + hours * 3600))
while [ "$(date +%s)" -lt "$end" ]; do
  node -e '
    fetch("http://127.0.0.1:8081/health", { signal: AbortSignal.timeout(5000) })
      .then((r) => r.json())
      .then((b) => {
        const now = new Date().toISOString();
        for (const [feed, live] of Object.entries(b.busLive ?? {})) console.log(`${now},${feed},${live}`);
      })
      .catch(() => {})' >> "$OUT"
  sleep $((every * 60))
done
