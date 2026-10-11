#!/usr/bin/env bash
set -euo pipefail

version=$(node -e 'const manager = require("./package.json").packageManager; const match = /^pnpm@(\d+\.\d+\.\d+)(?:\+sha\d+\.[a-f0-9]+)?$/.exec(manager); if (!match) throw new Error("packageManager must pin pnpm"); process.stdout.write(match[1]);')
tools="$RUNNER_TOOL_CACHE/pnpm"
destination="$tools/$version"
mkdir -p "$tools"
exec 9> "$tools/$version.lock"
flock 9
if [ ! -x "$destination/node_modules/.bin/pnpm" ]; then
  staging=$(mktemp -d "$tools/.install.XXXXXX")
  trap 'rm -rf -- "$staging"' EXIT
  npm install --prefix "$staging" --ignore-scripts --no-audit --no-fund "pnpm@$version"
  mv "$staging" "$destination"
fi
"$destination/node_modules/.bin/pnpm" --version
echo "$destination/node_modules/.bin" >> "$GITHUB_PATH"
