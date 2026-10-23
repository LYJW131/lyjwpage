---
name: chat-tiers
description: Homepage chat model lineups, Turnstile pass, chat log retention (2026-10-18, #387 #391 #385)
metadata:
  type: project
---

Chat tiers (2026-10-18 SGT, #387 #391): visitor picks a lineup, DeepSeek (Small Fry/Prophet = DeepSeek Flash, thinking off/on) or Claude (Haiku/Sonnet); God is Fable; Anthropic consent asked per vendor. Turnstile human pass lasts 7 days. Chat logs kept 30 days in ChatLog (#385), no IP or tokens stored. Source of truth: shared/god-chat-tiers.ts, workers/ai/README.md.

Consent is asked on send, per vendor, in the message's language (#587). The chat system prompt carries a 6-line lyjw profile (#493).
