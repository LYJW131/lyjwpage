---
name: tokens-ci-cloud-hook
description: lyjwpage cloud sessions report token usage to tokens.ci via SessionStart/Stop hooks (#626); credential is meant to come from a Network secret
metadata:
  type: project
---

lyjw contributed Claude Code cloud support to missuo/tokens (PR #89, merged 2026-10-23). lyjwpage #626 (merged 2026-10-24 02:50 SGT) adds its hooks to `.claude/settings.json`: SessionStart installs `tokens-cli@latest` in cloud only; Stop runs `TZ=Asia/Singapore TOKENS_API_TOKEN="${TOKENS_API_TOKEN:-egress-proxy}" tokens cloud submit`.

Credential plan (lyjw asked env var vs egress proxy; recommended proxy): Network secret on env `<cloud env>`, host `tokens.ci`, path `/api/submit`, header `Authorization`, prefix `Bearer`. Verified 2026-10-24 that the proxy overwrites an existing placeholder Bearer (openrouter.ai with `Bearer placeholder` → 200).

**Pending:** lyjw adds the secret; then in a fresh cloud session confirm the device "Claude Code cloud" appears on tokens.ci and register the fact in `docs/ops-facts.md`, flip `docs/references.md` entry to 采用.
