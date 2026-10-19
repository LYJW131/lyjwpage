#!/usr/bin/env python3
"""dv.py — run the local Devin CLI as a steerable worker inside tmux.

Subcommands (run `dv.py <cmd> -h` for flags):
  start NAME --cwd WT --brief FILE   launch interactive Devin in tmux session dv-NAME
  send NAME [TEXT | -f FILE]         append input (works while Devin is busy; queued
                                     until its next tool boundary), verified
  status NAME                        state + screen tail + last agent message
  wait NAME [--timeout S]            block until idle / exited / needs attention
  report NAME [-n N | --all]         agent messages from the --export JSON
  key NAME KEY...                    raw tmux keys (answer an approval menu: `key NAME 1`)
  approve NAME                       approve the pending approval menu once (Enter on "Approve once")
  interrupt NAME                     Esc Esc: stop the current turn, keep the session
  resume NAME [TEXT | -f FILE]       headless follow-up (devin -r ID -p) when tmux is gone
  stop NAME                          /exit, then kill the tmux session if still there
  list                               all runs and their states

Permission mode: --mode, else $DV_MODE, else accept-edits — except when `devin` is the
cloud wrapper (marked DEVIN_WRAPPER), which then chooses the mode (dangerous) itself.
Under the wrapper's --sandbox Devin still shows an approval menu before some writes;
runs started under the wrapper record auto_approve, and `wait` then approves each such
menu once (never "always"): the sandbox, not the menu, is what bounds the writes.

Run state lives in $DV_RUNS (default ~/.claude/devin-dispatch/runs)/NAME/:
meta.json, export.json (Devin's --export, rewritten after every turn), exit.code.
Screen markers were taken from Devin CLI v3000.11.92; `status` prints the raw
screen whenever it cannot classify it, so read that rather than trusting a guess.
"""
import argparse, json, os, shlex, shutil, subprocess, sys, time
from pathlib import Path

RUNS = Path(os.environ.get('DV_RUNS', Path.home() / '.claude/devin-dispatch/runs'))
BUSY = ('Guide Devin while it works', 'esc twice to interrupt')
IDLE = 'Ask Devin to build features'
STARTING = 'Starting session'
NETERR = ('Connection failed', 'Connection error')  # retries in place; input waits until it recovers
APPROVAL = 'Approve once'


def sh(*args, check=True, **kw):
    return subprocess.run(args, capture_output=True, text=True, check=check, **kw)


def die(msg, code=2):
    print(f'dv: {msg}', file=sys.stderr)
    sys.exit(code)


def wrapped():
    """True when `devin` on PATH is the cloud setup's wrapper, which picks the mode itself."""
    exe = shutil.which('devin')
    try:
        return bool(exe) and b'DEVIN_WRAPPER' in Path(exe).read_bytes()[:4096]
    except OSError:
        return False


def default_mode():
    return os.environ.get('DV_MODE') or (None if wrapped() else 'accept-edits')


def mode_args(mode):
    return ['--permission-mode', mode] if mode else []


def run_dir(name):
    return RUNS / name


def load(name):
    p = run_dir(name) / 'meta.json'
    if not p.exists():
        die(f'no run named {name!r} under {RUNS}')
    return json.loads(p.read_text())


def save(meta):
    p = run_dir(meta['name']) / 'meta.json'
    p.write_text(json.dumps(meta, indent=2, ensure_ascii=False))


def pane(sess):
    return f'={sess}:'  # exact session match; pane commands need the trailing colon


def tmux_alive(sess):
    return sh('tmux', 'has-session', '-t', f'={sess}', check=False).returncode == 0


def pane_dead(sess):
    r = sh('tmux', 'display-message', '-p', '-t', pane(sess), '#{pane_dead}', check=False)
    return r.stdout.strip() == '1'


def screen(sess, history=0):
    args = ['tmux', 'capture-pane', '-p', '-t', pane(sess)]
    if history:
        args += ['-S', f'-{history}']
    r = sh(*args, check=False)
    return [l.rstrip() for l in r.stdout.splitlines()]


def input_box(lines):
    """Text of the composer: the lines between the last two horizontal rules."""
    rules = [i for i, l in enumerate(lines) if l.lstrip().startswith('──')]
    if len(rules) < 2:
        return None
    body = [l.strip() for l in lines[rules[-2] + 1:rules[-1]] if l.strip()]
    text = '\n'.join(body)
    return text[1:].strip() if text.startswith('❭') else text


def session_ids(cwd):
    r = sh('devin', 'list', '--format', 'json', cwd=cwd, check=False)
    try:
        return {s['id']: s for s in json.loads(r.stdout or '[]')}
    except json.JSONDecodeError:
        return {}


def export_steps(meta):
    p = Path(meta['export'])
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text()).get('steps', [])
    except (json.JSONDecodeError, OSError):
        return []  # mid-write; caller retries


def last_turn(steps):
    """Agent messages after the last user message."""
    out = []
    for s in reversed(steps):
        if s.get('source') == 'user' and s.get('message'):
            break
        if s.get('source') == 'agent' and s.get('message'):
            out.append(s['message'])
    return list(reversed(out))


def state(meta):
    sess = meta['tmux']
    code = run_dir(meta['name']) / 'exit.code'
    if not tmux_alive(sess) or pane_dead(sess):
        return ('exited' if code.exists() else 'gone'), []
    lines = screen(sess)
    joined = '\n'.join(lines)
    box = input_box(lines) or ''
    # Only an error right above the composer is live; once Devin recovers, its next
    # tool header lands below the old error line.
    rules = [i for i, l in enumerate(lines) if l.lstrip().startswith('──')]
    above = [l for l in lines[:rules[-2]] if l.strip()][-2:] if len(rules) >= 2 else []
    if any(e in l for e in NETERR for l in above):
        return 'neterror', lines
    if any(b in joined for b in BUSY):
        return 'busy', lines
    if IDLE in joined and STARTING not in joined:
        # A pasted but unsent message sits in the box instead of the placeholder.
        return ('idle' if box.startswith(IDLE) or not box else 'typed'), lines
    if STARTING in joined:
        return 'starting', lines
    # Checked only after the busy/idle markers: an open menu replaces the composer, while an
    # answered one can linger in the scrollback above a live composer.
    if APPROVAL in joined:
        return 'approval', lines
    return 'attention', lines  # a question, approval prompt, menu or error


def tail(lines, n=25):
    return [l for l in lines if l.strip()][-n:]


def cmd_start(a):
    d = run_dir(a.name)
    sess = f'dv-{a.name}'
    if tmux_alive(sess):
        die(f'tmux session {sess} already exists')
    cwd = Path(a.cwd).resolve()
    brief = Path(a.brief).resolve()
    if not brief.is_file():
        die(f'brief not found: {brief}')
    d.mkdir(parents=True, exist_ok=True)
    (d / 'exit.code').unlink(missing_ok=True)
    export = d / 'export.json'
    before = set(session_ids(cwd))
    devin = ['devin', '--model', a.model, '--respect-workspace-trust', 'false',
             *mode_args(a.mode), '--prompt-file', str(brief), '--export', str(export)]
    if a.nice:
        devin = ['nice', '-n', str(a.nice)] + devin
    cmd = f'{shlex.join(devin)}; echo $? > {shlex.quote(str(d / "exit.code"))}'
    sh('tmux', 'new-session', '-d', '-s', sess, '-x', '220', '-y', '50', '-c', str(cwd), cmd)
    sh('tmux', 'set-option', '-t', pane(sess), 'remain-on-exit', 'on', check=False)
    sh('tmux', 'set-option', '-t', pane(sess), 'history-limit', '50000', check=False)
    meta = dict(name=a.name, tmux=sess, cwd=str(cwd), brief=str(brief), model=a.model,
                mode=a.mode, export=str(export), started=time.time(), last_send=time.time(),
                session_id=None, auto_approve=a.auto_approve, approvals=0)
    save(meta)
    for _ in range(30):  # the session id shows up once Devin has written its first state
        time.sleep(2)
        new = set(session_ids(cwd)) - before
        if new:
            meta['session_id'] = sorted(new)[0]
            break
    save(meta)
    print(json.dumps({k: meta[k] for k in ('name', 'tmux', 'session_id', 'export')}, ensure_ascii=False))
    print(f'watch:  tmux attach -t {sess}')
    if not meta['session_id']:
        print('dv: session id not seen yet; `status` retries it', file=sys.stderr)


def read_text(a):
    if a.file:
        return Path(a.file).read_text()
    if a.text:
        return ' '.join(a.text)
    return sys.stdin.read()


def cmd_send(a):
    meta = load(a.name)
    st, _ = state(meta)
    if st in ('exited', 'gone'):
        die(f'{a.name} is {st}; use `resume` for a headless follow-up', 3)
    if st == 'approval':
        die(f'{a.name} is on an approval menu; `approve` it first (pasted text would land in the menu)', 4)
    text = read_text(a).strip('\n')
    if not text:
        die('empty message')
    sess = meta['tmux']
    buf = f'dv-{os.getpid()}'
    # Bracketed paste keeps newlines inside the composer instead of submitting early.
    subprocess.run(['tmux', 'load-buffer', '-b', buf, '-'], input=text, text=True, check=True)
    sh('tmux', 'paste-buffer', '-p', '-d', '-b', buf, '-t', pane(sess))
    time.sleep(1.0)  # an Enter sent right after the text gets swallowed
    first = text.splitlines()[0].strip()[:40]
    for attempt in range(2):
        sh('tmux', 'send-keys', '-t', pane(sess), 'Enter')
        time.sleep(2.0)
        box = input_box(screen(sess)) or ''
        if first not in box:
            meta['last_send'] = time.time()
            save(meta)
            print(f'sent ({st} at send time{"; queued until its next step" if st == "busy" else ""})')
            return
    die('text is still in the composer after two Enters; inspect with `status`', 4)


def cmd_status(a):
    meta = load(a.name)
    if not meta.get('session_id'):
        ids = session_ids(meta['cwd'])
        if ids:
            meta['session_id'] = max(ids.values(), key=lambda s: s.get('last_activity_at', 0))['id']
            save(meta)
    st, lines = state(meta)
    code = run_dir(a.name) / 'exit.code'
    print(f'state: {st}' + (f' (exit {code.read_text().strip()})' if code.exists() else ''))
    print(f'session: {meta.get("session_id")}  tmux: {meta["tmux"]}  cwd: {meta["cwd"]}')
    if lines:
        print('--- screen')
        print('\n'.join(tail(lines, a.lines)))
    msgs = last_turn(export_steps(meta))
    if msgs:
        print('--- last agent message (export)')
        print(msgs[-1][-2000:])
    return st


def approve_once(meta):
    sh('tmux', 'send-keys', '-t', pane(meta['tmux']), 'Enter')  # cursor starts on 1, "Approve once"
    meta['approvals'] = meta.get('approvals', 0) + 1
    meta['last_send'] = time.time()
    save(meta)
    time.sleep(2)


def cmd_approve(a):
    meta = load(a.name)
    st, lines = state(meta)
    if st != 'approval':
        print(f'state: {st}; nothing to approve')
        return
    approve_once(meta)
    print(f'approved once ({meta["approvals"]} so far); state: {state(meta)[0]}')


def cmd_wait(a):
    meta = load(a.name)
    t0 = time.time()
    idle_seen = attn_since = last_hash = approved_hash = None
    while True:
        st, lines = state(meta)
        now = time.time()
        if st in ('exited', 'gone'):
            print(f'wait: {st}')
            sys.exit(3)
        h = hash(tuple(l for l in lines if 'esc twice to interrupt' not in l))
        # The same menu still on screen after an approval is a stale render or a menu
        # that ignored Enter: fall through to the attention timer instead of pressing again.
        if st != 'approval':
            approved_hash = None
        elif meta.get('auto_approve') and h != approved_hash:
            approve_once(meta)
            approved_hash = h
            continue
        if st == 'idle':
            fresh = Path(meta['export']).exists() and \
                Path(meta['export']).stat().st_mtime >= meta.get('last_send', 0)
            if fresh and idle_seen and now - idle_seen >= a.settle:
                print('wait: idle')
                print('\n'.join(last_turn(export_steps(meta)))[-4000:])
                sys.exit(0)
            idle_seen = idle_seen or now
        else:
            idle_seen = None
        # A stale error line or unmatched text can sit on screen while Devin keeps
        # working, so only a screen that has also stopped changing counts.
        if st in ('attention', 'approval', 'typed', 'neterror') and h == last_hash:
            attn_since = attn_since or now
            if now - attn_since >= a.attention:
                print(f'wait: needs attention ({st})')
                print('\n'.join(tail(lines, 30)))
                sys.exit(4)
        else:
            attn_since = None
        last_hash = h
        if now - t0 >= a.timeout:
            print(f'wait: timeout after {a.timeout}s, state {st}')
            sys.exit(124)
        time.sleep(a.poll)


def cmd_report(a):
    meta = load(a.name)
    steps = export_steps(meta)
    if a.all:
        for s in steps:
            if s.get('message') and s.get('source') in ('user', 'agent'):
                print(f'## {s["source"]}\n{s["message"]}\n')
        return
    msgs = last_turn(steps)
    print('\n\n'.join(msgs[-a.n:]) if msgs else '(no agent message after the last user message)')


def cmd_interrupt(a):
    meta = load(a.name)
    sh('tmux', 'send-keys', '-t', pane(meta['tmux']), 'Escape')
    time.sleep(0.3)
    sh('tmux', 'send-keys', '-t', pane(meta['tmux']), 'Escape')
    time.sleep(2)
    print(f'state: {state(meta)[0]}')


def cmd_key(a):
    meta = load(a.name)
    for k in a.keys:  # tmux key names: 1, Enter, Escape, Up, Down, C-c ...
        sh('tmux', 'send-keys', '-t', pane(meta['tmux']), k)
        time.sleep(0.3)
    time.sleep(1.5)
    st, lines = state(meta)
    print(f'state: {st}')
    print('\n'.join(tail(lines, 12)))


def cmd_resume(a):
    meta = load(a.name)
    if tmux_alive(meta['tmux']) and not pane_dead(meta['tmux']):
        die('the tmux session is still running; use `send`', 3)
    if not meta.get('session_id'):
        die('no session id recorded; find it with `devin list --format json` in the worktree')
    text = read_text(a).strip()
    cmd = ['devin', '-r', meta['session_id'], '--model', meta['model'],
           '--respect-workspace-trust', 'false', *mode_args(meta['mode']),
           '--export', meta['export'], '-p', text]  # -p binds the prompt: keep it last
    meta['last_send'] = time.time()
    save(meta)
    r = subprocess.run(cmd, cwd=meta['cwd'], text=True, capture_output=True)
    (run_dir(a.name) / 'resume.out').write_text(r.stdout + r.stderr)
    print(r.stdout[-4000:] or r.stderr[-2000:])
    sys.exit(r.returncode)


def cmd_stop(a):
    meta = load(a.name)
    sess = meta['tmux']
    if tmux_alive(sess) and not pane_dead(sess):
        sh('tmux', 'send-keys', '-t', pane(sess), '-l', '/exit')
        time.sleep(1.0)
        sh('tmux', 'send-keys', '-t', pane(sess), 'Enter')
        for _ in range(10):
            time.sleep(1)
            if pane_dead(sess) or not tmux_alive(sess):
                break
    if tmux_alive(sess):
        sh('tmux', 'kill-session', '-t', pane(sess), check=False)
    print(f'stopped; session id {meta.get("session_id")} can still be resumed')


def cmd_list(a):
    if not RUNS.exists():
        return
    for d in sorted(RUNS.iterdir()):
        if (d / 'meta.json').exists():
            meta = json.loads((d / 'meta.json').read_text())
            print(f'{meta["name"]:24} {state(meta)[0]:10} {meta.get("session_id") or "-":16} {meta["cwd"]}')


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)

    s = sub.add_parser('start')
    s.add_argument('name')
    s.add_argument('--cwd', required=True, help='the task worktree')
    s.add_argument('--brief', required=True, help='prompt file')
    s.add_argument('--model', default=os.environ.get('DV_MODEL', 'swe-2-max'))
    s.add_argument('--mode', default=default_mode(),
                   choices=['auto', 'accept-edits', 'smart', 'dangerous'])
    s.add_argument('--nice', type=int, default=0)
    s.add_argument('--auto-approve', action=argparse.BooleanOptionalAction, default=wrapped(),
                   help='let `wait` approve sandbox approval menus once (default: on under the cloud wrapper)')
    s.set_defaults(fn=cmd_start)

    for name, fn in (('send', cmd_send), ('resume', cmd_resume)):
        s = sub.add_parser(name)
        s.add_argument('name')
        s.add_argument('text', nargs='*')
        s.add_argument('-f', '--file')
        s.set_defaults(fn=fn)

    s = sub.add_parser('status')
    s.add_argument('name')
    s.add_argument('--lines', type=int, default=25)
    s.set_defaults(fn=cmd_status)

    s = sub.add_parser('wait')
    s.add_argument('name')
    s.add_argument('--timeout', type=int, default=3600)
    s.add_argument('--poll', type=int, default=10)
    s.add_argument('--settle', type=int, default=15, help='seconds idle must hold')
    s.add_argument('--attention', type=int, default=60,
                   help='seconds a question/menu/error screen must stay unchanged before returning')
    s.set_defaults(fn=cmd_wait)

    s = sub.add_parser('report')
    s.add_argument('name')
    s.add_argument('-n', type=int, default=1)
    s.add_argument('--all', action='store_true')
    s.set_defaults(fn=cmd_report)

    for name, fn in (('interrupt', cmd_interrupt), ('stop', cmd_stop), ('approve', cmd_approve)):
        s = sub.add_parser(name)
        s.add_argument('name')
        s.set_defaults(fn=fn)

    s = sub.add_parser('key', help='raw keys, e.g. to answer an approval menu')
    s.add_argument('name')
    s.add_argument('keys', nargs='+')
    s.set_defaults(fn=cmd_key)

    sub.add_parser('list').set_defaults(fn=cmd_list)
    a = p.parse_args()
    a.fn(a)


if __name__ == '__main__':
    main()
