---
name: claude-reset-card-api
description: Claude banked reset cards are in /api/oauth/usage?cedar_ember=1 but gated by client surface; agents-reporter can't read them, and we don't spoof the CLI
metadata:
  type: project
---

Checked 2026-10-22 SGT in thread「@claudeai 最新一组推文」. Claude Code 2.1.308 reads banked reset cards from `GET /api/oauth/usage?cedar_ember=1&skip_spend=1` (block `cedar_ember.grants[]` with `resets_left`, `ends_at`, `clears`, `usable_now`). It spends a card with `POST /api/organizations/<org>/reset_rate_limits`. Never call that endpoint.

lyjw ran the read in the agents-reporter container on misaka-jp. It returned 200 with `cedar_ember.eligible: false` and `ineligible_reason: "surface"`, so `grants` was empty, even though lyjw holds a card that expires Dec 1 (the Duet waitlist gift). `juniper_tide` (the session-limit reset) comes back only with `?at_wall=1`, and it is also ineligible for the same reason.

**Why:** the server gates the field by calling client. Getting it would mean impersonating the official CLI, which Claude declined to do.
**How to apply:** don't re-propose reporting reset cards unless Anthropic opens the field to plain OAuth calls; then adding `?cedar_ember=1` in `reporters/agents-reporter/src/providers/claude.ts#fetchClaudeUsageBody` is enough. Auto mode blocks credential reads on the Mac and on misaka; lyjw doesn't want to paste commands, so offer a prompt lyjw can hand to a local Claude Code instead.
