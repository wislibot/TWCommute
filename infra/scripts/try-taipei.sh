#!/usr/bin/env bash
# Run TWCommute's backend for Greater Taipei on one Linux machine (8 GB of RAM is enough), so the
# Android app on a phone in the same Wi-Fi can use it. See docs/TRY_IT.md.
#
#   infra/scripts/try-taipei.sh            first run: download, build (20-30 min), then start
#   infra/scripts/try-taipei.sh start      start again (uses the data already built)
#   infra/scripts/try-taipei.sh stop       stop everything
#   infra/scripts/try-taipei.sh status     show what is running
#   infra/scripts/try-taipei.sh rebuild    download fresh timetables and rebuild, then start
#
# Needs Node 22+ with pnpm (corepack enable), osmium-tool, curl, and TDX_CLIENT_ID and
# TDX_CLIENT_SECRET in .env (or the environment). Java 25 and OpenTripPlanner are downloaded into data/tools/ when missing.
# Measured on the real data (docs/DATA.md): graph build 4 min at <= 4 GB; running stack ~3.4 GB.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

DATA_DIR="${DATA_DIR:-$ROOT/data}"
TOOLS="$DATA_DIR/tools"
RUN="$DATA_DIR/run"
OTP_DIR="$DATA_DIR/otp"
# Taipei, New Taipei, Keelung and Tamsui (minLon,minLat,maxLon,maxLat).
REGION_BBOX="${REGION_BBOX:-121.28,24.85,121.80,25.30}"
OTP_VERSION=2.10.0
OTP_JAR="${OTP_JAR:-$TOOLS/otp-shaded-$OTP_VERSION.jar}"
BUILD_HEAP="${BUILD_HEAP:-4g}"
SERVE_HEAP="${SERVE_HEAP:-3g}"
INGEST_PORT=8081
OTP_PORT=8080
API_PORT=3000

say() { printf '\n== %s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is not installed. $2"; }

java_major() { "$1" -version 2>&1 | grep -m1 'version "' | sed -E 's/.*version "([0-9]+).*/\1/'; }

find_java() {
  if [ -n "${JAVA:-}" ]; then return; fi
  if command -v java >/dev/null 2>&1 && [ "$(java_major java)" -ge 25 ] 2>/dev/null; then
    JAVA=java
  else
    JAVA="$TOOLS/jdk/bin/java"
  fi
}

check_prereqs() {
  need node "Install Node 22+ (e.g. with nvm: nvm install 22)."
  [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || die "Node 22+ is needed (found $(node -v))."
  need pnpm "Run: corepack enable"
  need curl "Install curl (sudo apt install curl)."
  if [ -f .env ]; then set -a; . ./.env; set +a; fi
  [ -n "${TDX_CLIENT_ID:-}" ] && [ -n "${TDX_CLIENT_SECRET:-}" ] ||
    die "TDX credentials missing. Run: cp .env.example .env, then fill in TDX_CLIENT_ID and TDX_CLIENT_SECRET."
  [ -d node_modules ] || { say "Installing packages"; pnpm install --frozen-lockfile; }
  find_java
}

download_tools() {
  mkdir -p "$TOOLS"
  if [ ! -f "$OTP_JAR" ]; then
    say "Downloading OpenTripPlanner $OTP_VERSION"
    curl -fL --retry 3 -o "$OTP_JAR.part" \
      "https://repo1.maven.org/maven2/org/opentripplanner/otp-shaded/$OTP_VERSION/otp-shaded-$OTP_VERSION.jar"
    mv "$OTP_JAR.part" "$OTP_JAR"
  fi
  if [ "$JAVA" = "$TOOLS/jdk/bin/java" ] && [ ! -x "$JAVA" ]; then
    say "Downloading Java 25 (Eclipse Temurin)"
    local arch
    case "$(uname -m)" in x86_64) arch=x64 ;; aarch64|arm64) arch=aarch64 ;; *) die "Unsupported CPU $(uname -m)." ;; esac
    curl -fL --retry 3 -o "$TOOLS/jdk.tar.gz" \
      "https://api.adoptium.net/v3/binary/latest/25/ga/linux/$arch/jdk/hotspot/normal/eclipse"
    rm -rf "$TOOLS/jdk" && mkdir -p "$TOOLS/jdk"
    tar -xzf "$TOOLS/jdk.tar.gz" -C "$TOOLS/jdk" --strip-components=1
    rm "$TOOLS/jdk.tar.gz"
  fi
}

build() {
  need osmium "Install it: sudo apt install osmium-tool"
  download_tools
  say "Downloading timetables (TDX) and maps (OpenStreetMap), Greater Taipei only"
  # prepare-otp keeps only trips serving the region (GTFS_BBOX); fetch-data clips the map (BBOX).
  DATA_DIR="$DATA_DIR" BBOX="$REGION_BBOX" GTFS_BBOX="$REGION_BBOX" OTP_INGEST_URL="http://localhost:$INGEST_PORT" \
    infra/scripts/fetch-data.sh
  say "Building the route graph (about 4 minutes)"
  rm -f "$OTP_DIR/graph.obj"
  OTP_DIR="$OTP_DIR" OTP_HEAP="$BUILD_HEAP" OTP_JAR="$OTP_JAR" JAVA="$JAVA" infra/scripts/otp-local.sh build \
    > "$RUN/build.log" 2>&1 || die "Graph build failed; see $RUN/build.log"
  [ -f "$OTP_DIR/graph.obj" ] || die "Graph build did not write $OTP_DIR/graph.obj; see $RUN/build.log"
}

# Start a command in its own process group, remembering the group so `stop` ends all of it.
launch() {
  local name=$1; shift
  setsid "$@" > "$RUN/$name.log" 2>&1 < /dev/null &
  echo $! > "$RUN/$name.pid"
}

wait_for() {
  local what=$1 seconds=$2; shift 2
  for _ in $(seq 1 "$seconds"); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  die "$what did not start within $seconds s; see the logs in $RUN/"
}

running() { [ -f "$RUN/$1.pid" ] && kill -0 "$(cat "$RUN/$1.pid")" 2>/dev/null; }

start() {
  [ -f "$OTP_DIR/graph.obj" ] || die "No route graph yet. Run: infra/scripts/try-taipei.sh"
  stop quiet
  say "Starting live data (ingest)"
  launch ingest env DATA_DIR="$DATA_DIR" GTFS_INDEX_PATH="$OTP_DIR/gtfs/tw.gtfs.zip" PORT="$INGEST_PORT" \
    PUBLIC_BASE_URL="http://localhost:$INGEST_PORT" pnpm --filter @twc/ingest start
  # OTP reads YouBike docks from ingest once at start-up and does not retry, so wait for them.
  wait_for "Ingest" 300 bash -c "curl -fs http://localhost:$INGEST_PORT/health | grep -q '\"feed\":\"bike-availability:Taipei\",\"lastSuccessAt\":\"2'"
  say "Starting routing (OpenTripPlanner, about 1 minute)"
  launch otp env OTP_DIR="$OTP_DIR" OTP_HEAP="$SERVE_HEAP" OTP_JAR="$OTP_JAR" JAVA="$JAVA" infra/scripts/otp-local.sh serve
  wait_for "OpenTripPlanner" 600 grep -q "Grizzly server running" "$RUN/otp.log"
  say "Starting the app's API"
  launch api env PORT="$API_PORT" OTP_URL="http://localhost:$OTP_PORT/otp/gtfs/v1" \
    INGEST_URL="http://localhost:$INGEST_PORT" pnpm --filter @twc/api start
  wait_for "API" 120 curl -fs "http://localhost:$API_PORT/v1/health"
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  say "Ready"
  echo "In the app: Settings -> Server, enter:  http://${ip:-THIS-COMPUTER-IP}:$API_PORT"
  echo "Phone and computer must be on the same Wi-Fi. Logs: $RUN/. Stop with: infra/scripts/try-taipei.sh stop"
}

stop() {
  local name
  for name in api otp ingest; do
    if running "$name"; then
      kill -TERM -- "-$(cat "$RUN/$name.pid")" 2>/dev/null || true
      [ "${1:-}" = quiet ] || echo "stopped $name"
    fi
    rm -f "$RUN/$name.pid"
  done
}

status() {
  local name
  for name in ingest otp api; do
    if running "$name"; then echo "$name: running"; else echo "$name: stopped"; fi
  done
}

mkdir -p "$RUN"
case "${1:-}" in
  "") check_prereqs; [ -f "$OTP_DIR/graph.obj" ] || build; start ;;
  start) check_prereqs; start ;;
  rebuild) check_prereqs; stop quiet; build; start ;;
  stop) stop ;;
  status) status ;;
  *) die "Unknown command '$1'. Use: start, stop, status or rebuild (or nothing for the first run)." ;;
esac
