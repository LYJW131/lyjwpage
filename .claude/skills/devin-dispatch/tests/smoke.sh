#!/bin/zsh
# smoke.sh [workdir] — end-to-end check of dv.py against the real Devin CLI on a
# throwaway repo: start, append multi-line input while busy, wait, report,
# interrupt, stop, headless resume. Costs a few free swe-2-max turns (~3 min).
# Run it after a Devin CLI update: the screen markers in dv.py are version-bound.
set -u
W=${1:-$(mktemp -d)}
export DV_RUNS=$W/runs
DVPY=${0:A:h:h}/scripts/dv.py
dv() { python3 -I $DVPY "$@"; }
fail() { print -r -- "FAIL: $*"; dv stop $N >/dev/null 2>&1; exit 1; }
N=smoke-$$

mkdir -p $W/repo && git -C $W/repo init -q && print hello > $W/repo/a.txt
git -C $W/repo add . && git -C $W/repo -c commit.gpgsign=false commit -qm init
print 'Run `sleep 25 && echo slept` in the shell, then create b.txt containing BRIEF-OK. Do not commit.' > $W/brief.md

dv start $N --cwd $W/repo --brief $W/brief.md --mode dangerous || fail start
sleep 8
dv status $N --lines 3 | grep -q '^state: busy' || fail "not busy after start"
printf 'Orchestrator follow-up:\n- append a line SEND-OK to b.txt\n- then reply DONE-2\n' | dv send $N || fail send
dv wait $N --timeout 240 --poll 5 --settle 8 | grep -q DONE-2 || fail "no DONE-2 after wait"
[[ "$(cat $W/repo/b.txt)" == $'BRIEF-OK\nSEND-OK' ]] || fail "b.txt: $(cat $W/repo/b.txt)"
dv report $N --all | grep -q 'Orchestrator follow-up' || fail "follow-up missing from export"

dv send $N 'Run `sleep 120` in the shell, then reply LATE.' || fail send2
sleep 10
dv interrupt $N | grep -qE 'state: (idle|attention)' || fail interrupt

dv stop $N | grep -q stopped || fail stop
dv list | grep $N | grep -qE 'exited|gone' || fail "still running after stop"
dv resume $N 'Reply with exactly: RESUME-OK' | grep -q RESUME-OK || fail resume

sid=$(python3 -I -c "import json,sys;print(json.load(open(sys.argv[1]))['session_id'])" $DV_RUNS/$N/meta.json)
(cd $W/repo && devin rm --force $sid >/dev/null 2>&1)
print "PASS ($W)"
