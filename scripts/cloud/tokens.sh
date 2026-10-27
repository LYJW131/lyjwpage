#!/bin/bash
timeout 120 npm i -g tokens-cli@latest || true
python3 - <<'PY'
import json, os
p = os.path.expanduser("~/.claude/settings.json")
c = json.load(open(p)) if os.path.exists(p) else {}
cmd = 'command -v tokens >/dev/null && TZ=Asia/Singapore TOKENS_API_TOKEN="${TOKENS_API_TOKEN:-egress-proxy}" timeout 30 tokens cloud submit >/dev/null 2>&1; true'
stop = c.setdefault("hooks", {}).setdefault("Stop", [])
if not any(h.get("command") == cmd for e in stop for h in e.get("hooks", [])):
    stop.append({"hooks": [{"type": "command", "command": cmd, "async": True}]})
os.makedirs(os.path.dirname(p), exist_ok=True)
tmp = p + ".tmp"
json.dump(c, open(tmp, "w"), indent=2)
os.replace(tmp, p)
PY
