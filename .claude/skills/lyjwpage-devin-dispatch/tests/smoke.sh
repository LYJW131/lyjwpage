#!/usr/bin/env bash
# smoke.sh [workdir] — end-to-end check of dv.py against the real Devin CLI on a
# throwaway repo: start, approve in-worktree write menus, append multi-line input while busy,
# wait, report, refuse a write outside the worktree, interrupt, stop, headless resume.
# Costs a few swe-2-max turns (~4 min).
# Run it after a Devin CLI update: the screen markers in dv.py are version-bound.
set -u
W=${1:-$(mktemp -d)}
export DV_RUNS=$W/runs
DVPY=$(cd "$(dirname "$0")/.." && pwd)/scripts/dv.py
dv() { python3 -I "$DVPY" "$@"; }
N=smoke-$$
fail() { echo "FAIL: $*"; dv status "$N" --lines 15 2>/dev/null; dv stop "$N" >/dev/null 2>&1; exit 1; }
settle() {  # approve sandbox menus until Devin is past them; prints the last state
  local st
  for _ in $(seq 1 20); do
    st=$(dv status "$N" --lines 1 | sed -n 's/^state: \([a-z]*\).*/\1/p')
    [ "$st" = approval ] || { echo "$st"; return; }
    dv approve "$N" >/dev/null
  done
  echo "$st"
}

mkdir -p "$W/repo" && git -C "$W/repo" init -q && echo hello > "$W/repo/a.txt"
git -C "$W/repo" add . && git -C "$W/repo" -c commit.gpgsign=false commit -qm init
echo 'Run `sleep 25 && echo slept` in the shell, then create b.txt containing BRIEF-OK. Do not commit.' > "$W/brief.md"

dv start "$N" --cwd "$W/repo" --brief "$W/brief.md" || fail start
sleep 8
case $(settle) in busy|idle) ;; *) fail "not busy after start" ;; esac
printf 'Orchestrator follow-up:\n- append a line SEND-OK to b.txt\n- then reply DONE-2\n' | dv send "$N" || fail send
dv wait "$N" --timeout 240 --poll 5 --settle 8 | grep -q DONE-2 || fail "no DONE-2 after wait"
[ "$(cat "$W/repo/b.txt")" = "$(printf 'BRIEF-OK\nSEND-OK')" ] || fail "b.txt: $(cat "$W/repo/b.txt")"
dv report "$N" --all | grep -q 'Orchestrator follow-up' || fail "follow-up missing from export"

mkdir -p "$W/outside"
dv send "$N" "Use your file write tool, not the shell, to create $W/outside/edit.txt containing OUT. Then reply DONE-3." || fail send-outside
dv wait "$N" --timeout 240 --poll 5 --settle 8 > "$W/wait-outside.out"; rc=$?
[ "$rc" = 4 ] || fail "outside write: wait returned $rc, want 4: $(tail -3 "$W/wait-outside.out")"
grep -q 'outside the worktree' "$W/wait-outside.out" || fail "wait returned 4 for another reason: $(head -1 "$W/wait-outside.out")"
[ ! -e "$W/outside/edit.txt" ] || fail "outside file was written"
dv deny "$N" | grep -q denied || fail deny
dv wait "$N" --timeout 240 --poll 5 --settle 8 >/dev/null; rc=$?
[ "$rc" = 0 ] || [ "$rc" = 4 ] || fail "after deny: wait returned $rc"
[ ! -e "$W/outside/edit.txt" ] || fail "outside file was written after deny"

dv send "$N" 'Run `sleep 120` in the shell, then reply LATE.' || fail send2
sleep 10
settle >/dev/null
dv interrupt "$N" | grep -qE 'state: (idle|attention)' || fail interrupt

dv stop "$N" | grep -q stopped || fail stop
dv list | grep "$N" | grep -qE 'exited|gone' || fail "still running after stop"
dv resume "$N" 'Reply with exactly: RESUME-OK' | grep -q RESUME-OK || fail resume

sid=$(python3 -I -c "import json,sys;print(json.load(open(sys.argv[1]))['session_id'])" "$DV_RUNS/$N/meta.json")
(cd "$W/repo" && devin rm --force "$sid" >/dev/null 2>&1)
echo "PASS ($W, approvals: $(python3 -I -c "import json,sys;print(json.load(open(sys.argv[1])).get('approvals',0))" "$DV_RUNS/$N/meta.json"))"
