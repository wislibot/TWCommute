#!/usr/bin/env bash
# Download GTFS (TDX) and OSM, and lay out the OTP base directory in $OTP_DIR (default data/otp).
#   infra/scripts/fetch-data.sh
#   BBOX="121.28,24.85,121.80,25.30" infra/scripts/fetch-data.sh   # optional clip (Greater Taipei)
#   OSM_URL=https://example.org/taiwan.osm.pbf infra/scripts/fetch-data.sh   # use this Taiwan extract
#   OTP_DIR="$PWD/data/otp-hsinchu" infra/scripts/fetch-data.sh   # lay out OTP there (one folder per region)
#   SKIP_DOWNLOAD=1 infra/scripts/fetch-data.sh   # reuse complete earlier downloads; still trims and clips
# OSM comes from Geofabrik's Taiwan extract. If Geofabrik cannot be reached (some networks are
# refused), the openstreetmap.fr Asia file (~13 GB) is streamed through osmium and cut to
# infra/osm/taiwan.geojson (Taiwan, Penghu, Kinmen, Matsu) without storing it.
# Requires TDX_CLIENT_ID/TDX_CLIENT_SECRET in the environment or .env, and `osmium` for the
# fallback or BBOX.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
# .env fills in only what the caller did not set: try-it.sh passes each region's own box and folders.
if [ -f .env ]; then
  caller="$(export -p | grep -v '^declare -[a-z]*r')" # read-only ones cannot be re-declared
  set -a
  . ./.env
  set +a
  eval "$caller"
fi
DATA_DIR="${DATA_DIR:-$ROOT/data}"
OTP_DIR="${OTP_DIR:-$DATA_DIR/otp}"
# prepare-otp runs from apps/ingest, so relative paths would land in two places.
case "$DATA_DIR" in /*) ;; *) DATA_DIR="$ROOT/$DATA_DIR" ;; esac
case "$OTP_DIR" in /*) ;; *) OTP_DIR="$ROOT/$OTP_DIR" ;; esac
GEOFABRIK_URL="https://download.geofabrik.de/asia/taiwan-latest.osm.pbf"
ASIA_URL="${OSM_ASIA_URL:-https://download.openstreetmap.fr/extracts/asia-latest.osm.pbf}"

echo "== GTFS (TDX)"
manifest="$DATA_DIR/gtfs/manifest.json"
# fetch-gtfs writes the manifest after both bundles, so it marks a complete download.
if [ "${SKIP_DOWNLOAD:-}" = 1 ] && [ -f "$manifest" ]; then
  downloaded="$(sed -n 's/.*"downloadedAt": *"\([^"]*\)".*/\1/p' "$manifest")"
  echo "Reusing the GTFS download in $DATA_DIR/gtfs (${downloaded:-date unknown}; SKIP_DOWNLOAD=1)"
else
  DATA_DIR="$DATA_DIR" pnpm --filter @twc/ingest fetch-gtfs
fi
DATA_DIR="$DATA_DIR" OTP_DIR="$OTP_DIR" INFRA_DIR="$ROOT/infra/otp" pnpm --filter @twc/ingest prepare-otp

need_osmium() {
  command -v osmium >/dev/null || { echo "osmium is required for $1 (apt install osmium-tool)"; exit 1; }
}

echo "== OSM"
mkdir -p "$DATA_DIR/osm" "$OTP_DIR/osm"
src="$DATA_DIR/osm/taiwan.osm.pbf"
# Downloads land in $src.part and are renamed only when complete.
if [ "${SKIP_DOWNLOAD:-}" = 1 ] && [ -f "$src" ]; then
  echo "Reusing $src (SKIP_DOWNLOAD=1)"
else
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
fi
dest="$OTP_DIR/osm/taiwan.osm.pbf"
# $dest may be a hard link to the download (from a run without BBOX): writing through it would
# destroy the download, so start from a new file.
rm -f "$dest"
if [ -n "${BBOX:-}" ]; then
  need_osmium "BBOX"
  osmium extract --overwrite -b "$BBOX" "$src" -o "$dest"
else
  ln -f "$src" "$dest" 2>/dev/null || cp "$src" "$dest"
fi
# try-it.sh builds the graph itself.
if [ -z "${QUIET_NEXT:-}" ]; then
  if [ "$OTP_DIR" = "$DATA_DIR/otp" ]; then
    echo "Done. Next: infra/scripts/build-graph.sh"
  else
    echo "Done. Next: OTP_DIR=$OTP_DIR infra/scripts/otp-local.sh build"
  fi
fi
