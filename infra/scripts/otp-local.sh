#!/usr/bin/env bash
# Run OpenTripPlanner from its shaded jar, without Docker (OTP 2.10 needs Java 25+).
#   infra/scripts/otp-local.sh street    # OSM → streetGraph.obj
#   infra/scripts/otp-local.sh transit   # streetGraph.obj + GTFS → graph.obj
#   infra/scripts/otp-local.sh build     # both in one step
#   infra/scripts/otp-local.sh serve     # serve graph.obj on :8080
# Jar: https://repo1.maven.org/maven2/org/opentripplanner/otp-shaded/2.10.0/otp-shaded-2.10.0.jar
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OTP_DIR="${OTP_DIR:-$ROOT/data/otp}"
OTP_JAR="${OTP_JAR:-$ROOT/data/tools/otp-shaded-2.10.0.jar}"
JAVA="${JAVA:-java}"
HEAP="${OTP_HEAP:-8g}"

[ -f "$OTP_JAR" ] || { echo "OTP jar not found at $OTP_JAR (set OTP_JAR)"; exit 1; }
run() { exec "$JAVA" "-Xmx$HEAP" -jar "$OTP_JAR" "$@" "$OTP_DIR"; }

case "${1:-}" in
  street) run --buildStreet ;;
  transit) run --loadStreet --save ;;
  build) run --build --save ;;
  serve) run --load --serve ;;
  *) echo "usage: $0 street|transit|build|serve"; exit 2 ;;
esac
