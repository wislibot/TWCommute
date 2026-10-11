#!/usr/bin/env bash
# Download GTFS (TDX) and OSM (Geofabrik) and lay out the OTP base directory in data/otp.
#   BBOX="121.28,24.85,121.80,25.30" infra/scripts/fetch-data.sh   # optional clip (Greater Taipei)
# Requires TDX_CLIENT_ID/TDX_CLIENT_SECRET in the environment or .env, and `osmium` when BBOX is set.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
[ -f .env ] && set -a && . ./.env && set +a
DATA_DIR="${DATA_DIR:-$ROOT/data}"
OSM_URL="${OSM_URL:-https://download.geofabrik.de/asia/taiwan-latest.osm.pbf}"

echo "== GTFS (TDX)"
DATA_DIR="$DATA_DIR" pnpm --filter @twc/ingest fetch-gtfs
DATA_DIR="$DATA_DIR" INFRA_DIR="$ROOT/infra/otp" pnpm --filter @twc/ingest prepare-otp

echo "== OSM"
mkdir -p "$DATA_DIR/osm" "$DATA_DIR/otp/osm"
curl -fL --retry 4 -o "$DATA_DIR/osm/taiwan-latest.osm.pbf" "$OSM_URL"
if [ -n "${BBOX:-}" ]; then
  command -v osmium >/dev/null || { echo "BBOX set but osmium is not installed (apt install osmium-tool)"; exit 1; }
  osmium extract --overwrite -b "$BBOX" "$DATA_DIR/osm/taiwan-latest.osm.pbf" -o "$DATA_DIR/otp/osm/taiwan.osm.pbf"
else
  cp "$DATA_DIR/osm/taiwan-latest.osm.pbf" "$DATA_DIR/otp/osm/taiwan.osm.pbf"
fi
echo "Done. Next: infra/scripts/build-graph.sh"
