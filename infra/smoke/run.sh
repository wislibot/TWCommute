#!/usr/bin/env bash
# End-to-end smoke test on a synthetic city: real OpenTripPlanner (jar) + our API + a fixture
# ingest server. No TDX or OSM download needed. Requires Java 25+ and the OTP 2.10 jar.
#   OTP_JAR=/opt/otp/otp-shaded-2.10.0.jar JAVA=/opt/jdk-25/bin/java infra/smoke/run.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
OUT="$ROOT/data/smoke/otp"
INGEST_PORT=8091
API_PORT=3998
OTP_URL="http://127.0.0.1:8080/otp/gtfs/v1"
LOG="$ROOT/data/smoke/logs"
mkdir -p "$LOG"
PIDS=()
# Each service runs in its own process group (setsid) so cleanup also stops npx/tsx/java children.
cleanup() { for p in "${PIDS[@]}"; do kill -TERM -- "-$p" 2>/dev/null || true; done; }
start() { setsid "$@" & PIDS+=($!); }
port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
trap cleanup EXIT

wait_for() { # url, method, seconds
  for _ in $(seq 1 "$3"); do
    if [ "$2" = POST ]; then curl -sf -o /dev/null -X POST -H 'content-type: application/json' -d '{"query":"{ feeds { feedId } }"}' "$1" && return 0
    else curl -sf -o /dev/null "$1" && return 0; fi
    sleep 1
  done
  echo "timed out waiting for $1"; return 1
}

for p in $INGEST_PORT $API_PORT 8080; do port_free "$p" || { echo "port $p is in use; stop the process first"; exit 1; }; done

echo "== fixture"
rm -rf "$OUT" && npx tsx infra/smoke/make-fixture.ts "$OUT" "http://127.0.0.1:$INGEST_PORT"
echo "== OTP build"
OTP_DIR="$OUT" OTP_HEAP=2g infra/scripts/otp-local.sh build > "$LOG/otp-build.log" 2>&1 || { tail -30 "$LOG/otp-build.log"; exit 1; }
echo "== start ingest fixture, OTP, API"
start bash -c "npx tsx infra/smoke/fixture-ingest.ts $INGEST_PORT > '$LOG/ingest.log' 2>&1"
wait_for "http://127.0.0.1:$INGEST_PORT/health" GET 30
start bash -c "OTP_DIR='$OUT' OTP_HEAP=2g infra/scripts/otp-local.sh serve > '$LOG/otp-serve.log' 2>&1"
wait_for "$OTP_URL" POST 120
sleep 5 # first GBFS poll
start bash -c "cd apps/api && PORT=$API_PORT OTP_URL='$OTP_URL' INGEST_URL=http://127.0.0.1:$INGEST_PORT npx tsx src/main.ts > '$LOG/api.log' 2>&1"
wait_for "http://127.0.0.1:$API_PORT/v1/tpass/passes" GET 30
echo "== checks"
npx tsx infra/smoke/check.ts "http://127.0.0.1:$API_PORT" "$OTP_URL"
