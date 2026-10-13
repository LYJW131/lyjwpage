---
name: credentials-pipe-only
description: Moving or setting secrets (e.g. Apple .p8 into a Worker secret) happens in a Remote Control session on the user's Mac, piped, never read
metadata:
  type: feedback
---

When a step needs a real credential (the 2026-10-12 case: setting the Apple Music private key `.p8` as a collector Worker secret during the Apple Music move, see [[same-origin-api-assessment]]), do it in a Remote Control session on the user's own computer and never read the credential's content: locate the file by name only (`ls`), then pipe it straight into the sink (e.g. `wrangler secret put APPLE_MUSIC_PRIVATE_KEY -c <config> < <file>`). No `cat`, no echo, nothing that prints the value into the transcript.

**Why:** the user said "在我电脑上开个会话去做 注意不要实际读凭据 一律管道"; transcripts and logs must never contain secret values.
**How to apply:** for any secret move or rotation, start the session on the user's device (folder in the MEMORY.md "Device work" line), pipe only, and verify by listing secret names, not values.
