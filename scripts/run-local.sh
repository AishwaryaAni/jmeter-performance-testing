#!/usr/bin/env bash
# Run a load profile locally exactly as CI does, then apply the SLA gate.
#   ./scripts/run-local.sh            # smoke
#   ./scripts/run-local.sh load
# Requires: JMeter on PATH (or JMETER_HOME set), Node, and the API running (docker compose up -d).
set -euo pipefail

PROFILE="${1:-smoke}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JMETER="${JMETER_HOME:+$JMETER_HOME/bin/}jmeter"
OUT="$ROOT/results/$PROFILE"

[ -f "$ROOT/profiles/$PROFILE.properties" ] || { echo "Unknown profile: $PROFILE"; exit 2; }

echo "Checking the API is up..."
curl -fs -o /dev/null -w '%{http_code}\n' http://localhost:3001/ping | grep -q 201 \
  || { echo "API not reachable on :3001 — run: docker compose up -d"; exit 1; }

rm -rf "$OUT" && mkdir -p "$OUT"
"$JMETER" -n \
  -t "$ROOT/test-plans/booking-api-load-test.jmx" \
  -q "$ROOT/profiles/$PROFILE.properties" \
  -l "$OUT/results.jtl" -j "$OUT/jmeter.log" \
  -e -o "$OUT/dashboard"

node "$ROOT/scripts/check-thresholds.js" \
  "$OUT/dashboard/statistics.json" "$ROOT/thresholds/$PROFILE.json" "$PROFILE" "$OUT/summary.json"

echo "Dashboard: $OUT/dashboard/index.html"
