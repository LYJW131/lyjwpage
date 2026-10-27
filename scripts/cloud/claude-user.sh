#!/bin/bash
timeout 120 npm i -g tokens-cli@latest || true
mkdir -p /root/.claude
curl -fsSL --max-time 30 https://raw.githubusercontent.com/LYJW131/lyjwpage/${LYJW_SETUP_REF:-main}/scripts/cloud/claude-user-settings.json -o /root/.claude/settings.json || true
mkdir -p /root/.claude/skills; for s in /home/user/lyjwpage/.claude/skills/*/; do [ -d "$s" ] && ln -sfn "${s%/}" /root/.claude/skills/; done
mkdir -p /root/.claude/rules; for f in /home/user/lyjwpage/.claude/rules/*.md; do [ -f "$f" ] && ln -sf "$f" /root/.claude/rules/; done; true
