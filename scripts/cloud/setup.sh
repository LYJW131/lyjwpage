#!/bin/bash
timeout 120 npm i -g tokens-cli@latest || true
mkdir -p /root/.claude
curl -fsSL --max-time 30 https://raw.githubusercontent.com/LYJW131/lyjwpage/main/scripts/cloud/claude-user-settings.json -o /root/.claude/settings.json || true
for d in skills agents; do [ -d /home/user/lyjwpage/.claude/$d ] && [ ! -e /root/.claude/$d ] && ln -s /home/user/lyjwpage/.claude/$d /root/.claude/$d; done; true
