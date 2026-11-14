#!/usr/bin/env bash
# Screenshot the page in headless Firefox with the dev shim.
#
#   dev/shoot.sh NAME 'QUERY' [WIDTH,HEIGHT]
#
# Writes dev/out/NAME.png. QUERY is the shim's URL parameters (see dev/shim.js),
# for example 'bg=starfield&wx=rain'. Default size 1440,900.
set -euo pipefail

name=${1:?usage: dev/shoot.sh NAME 'QUERY' [WIDTH,HEIGHT]}
query=${2-}
size=${3:-1440,900}

cd "$(dirname "$0")/.."
mkdir -p dev/out

# A fresh profile per shot: a reused one serves stale CSS from its cache.
profile=$(mktemp -d)
cleanup() {
  # Bracketed so the pattern does not match this shell's own command line.
  pkill -f "[s]erve.py" 2>/dev/null || true
  rm -rf "$profile"
}
trap cleanup EXIT

pkill -f "[s]erve.py" 2>/dev/null || true
python3 dev/serve.py >dev/out/serve.log 2>&1 &
for _ in $(seq 1 50); do
  if (exec 3<>/dev/tcp/127.0.0.1/8765) 2>/dev/null; then break; fi
  sleep 0.1
done

timeout 90 firefox --headless --no-remote --profile "$profile" \
  --window-size "$size" --screenshot "$PWD/dev/out/$name.png" \
  "http://127.0.0.1:8765/page/index.html?$query"

echo "dev/out/$name.png"
