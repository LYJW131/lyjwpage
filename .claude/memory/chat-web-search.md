---
name: chat-web-search
description: Homepage chat web search: Exa fast only, domain tools, doc MCP servers off, query language rules
metadata:
  type: project
---

Chat web search (#355, merged 2026-10-15 SGT): Exa `fast` only, called directly (not via AI Gateway; Parallel dropped by lyjw); domain tools Bangumi/Steam, deferred via tool search. The four doc MCP servers (Context7/CF docs/grep.app/DeepWiki) were turned off 2026-10-17 SGT (≈2 s latency each turn); restore steps in workers/ai/README.md. Exa queries English only, via tool description only (no domain blocklist; lyjw 2026-10-15). Bangumi stays. Secret and live-check facts: docs/ops-facts.md (EXA_API_KEY row). Mac auto mode blocks opening provider consoles and listing 1Password, so lyjw may have to set new secrets by hand. Clef stays for routing.
