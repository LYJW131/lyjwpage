#!/bin/bash
set -uo pipefail

base="https://raw.githubusercontent.com/LYJW131/lyjwpage/${LYJW_SETUP_REF:-main}/scripts/cloud"
dir="$(mktemp -d)"
parts=(signing.sh browser-trust.sh devin.sh claude-user.sh tokens.sh)

declare -A pid
for f in "${parts[@]}"; do
  curl -fsSL --retry 2 --max-time 30 "$base/$f" -o "$dir/$f.part" &
  pid[$f]=$!
done
for f in "${parts[@]}"; do
  # A failed curl can leave a non-empty truncated file; only a clean exit promotes it.
  if wait "${pid[$f]}"; then mv "$dir/$f.part" "$dir/$f"; fi
done

# Each part sees only the secrets it needs.
run() {
  local f="$1"; shift
  local unset_args=()
  for v in "$@"; do unset_args+=(-u "$v"); done
  [ -s "$dir/$f" ] || { echo "setup: failed to fetch $f" >&2; return 1; }
  timeout 1500 env "${unset_args[@]}" bash "$dir/$f"
}

run signing.sh DEVIN_SESSION_TOKEN || exit 1
run browser-trust.sh GIT_SIGN_KEY_B64 DEVIN_SESSION_TOKEN || exit 1
run devin.sh GIT_SIGN_KEY_B64 || echo "WARNING: devin.sh failed (see above); the rest of the setup continues" >&2
run claude-user.sh GIT_SIGN_KEY_B64 DEVIN_SESSION_TOKEN || true
run tokens.sh GIT_SIGN_KEY_B64 DEVIN_SESSION_TOKEN || true
