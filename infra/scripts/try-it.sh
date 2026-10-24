#!/usr/bin/env bash
# Run TWCommute's backend for one region, Hsinchu or Greater Taipei, on one Linux machine, so the
# Android app on a phone in the same Wi-Fi can use it. See docs/TRY_IT.md.
#
#   infra/scripts/try-it.sh hsinchu    make Hsinchu the active region: build it the first time, then start
#   infra/scripts/try-it.sh taipei     the same for Greater Taipei
#   infra/scripts/try-it.sh            start the active region (builds it if its graph is missing)
#   infra/scripts/try-it.sh start      start the active region again (uses the data already built)
#   infra/scripts/try-it.sh stop       stop everything
#   infra/scripts/try-it.sh status     show the region, what is running and how fresh the live data is
#   infra/scripts/try-it.sh rebuild    download fresh timetables, rebuild the active region, then start
#   infra/scripts/try-it.sh autostart  start the active region again after every reboot (`autostart off` to stop)
#
# Downloads are shared (data/gtfs, data/osm, data/tools) and each region builds into data/otp-<region>,
# so switching back to a built region only restarts the services. data/run holds the logs, the pid
# files and the active region.
# Needs Node 22+ with pnpm (corepack enable), osmium-tool, curl, and TDX_CLIENT_ID and
# TDX_CLIENT_SECRET in .env (or the environment). Java 25 and OpenTripPlanner are downloaded into data/tools/ when missing.
# Measured on the real data (docs/DATA.md): Hsinchu builds its graph in ~1 min at 1.6 GB and runs in
# ~1.2 GB; Greater Taipei builds in ~5 min at <= 4 GB and runs in ~3.5 GB. BUILD_HEAP and SERVE_HEAP
# (e.g. 3g) override a region's Java heaps.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
# Without this, corepack stops to ask before it downloads pnpm.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# .env (TDX key; see .env.example) fills in only what is not already set in the environment.
if [ -f .env ]; then
  caller="$(export -p | grep -v '^declare -[a-z]*r')" # read-only ones cannot be re-declared
  set -a
  . ./.env
  set +a
  eval "$caller"
fi

DATA_DIR="${DATA_DIR:-$ROOT/data}"
# pnpm runs the services and prepare-otp from their package folders, so paths must be absolute.
case "$DATA_DIR" in /*) ;; *) DATA_DIR="$ROOT/$DATA_DIR" ;; esac
TOOLS="$DATA_DIR/tools"
RUN="$DATA_DIR/run"
OTP_VERSION=2.10.0
OTP_JAR="${OTP_JAR:-$TOOLS/otp-shaded-$OTP_VERSION.jar}"
INGEST_PORT=8081
OTP_PORT=8080
API_PORT=3000
# Ingest and OpenTripPlanner listen on this computer only; the phone talks to the API. API_HOST=127.0.0.1
# keeps the API on this computer too, for a server reached through an SSH tunnel (docs/TRY_IT.md).
INGEST_LOCAL_URL="http://127.0.0.1:$INGEST_PORT"
API_HOST="${API_HOST:-0.0.0.0}"
SELF=infra/scripts/try-it.sh

say() { printf '\n== %s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is not installed. $2"; }

usage() {
  cat >&2 <<EOF
Choose a region: $SELF hsinchu  (or taipei)
Then, for the active region: $SELF start | stop | status | rebuild | autostart [on|off]
EOF
  exit 1
}

# Region presets. The box (minLon,minLat,maxLon,maxLat) trims the timetables and clips the map. The
# polling settings fit the free TDX plan (5 requests/minute).
preset() {
  case "$1" in
    taipei)
      # Taipei, New Taipei, Keelung and Tamsui.
      REGION_NAME="Greater Taipei" REGION_BBOX=121.28,24.85,121.80,25.30
      BUS_CITIES=Taipei BIKE_CITIES=Taipei BUS_INTERCITY=false BUS_INTERCITY_ROUTES=""
      BIKE_AVAILABILITY_INTERVAL_S=120 PRESET_BUILD_HEAP=4g PRESET_SERVE_HEAP=3g
      ;;
    hsinchu)
      # Hsinchu City, Zhubei and HSR Hsinchu, Baoshan and the Science Park, Zhudong, Zhunan. Intercity
      # (公路客運) routes also serve the area; "auto" polls ETAs only for the ~40 in the trimmed timetable.
      REGION_NAME=Hsinchu REGION_BBOX=120.85,24.67,121.11,24.885
      BUS_CITIES=Hsinchu,HsinchuCounty BIKE_CITIES=Hsinchu,HsinchuCounty BUS_INTERCITY=true BUS_INTERCITY_ROUTES=auto
      # YouBike availability for two cities every 3 minutes keeps all polling at ~4.2 of the 5 requests/minute.
      BIKE_AVAILABILITY_INTERVAL_S=180 PRESET_BUILD_HEAP=3g PRESET_SERVE_HEAP=2g
      ;;
    *) return 1 ;;
  esac
}

# The region chosen last (data/run/region), or nothing.
active_region() {
  local region
  region="$(cat "$RUN/region" 2>/dev/null || true)"
  if preset "$region"; then echo "$region"; fi
}

# Load a region's preset; it builds into its own OTP folder.
use_region() {
  REGION=$1
  preset "$REGION" || die "Unknown region '$REGION'."
  OTP_DIR="$DATA_DIR/otp-$REGION"
  BUILT="$OTP_DIR/built"
  BUILD_HEAP="${BUILD_HEAP:-$PRESET_BUILD_HEAP}"
  SERVE_HEAP="${SERVE_HEAP:-$PRESET_SERVE_HEAP}"
}

# Make a region the active one, which start, stop, status and rebuild then act on.
select_region() {
  local previous
  previous="$(active_region)"
  use_region "$1"
  if [ -n "$previous" ] && [ "$previous" != "$1" ]; then say "Switching from $previous to $1"; fi
  echo "$1" > "$RUN/region"
}

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
  [ -n "${TDX_CLIENT_ID:-}" ] && [ -n "${TDX_CLIENT_SECRET:-}" ] ||
    die "TDX credentials missing. Run: cp .env.example .env, then fill in TDX_CLIENT_ID and TDX_CLIENT_SECRET."
  # Install again when the lockfile changed since the last install (e.g. after git pull).
  if [ ! -f node_modules/.modules.yaml ] || [ pnpm-lock.yaml -nt node_modules/.modules.yaml ]; then
    say "Installing packages"
    pnpm install --frozen-lockfile
    touch node_modules/.modules.yaml
  fi
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

# A Java heap size (3g, 3072m) in MB.
heap_mb() {
  [[ $1 =~ ^([0-9]+)([gGmM]?)$ ]] || die "Heap size '$1' should look like 3g or 3072m."
  case "${BASH_REMATCH[2]}" in
    [gG]) echo $((10#${BASH_REMATCH[1]} * 1024)) ;;
    [mM]) echo $((10#${BASH_REMATCH[1]})) ;;
    *) echo $((10#${BASH_REMATCH[1]} / 1048576)) ;;
  esac
}

# The build needs its heap plus about 1 GB for Java itself and the system.
check_memory() {
  local heap avail
  heap="$(heap_mb "$BUILD_HEAP")"
  avail="$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo 2>/dev/null || true)"
  if [ -n "$avail" ] && [ "$avail" -lt $((heap + 1024)) ]; then
    printf '\nWarning: only %s MB of memory is available, and building %s needs about %s MB (BUILD_HEAP=%s + 1 GB).\n' \
      "$avail" "$REGION_NAME" $((heap + 1024)) "$BUILD_HEAP"
    echo "Close other programs (e.g. the web browser), or the build may fail with OutOfMemoryError or make the computer very slow."
  fi
}

# Build the active region's graph. With `fresh`, download new timetables and maps; otherwise reuse
# the downloads of earlier builds (of any region) and fetch only what is missing.
build() {
  need osmium "Install it: sudo apt install osmium-tool"
  stop quiet
  check_memory
  download_tools
  local skip=1
  if [ "${1:-}" = fresh ]; then skip=; fi
  # Not built until this build finishes (fetch-data rewrites the timetables the old graph matches).
  rm -f "$BUILT"
  if [ -n "$skip" ] && [ -f "$DATA_DIR/gtfs/manifest.json" ] && [ -f "$DATA_DIR/osm/taiwan.osm.pbf" ]; then
    say "Trimming the downloaded timetables and map to $REGION_NAME ('rebuild' downloads fresh ones)"
  else
    say "Downloading timetables (TDX) and maps (OpenStreetMap), $REGION_NAME only"
  fi
  # prepare-otp keeps only trips serving the region (GTFS_BBOX); fetch-data clips the map (BBOX).
  DATA_DIR="$DATA_DIR" OTP_DIR="$OTP_DIR" BBOX="$REGION_BBOX" GTFS_BBOX="$REGION_BBOX" \
    OTP_INGEST_URL="$INGEST_LOCAL_URL" SKIP_DOWNLOAD="$skip" QUIET_NEXT=1 infra/scripts/fetch-data.sh
  say "Building the route graph for $REGION_NAME (a few minutes)"
  rm -f "$OTP_DIR/graph.obj"
  OTP_DIR="$OTP_DIR" OTP_HEAP="$BUILD_HEAP" OTP_JAR="$OTP_JAR" JAVA="$JAVA" infra/scripts/otp-local.sh build \
    > "$RUN/build.log" 2>&1 || die "Graph build failed; see $RUN/build.log"
  [ -f "$OTP_DIR/graph.obj" ] || die "Graph build did not write $OTP_DIR/graph.obj; see $RUN/build.log"
  echo "$REGION_BBOX $(date -u +%FT%TZ)" > "$BUILT"
}

boot_id() { cat /proc/sys/kernel/random/boot_id 2>/dev/null || true; }

# Start a command in its own process group, remembering the group so `stop` ends all of it. The pid
# file keeps the boot id too: after a reboot the same pid can belong to another program.
launch() {
  local name=$1; shift
  setsid "$@" > "$RUN/$name.log" 2>&1 < /dev/null &
  echo "$! $(boot_id)" > "$RUN/$name.pid"
}

# Print the process group of a service started since the last boot, if it is still running.
pid_of() {
  local pid boot
  [ -f "$RUN/$1.pid" ] || return 1
  read -r pid boot < "$RUN/$1.pid" || true
  if [ -z "$boot" ]; then
    # Written by try-taipei.sh, which kept no boot id: trust it only for a process that looks like ours.
    grep -qaE 'pnpm|otp' "/proc/$pid/cmdline" 2>/dev/null || return 1
  elif [ "$boot" != "$(boot_id)" ]; then
    return 1
  fi
  kill -0 "$pid" 2>/dev/null && echo "$pid"
}

running() { pid_of "$1" >/dev/null; }

# Stop what was started, then exit with an error.
fail() {
  stop quiet
  die "$@"
}

# Wait until a check passes, giving up early when the service has exited or the check exits with 2
# (it cannot succeed; its output says why).
wait_for() {
  local name=$1 what=$2 seconds=$3 out rc; shift 3
  for _ in $(seq 1 "$seconds"); do
    if out="$("$@" 2>&1)"; then return 0; else rc=$?; fi
    [ "$rc" -ne 2 ] || fail "$what cannot start: $out"
    running "$name" || fail "$what stopped; see $RUN/$name.log"
    sleep 1
  done
  fail "$what did not start within $seconds s; see $RUN/$name.log"
}

# Ingest is ready once it lists its feeds and every YouBike feed (docks and availability) has loaded;
# a region without YouBike passes at once. Exits 2 when TDX rejects the key: no feed has loaded and
# one reports an auth error.
ingest_ready() {
  # shellcheck disable=SC2016 # ${...} below is JavaScript.
  node -e '
    fetch(process.argv[1], { signal: AbortSignal.timeout(5000) })
      .then((r) => r.json())
      .then((b) => {
        const auth = b.feeds.find((f) => /TDX auth failed/.test(f.lastError ?? ""));
        if (auth && !b.feeds.some((f) => f.lastSuccessAt)) {
          console.log(`TDX rejected the key (${auth.lastError}). Check TDX_CLIENT_ID and TDX_CLIENT_SECRET in .env.`);
          process.exit(2);
        }
        process.exit(b.feeds.length > 0 && b.feeds.every((f) => !f.feed.startsWith("bike-") || f.lastSuccessAt) ? 0 : 1);
      })
      .catch(() => process.exit(1))' "$INGEST_LOCAL_URL/health"
}

# This computer's address on the home network: the source of its default route, unless that goes
# through a VPN tunnel the phone cannot reach; else the first private IPv4 address that is not
# Docker's bridge (or any other address when there is no private one).
phone_ip() {
  local route addr=
  route="$(ip -4 route get 1.1.1.1 2>/dev/null || true)"
  if ! [[ $route =~ dev\ (wg|tun|tap|tailscale|zt|ppp) ]]; then
    addr="$(sed -n 's/.* src \([0-9.]*\).*/\1/p' <<< "$route")"
  fi
  local all
  all="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$' | grep -vE '^(127\.|172\.17\.)' || true)"
  [ -n "$addr" ] || addr="$(grep -m1 -E '^(192\.168|10|172\.(1[6-9]|2[0-9]|3[01]))\.' <<< "$all" || true)"
  [ -n "$addr" ] || addr="$(head -n1 <<< "$all")"
  echo "$addr"
}

start() {
  [ -f "$BUILT" ] || die "No route graph for $REGION_NAME yet. Run: $SELF $REGION"
  stop quiet
  say "Starting live data for $REGION_NAME (ingest; waits for the YouBike docks, a few minutes)"
  # Every polling setting is passed, so the Taipei ones in .env (from .env.example) cannot override the region's.
  launch ingest env DATA_DIR="$DATA_DIR" GTFS_INDEX_PATH="$OTP_DIR/gtfs/tw.gtfs.zip" HOST=127.0.0.1 \
    PORT="$INGEST_PORT" PUBLIC_BASE_URL="$INGEST_LOCAL_URL" BUS_CITIES="$BUS_CITIES" BIKE_CITIES="$BIKE_CITIES" \
    BUS_INTERCITY="$BUS_INTERCITY" BUS_INTERCITY_ROUTES="$BUS_INTERCITY_ROUTES" BUS_ETA_INTERVAL_S=60 \
    TRA_DELAY_INTERVAL_S=120 BIKE_AVAILABILITY_INTERVAL_S="$BIKE_AVAILABILITY_INTERVAL_S" BIKE_STATIONS_INTERVAL_S=21600 \
    pnpm --filter @twc/ingest start
  # OTP reads YouBike docks from ingest once at start-up and does not retry, so wait for them.
  wait_for ingest "Ingest" 420 ingest_ready
  say "Starting routing (OpenTripPlanner, about 1 minute)"
  launch otp env OTP_DIR="$OTP_DIR" OTP_HEAP="$SERVE_HEAP" OTP_JAR="$OTP_JAR" JAVA="$JAVA" OTP_BIND_ADDRESS=127.0.0.1 \
    infra/scripts/otp-local.sh serve
  wait_for otp "OpenTripPlanner" 600 grep -q "Grizzly server running" "$RUN/otp.log"
  say "Starting the app's API"
  launch api env HOST="$API_HOST" PORT="$API_PORT" OTP_URL="http://127.0.0.1:$OTP_PORT/otp/gtfs/v1" \
    INGEST_URL="$INGEST_LOCAL_URL" pnpm --filter @twc/api start
  wait_for api "API" 120 curl -fs "http://127.0.0.1:$API_PORT/v1/health"
  say "Ready: $REGION_NAME"
  how_to_connect
  echo "Logs: $RUN/. Stop with: $SELF stop"
}

api_local_only() { case "$API_HOST" in 127.* | localhost | ::1) return 0 ;; *) return 1 ;; esac; }

# What to type into the app: this computer's address, or, when the API listens here only, the SSH
# tunnel to run on a laptop on the phone's Wi-Fi and the laptop's address.
how_to_connect() {
  local addr server
  if api_local_only; then
    # The address this SSH session came in on (SSH_CONNECTION: client port server port) is the one the
    # laptop already uses.
    server="$(awk '{ print $3 }' <<< "${SSH_CONNECTION:-}")"
    [ -n "$server" ] || server="$(phone_ip)"
    echo "The API listens on this server only (API_HOST=$API_HOST). On a laptop on your phone's Wi-Fi, run and keep open:"
    echo "  ssh -N -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -L 0.0.0.0:$API_PORT:127.0.0.1:$API_PORT $(id -un)@${server:-THIS-SERVER}"
    echo "In the app: Settings -> Server, enter:  http://LAPTOP-WIFI-IP:$API_PORT   (Windows: ipconfig; see docs/TRY_IT.md)"
  else
    addr="$(phone_ip)"
    if [ -n "$addr" ]; then
      echo "In the app: Settings -> Server, enter:  http://$addr:$API_PORT   (or tap: Find a server on this Wi-Fi)"
    else
      echo "In the app: Settings -> Server, enter:  http://THIS-COMPUTER-IP:$API_PORT"
      echo "(This computer's IP was not found: look it up in its Wi-Fi settings, or run: ip -4 addr)"
    fi
    echo "Phone and computer must be on the same Wi-Fi."
  fi
  if [ -n "${API_TOKEN:-}" ]; then echo "Access key (Settings -> Server):  $API_TOKEN"; fi
}

# Start the active region after every reboot, from the user's crontab (no sudo needed). The line
# carries this Node's folder, since cron starts with a bare PATH and nvm is not loaded there.
AUTOSTART_TAG="# twcommute-autostart"
autostart() {
  local others
  others="$(crontab -l 2>/dev/null | grep -vF "$AUTOSTART_TAG" || true)"
  case "${1:-on}" in
    on)
      [ -n "$(active_region)" ] || die "Choose a region first: $SELF hsinchu  (or taipei)"
      need crontab "Install cron: sudo apt install cron"
      local line
      # The wait lets the network come up; try-it.sh start then waits for TDX itself.
      line="@reboot sleep 60 && PATH='$(dirname "$(command -v node)")':/usr/local/bin:/usr/bin:/bin '$ROOT/$SELF' start >> '$RUN/boot.log' 2>&1 $AUTOSTART_TAG"
      printf '%s\n%s\n' "$others" "$line" | sed '/^$/d' | crontab -
      echo "After a reboot, $(active_region) starts by itself within about 4 minutes. Log: $RUN/boot.log"
      ;;
    off)
      printf '%s\n' "$others" | sed '/^$/d' | crontab -
      echo "Autostart is off."
      ;;
    *) die "Use: $SELF autostart on|off" ;;
  esac
}

stop() {
  local name pid
  for name in api otp ingest; do
    if pid="$(pid_of "$name")"; then
      kill -TERM -- "-$pid" 2>/dev/null || true
      # Wait for the group to exit, so its port and memory are free for what comes next.
      for _ in $(seq 1 30); do kill -0 -- "-$pid" 2>/dev/null || break; sleep 0.5; done
      kill -KILL -- "-$pid" 2>/dev/null || true
      [ "${1:-}" = quiet ] || echo "stopped $name"
    fi
    rm -f "$RUN/$name.pid"
  done
}

status() {
  local region name
  region="$(active_region)"
  echo "region: ${region:-none chosen yet}"
  for name in ingest otp api; do
    if running "$name"; then echo "$name: running"; else echo "$name: stopped"; fi
  done
  if api_local_only; then echo "phone access: through an SSH tunnel (API_HOST=$API_HOST)"; else echo "phone access: direct, port $API_PORT"; fi
  if ! running ingest; then echo "live data: ingest not running"; return; fi
  echo "live data:"
  # shellcheck disable=SC2016 # ${...} below is JavaScript.
  node -e '
    const ago = (s) => (s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);
    fetch(process.argv[1], { signal: AbortSignal.timeout(5000) })
      .then((r) => r.json())
      .then((b) => {
        for (const f of b.feeds)
          console.log(`  ${f.feed}: ${f.ageSeconds === null ? "no data yet" : `${ago(f.ageSeconds)} old`}${f.lastError ? `, last error: ${f.lastError}` : ""}`);
        // Stop/route pairs with a live prediction; 0 in the daytime means that operator is not running.
        if (b.busLive) console.log(`  live bus predictions: ${Object.entries(b.busLive).map(([k, v]) => `${k} ${v}`).join(", ")}`);
      })
      .catch(() => console.log("  ingest is not answering (still starting?)"))' "$INGEST_LOCAL_URL/health"
}

# Under sudo, nvm's node is not on PATH, and the files written to data/ would belong to root.
if [ "$EUID" -eq 0 ] && [ "${TRY_IT_ALLOW_ROOT:-}" != 1 ]; then
  die "Run this as your normal user, not as root or with sudo: under sudo, nvm's node is not on PATH. (TRY_IT_ALLOW_ROOT=1 runs it anyway.)"
fi
mkdir -p "$RUN"
case "${1:-}" in
  taipei | hsinchu) check_prereqs; select_region "$1"; [ -f "$BUILT" ] || build; start ;;
  "" | start | rebuild)
    region="$(active_region)"
    [ -n "$region" ] || usage
    check_prereqs
    use_region "$region"
    case "${1:-}" in
      "") [ -f "$BUILT" ] || build ;;
      rebuild) build fresh ;;
    esac
    start
    ;;
  stop) stop ;;
  status) status ;;
  autostart) autostart "${2:-on}" ;;
  *) echo "Unknown command '$1'." >&2; usage ;;
esac
