#!/usr/bin/env bash
# Download GTFS (TDX) and OSM, and lay out the OTP base directory in data/otp.
#   infra/scripts/fetch-data.sh
#   BBOX="121.28,24.85,121.80,25.30" infra/scripts/fetch-data.sh   # optional clip (Greater Taipei)
#   OSM_URL=https://example.org/taiwan.osm.pbf infra/scripts/fetch-data.sh   # use this Taiwan extract
# OSM comes from Geofabrik's Taiwan extract. If Geofabrik cannot be reached (some networks are
# refused), the openstreetmap.fr Asia file (~13 GB) is streamed through osmium and cut to
# infra/osm/taiwan.geojson (Taiwan, Penghu, Kinmen, Matsu) without storing it.
# Requires TDX_CLIENT_ID/TDX_CLIENT_SECRET in the environment or .env, and `osmium` for the
# fallback or BBOX.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
[ -f .env ] && set -a && . ./.env && set +a
DATA_DIR="${DATA_DIR:-$ROOT/data}"
GEOFABRIK_URL="https://download.geofabrik.de/asia/taiwan-latest.osm.pbf"
ASIA_URL="${OSM_ASIA_URL:-https://download.openstreetmap.fr/extracts/asia-latest.osm.pbf}"

echo "== GTFS (TDX)"
DATA_DIR="$DATA_DIR" pnpm --filter @twc/ingest fetch-gtfs
DATA_DIR="$DATA_DIR" INFRA_DIR="$ROOT/infra/otp" pnpm --filter @twc/ingest prepare-otp

need_osmium() {
  command -v osmium >/dev/null || { echo "osmium is required for $1 (apt install osmium-tool)"; exit 1; }
}

echo "== OSM"
mkdir -p "$DATA_DIR/osm" "$DATA_DIR/otp/osm"
src="$DATA_DIR/osm/taiwan.osm.pbf"
if [ -n "${OSM_URL:-}" ]; then
  curl -fL --retry 4 -o "$src.part" "$OSM_URL"
elif curl -fL --retry 2 --connect-timeout 20 -o "$src.part" "$GEOFABRIK_URL"; then
  :
else
  echo "Geofabrik unavailable; cutting Taiwan out of $ASIA_URL (streamed, takes a while)"
  need_osmium "the Asia fallback"
  curl -fL --retry 4 "$ASIA_URL" |
    osmium extract --overwrite -p "$ROOT/infra/osm/taiwan.geojson" -s simple -F pbf - -o "$src.part" -f pbf
fi
mv "$src.part" "$src"
dest="$DATA_DIR/otp/osm/taiwan.osm.pbf"
if [ -n "${BBOX:-}" ]; then
  need_osmium "BBOX"
  osmium extract --overwrite -b "$BBOX" "$src" -o "$dest"
else
  ln -f "$src" "$dest" 2>/dev/null || cp "$src" "$dest"
fi
echo "Done. Next: infra/scripts/build-graph.sh"
