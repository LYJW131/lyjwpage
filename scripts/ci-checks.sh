#!/usr/bin/env bash
set -euo pipefail

lint() {
  if [ -z "${CI_CACHE_DIR:-}" ]; then
    pnpm lint
    return
  fi
  cp "$CI_CACHE_DIR/eslintcache" "$RUNNER_TEMP/eslintcache" 2>/dev/null || true
  pnpm lint --cache --cache-strategy content --cache-location "$RUNNER_TEMP/eslintcache"
  cache_file="$CI_CACHE_DIR/eslintcache.$GITHUB_JOB.$GITHUB_RUN_ID.$GITHUB_RUN_ATTEMPT"
  cp "$RUNNER_TEMP/eslintcache" "$cache_file"
  mv "$cache_file" "$CI_CACHE_DIR/eslintcache"
}

typecheck() {
  if [ -n "${CI_CACHE_DIR:-}" ]; then
    cp "$CI_CACHE_DIR/tsconfig.tsbuildinfo" tsconfig.tsbuildinfo 2>/dev/null || true
  fi
  if [ -n "${CI_CACHE_DIR:-}" ]; then
    pnpm -r --include-workspace-root --parallel typecheck
  else
    pnpm -r --include-workspace-root typecheck
  fi
  if [ -n "${CI_CACHE_DIR:-}" ]; then
    cache_file="$CI_CACHE_DIR/tsconfig.tsbuildinfo.$GITHUB_JOB.$GITHUB_RUN_ID.$GITHUB_RUN_ATTEMPT"
    cp tsconfig.tsbuildinfo "$cache_file"
    mv "$cache_file" "$CI_CACHE_DIR/tsconfig.tsbuildinfo"
  fi
}

workspace_tests() {
  pnpm -r --include-workspace-root --workspace-concurrency=4 --no-bail --stream \
    --filter lyjwpage \
    --filter @lyjwpage/api \
    --filter @lyjwpage/ai \
    --filter @lyjwpage/ingress \
    --filter @lyjwpage/collector \
    --filter @lyjwpage/agents-reporter \
    --filter @lyjwpage/server-reporter \
    --filter @lyjwpage/emby-reporter \
    --filter @lyjwpage/playstation-reporter \
    --filter @lyjwpage/discord-reporter test
}

script_tests() {
  node --test scripts/*.test.mjs
}

docs() {
  pnpm docs:check
}

if [ "${1:-}" = '--gate' ]; then
  case "$2" in
    lint) lint ;;
    typecheck) typecheck ;;
    workspace_tests) workspace_tests ;;
    script_tests) script_tests ;;
    docs) docs ;;
    *) exit 2 ;;
  esac
  exit 0
fi

run_gate() {
  local name="$1" started elapsed status=0
  started=$(date +%s)
  # 函数作为条件执行时 bash 会关闭 errexit；单独的 bash 进程保留门禁中间命令的失败。
  bash -euo pipefail "$0" --gate "$name" > "$RUNNER_TEMP/check-$name.log" 2>&1 || status=$?
  elapsed=$(( $(date +%s) - started ))
  printf 'CI_TIMING %s seconds=%s status=%s\n' "$name" "$elapsed" "$status" >> "$RUNNER_TEMP/check-$name.log"
  return "$status"
}

gates=(lint typecheck workspace_tests script_tests docs)
pids=()
status=0
for gate in "${gates[@]}"; do
  echo "Starting $gate"
  if [ -n "${CI_CACHE_DIR:-}" ]; then
    run_gate "$gate" &
    pids+=("$!")
  else
    run_gate "$gate" || status=1
  fi
done
for pid in "${pids[@]}"; do
  wait "$pid" || status=1
done
for gate in "${gates[@]}"; do
  echo "::group::$gate"
  cat "$RUNNER_TEMP/check-$gate.log"
  echo '::endgroup::'
done
exit "$status"
