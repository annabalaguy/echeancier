#!/usr/bin/env bash
# Runs tests/data-safety.html in headless Chrome. Exit code 0 = all pass.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-$(command -v google-chrome || command -v chromium || echo "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")}"
PORT=$((8700 + RANDOM % 200)); TMP="$(mktemp -d)"; RES="$TMP/result.txt"
python3 tests/server.py "$PORT" "$RES" & SRV=$!
sleep 1
"$CHROME" --headless=new --disable-gpu --no-sandbox --no-first-run --user-data-dir="$TMP/profile" --remote-debugging-port=0 "http://127.0.0.1:$PORT/tests/data-safety.html" >/dev/null 2>&1 & CHR=$!
trap 'kill $CHR $SRV 2>/dev/null || true; wait 2>/dev/null || true; sleep 1; rm -rf "$TMP" 2>/dev/null || true' EXIT
for _ in $(seq 1 90); do [ -s "$RES" ] && break; sleep 1; done
[ -s "$RES" ] || { echo "TIMEOUT: tests did not finish"; exit 1; }
cat "$RES"; echo
grep -q "RESULT: ALL PASS" "$RES"
