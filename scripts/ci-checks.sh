#!/usr/bin/env bash
set -euo pipefail

lint() {
  pnpm lint
}

typecheck() {
  pnpm -r --include-workspace-root typecheck
}

workspace_tests() {
  pnpm -r --include-workspace-root --workspace-concurrency=4 --no-bail --stream test
}

script_tests() {
  node --test scripts/*.test.mjs
}

docs() {
  pnpm docs:check
}

design() {
  pnpm design:scale
}

if [ "${1:-}" = '--gate' ]; then
  case "$2" in
    lint) lint ;;
    typecheck) typecheck ;;
    workspace_tests) workspace_tests ;;
    script_tests) script_tests ;;
    docs) docs ;;
    design) design ;;
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

gates=(lint typecheck workspace_tests script_tests docs design)
status=0
for gate in "${gates[@]}"; do
  echo "Starting $gate"
  run_gate "$gate" || status=1
done
for gate in "${gates[@]}"; do
  echo "::group::$gate"
  cat "$RUNNER_TEMP/check-$gate.log"
  echo '::endgroup::'
done
exit "$status"
