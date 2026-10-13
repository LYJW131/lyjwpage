---
name: links-as-markdown
description: Always post URLs as markdown links [text](url), never bare URLs next to Chinese full-width punctuation
metadata:
  type: feedback
---

lyjw (2026-10-13 16:01Z): 「以后注意一下」 after a bare preview URL followed by full-width （ got autolinked with the bracket and resolved to NXDOMAIN (PR #251 preview).

**Why:** the chat autolinker treats full-width punctuation (（，。) as part of a bare URL, so the link breaks.

**How to apply:** in every reply/post, write links as `[短名](https://...)`; never put a bare URL in Chinese text. Put this in thread briefs that post preview or deploy links.
