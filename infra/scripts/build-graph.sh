#!/usr/bin/env bash
# Build the OTP graph in data/otp.
#   infra/scripts/build-graph.sh street    # OSM only → streetGraph.obj (rarely; slow)
#   infra/scripts/build-graph.sh transit   # reuse streetGraph.obj + fresh GTFS → graph.obj (nightly)
#   infra/scripts/build-graph.sh all       # both (default)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/infra/docker-compose.yml" --env-file "$ROOT/.env")
STEP="${1:-all}"

if [ "$STEP" = "street" ] || [ "$STEP" = "all" ]; then
  "${COMPOSE[@]}" run --rm otp-build --buildStreet
fi
if [ "$STEP" = "transit" ] || [ "$STEP" = "all" ]; then
  "${COMPOSE[@]}" run --rm otp-build --loadStreet --save
fi
echo "Graph ready in data/otp. Start/restart: docker compose -f infra/docker-compose.yml up -d otp"
