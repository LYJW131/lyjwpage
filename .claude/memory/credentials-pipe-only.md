---
name: credentials-pipe-only
description: New or rotated secrets are created and loaded by Claude on the owner's Mac via the rotate-secret skill + pipes; never ask the owner to paste a value
metadata:
  type: feedback
---

The owner has a mature credential flow on their Mac and does not want threads asking them to paste or create secrets by hand (2026-10-14: "我mac上有一套非常成熟的agent处理凭据流程 我授权你处理凭据的情况下 凭据本身是不会进到我们上下文的").

The flow, all on the Mac (Remote Control thread or session, see `.claude/skills/lyjwpage-mac-session/SKILL.md`):
- `~/.claude/skills/rotate-secret/SKILL.md` (user-level skill, only visible to sessions on the Mac). New values are generated in the provider's console through the owner's logged-in Chrome (Claude in Chrome): click Copy or let the browser download the file, never read page text or screenshot the value. Locally generated secrets use `openssl rand` in the same pipe.
- Value goes clipboard/file → stdin → sink: `pbpaste | pnpm exec wrangler secret put NAME -c wrangler.toml`, `gh secret set NAME < file`. Check only prefix and length, then `pbcopy < /dev/null` and move downloaded key files to Trash. Never put a value in argv, `cat`, echo or logs.
- Values already in 1Password are injected with `op run --env-file=<file of op:// refs> -- <cmd>` (pattern: `~/bin/ha`); op masks them in output. Web sign-ins use 1Password for Claude (request_credentials / autofill_credential); the owner approves in 1Password.
- Preconditions: Worker `secret put` needs latest version == deployed version (`wrangler versions list` vs `deployments list`). Verify by listing secret names only. Retire the old key only after the new one is verified: disable it where the provider has a disabled state; GitHub App private keys and PATs have none, so delete or revoke those.

**Why:** transcripts must never contain secret values, and the owner finds pasting secrets tedious.
**How to apply:** when a task needs a new or rotated credential, ask the owner once for a go-ahead naming each key and its scope, then do it yourself on the Mac with this flow. Auto mode may block the write: the owner approves the prompt, or runs the exact command with a `!` prefix.
