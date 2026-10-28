#!/bin/bash
set -euo pipefail

: "${DEVIN_SESSION_TOKEN:?set DEVIN_SESSION_TOKEN (the devin-session-token\$... login) at the top of the environment setup script}"

bin="$HOME/.local/bin"
mkdir -p "$bin"
export PATH="$bin:$PATH"

if ! command -v devin >/dev/null 2>&1; then
  # The installer ends with an interactive `devin setup`: give it empty stdin, then check.
  inst="$(mktemp)"
  curl -fsSL --max-time 60 https://cli.devin.ai/install.sh -o "$inst" || { echo "devin: cannot reach cli.devin.ai" >&2; exit 1; }
  env -u GIT_SIGN_KEY_B64 -u DEVIN_SESSION_TOKEN timeout 300 bash "$inst" </dev/null >/dev/null 2>&1 || true
  rm -f "$inst"
  command -v devin >/dev/null 2>&1 || { echo "devin: install failed (allow cli.devin.ai and static.devin.ai)" >&2; exit 1; }
fi

real="$(readlink -f "$(command -v devin)")"
if ! grep -q DEVIN_WRAPPER "$real" 2>/dev/null; then
  mv "$real" "$bin/devin-real"
fi
[ -x "$bin/devin-real" ] || { echo "devin-real not found" >&2; exit 1; }

# Login = this one file (the WINDSURF_API_KEY env var alone is not enough: "Login canceled").
mkdir -p "$HOME/.local/share/devin"
( umask 077; cat > "$HOME/.local/share/devin/credentials.toml" <<CRED
windsurf_api_key = "${DEVIN_SESSION_TOKEN}"
api_server_url = "https://server.codeium.com"
devin_webapp_host = "app.devin.ai"
devin_api_url = "https://api.devin.ai"
CRED
)

mkdir -p "$HOME/.config/devin"
[ -f "$HOME/.config/devin/config.json" ] || cat > "$HOME/.config/devin/config.json" <<'CFG'
{"version":1,"agent":{"model":"swe-2-max","preferred_family_models":{"swe-2":"swe-2-max"}}}
CFG

if [ "$(uname)" = Linux ] && ! { command -v bwrap && command -v socat; } >/dev/null 2>&1; then
  { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq bubblewrap socat; } >/dev/null 2>&1 \
    || echo "devin: could not install bubblewrap/socat; the wrapper will fall back to rules-only mode" >&2
fi

# Deny rules for push / sudo / credentials, and the OTLP endpoint. The Ingest key is not
# needed here: Devin runs as a child process, so the egress proxy adds the Access headers.
python3 - <<'PY'
import json, os
p = os.path.expanduser("~/.config/devin/config.json")
c = json.load(open(p)) if os.path.exists(p) else {"version": 1}
c.setdefault("agent", {"model": "swe-2-max", "preferred_family_models": {"swe-2": "swe-2-max"}})
perm = c.setdefault("permissions", {})
deny = perm.setdefault("deny", [])
for r in ["Exec(git push)", "Exec(sudo)", "Exec(gh)",
          "Read(~/.local/share/devin/**)", "Read(~/.ssh/**)", "Read(~/.gnupg/**)",
          "Write(~/.config/devin/**)", "Write(~/.local/bin/**)", "Write(~/.claude/**)"]:
    if r not in deny:
        deny.append(r)
c["otel"] = {"enabled": True,
             "metrics_endpoint": "https://ingest.homepage.lyjw.llc/api/ingest/agents/otlp",
             "metric_export_interval_ms": 60000}
os.makedirs(os.path.dirname(p), exist_ok=True)
tmp = p + ".tmp"
json.dump(c, open(tmp, "w"), indent=1)
os.replace(tmp, p)
PY

# Runs Devin in the OS sandbox (--sandbox = autonomous mode: no prompts, child processes may
# write only the workspace, the current repo's .git minus hooks/config, and granted Write scopes).
# Claude still calls plain `devin ...` or dv.py.
rm -f "$bin/devin"
cat > "$bin/devin" <<'WRAP'
#!/usr/bin/env bash
# DEVIN_WRAPPER (sandboxed) - written by the lyjwMain setup script.
real="$(dirname "$(readlink -f "$0")")/devin-real"
sub=""
for a in "$@"; do
  case "$a" in
    -*) ;;
    auth|mcp|models|doctor|rules|skills|plugins|cloud|desktop|list|ls|rm|ssh|forward|update|version|migrate|sandbox|setup|uninstall|acp|help) sub="$a"; break ;;
    *) break ;;
  esac
done
[ -n "$sub" ] && exec "$real" "$@"

# Per repo: let sandboxed git write the shared .git dir (worktrees keep it outside the
# workspace) but never its hooks or config; hide the commit-signing key from Devin.
gd="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
sk="$(git config --get user.signingkey 2>/dev/null)"
python3 - "$gd" "$sk" <<'PY'
import json, os, sys
gd, sk = sys.argv[1], os.path.expanduser(sys.argv[2])
p = os.path.expanduser("~/.config/devin/config.json")
c = json.load(open(p))
perm = c.setdefault("permissions", {})
allow, deny = perm.setdefault("allow", []), perm.setdefault("deny", [])
want_allow = [f"Write({gd}/**)"] if gd else []
want_deny = [f"Write({gd}/hooks/**)", f"Write({gd}/config)"] if gd else []
if sk and os.path.isfile(sk):
    want_deny.append(f"Read({sk})")
changed = False
for lst, rules in ((allow, want_allow), (deny, want_deny)):
    for r in rules:
        if r not in lst:
            lst.append(r); changed = True
if changed:
    tmp = f"{p}.{os.getpid()}"
    json.dump(c, open(tmp, "w"), indent=1)
    os.replace(tmp, p)
PY
# Devin cannot read the signing key, so its commits are unsigned; the orchestrator re-signs.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false

pre=()
case " $* " in *" --respect-workspace-trust"*) ;; *) pre+=(--respect-workspace-trust false) ;; esac
probe="$HOME/.cache/devin-wrapper/sandbox"
if [ "$(uname)" = Linux ] && [ ! -f "$probe.ok" ] && [ ! -f "$probe.no" ]; then
  mkdir -p "$(dirname "$probe")"
  if command -v socat >/dev/null && bwrap --ro-bind / / --dev /dev --proc /proc --unshare-all true 2>/dev/null; then
    touch "$probe.ok"
  else
    touch "$probe.no"
  fi
fi
if [ "$(uname)" != Linux ] || [ -f "$probe.ok" ]; then
  case " $* " in *" --sandbox"*) ;; *) pre+=(--sandbox) ;; esac
else
  echo "devin wrapper: OS sandbox unavailable here; running with deny rules only (dangerous mode)" >&2
  case " $* " in *" --permission-mode"*) ;; *) pre+=(--permission-mode dangerous) ;; esac
fi
# Claude Code strips OTEL_* from the commands it runs; without this Devin sends protobuf and ingest answers 400.
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
exec "$real" "${pre[@]}" "$@"
WRAP
chmod +x "$bin/devin"

if [ "$(uname)" = Linux ] && [ ! -e /usr/local/bin/devin ]; then
  ln -s "$bin/devin" /usr/local/bin/devin 2>/dev/null || true
fi

command -v zsh >/dev/null 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y -qq zsh >/dev/null 2>&1 || echo "WARNING: zsh install failed" >&2

"$bin/devin-real" --version
