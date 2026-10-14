---
name: avatar-watch-restored
description: Owner chose (2026-10-14) to restore avatar-watch + avatar-sync auto-rebuild over runtime avatar fetch; accepts bot commits and credential upkeep
metadata:
  type: feedback
---

PR #169 / commit 37907f6e retired the avatar-watch collector job and the avatar-sync Action. The home avatar became a runtime fetch, cached about 1 to 2 days; favicon and OG update only on the next deploy.

On 2026-10-14 the owner said "我还是喜欢原来的 代价都是可以接受的 恢复吧". PR #298 restores it:
- collector `avatar-watch` hashes the avatar every 5 minutes.
- On a change it dispatches `avatar-sync.yml`.
- The App `LYJW131` then commits `.github/github-avatar.sha256` to main, which rebuilds site.

The site Builds main trigger got `.github/github-avatar.sha256` back in `path_includes`, via the CF API.

**Why:** the owner values the avatar updating everywhere within minutes over fewer moving parts. They accept a bot commit on each avatar change, a rebuild, and credential upkeep.

**How to apply:** don't propose retiring it again for simplicity. Its credentials (collector `GITHUB_DISPATCH_TOKEN`, repo secret `AVATAR_APP_PRIVATE_KEY`) and their current state live only in docs/ops-facts.md; read them there.
