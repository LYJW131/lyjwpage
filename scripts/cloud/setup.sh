#!/bin/bash
set -uo pipefail

base="https://raw.githubusercontent.com/LYJW131/lyjwpage/${LYJW_SETUP_REF:-main}/scripts/cloud"
dir="$(mktemp -d)"
parts=(signing.sh browser-trust.sh devin.sh claude-user.sh)

for f in "${parts[@]}"; do
  curl -fsSL --retry 2 --max-time 30 "$base/$f" -o "$dir/$f" &
done
wait

run() {
  [ -s "$dir/$1" ] || { echo "setup: failed to fetch $1" >&2; return 1; }
  bash "$dir/$1"
}

run signing.sh || exit 1
run browser-trust.sh || exit 1
run devin.sh || echo "WARNING: devin.sh failed (see above); the rest of the setup continues" >&2
run claude-user.sh || true
