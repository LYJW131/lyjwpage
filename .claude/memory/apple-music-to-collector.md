---
name: apple-music-to-collector
description: Apple Music moved from api into collector in 3 PRs (#210, #212, #213, all merged and deployed 2026-10-13); api's copy of APPLE_MUSIC_PRIVATE_KEY deleted on lyjw's OK, api now has no secrets
metadata:
  type: project
---

lyjw chose (2026-10-12) to move the whole Apple Music block (lookups, MusicKit token, ingest enrichment, developer token) into collector so api holds no secrets; tapped "现在开始" 2026-10-13. Research: /mnt/project-files/same-origin-api/apple-music.md.

Split (callee first), all merged and deployed 2026-10-13:
1. #210 (823a4e3): shared code + collector entrypoints (`Collector.enrichTrack` / `followUpTrack`; default fetch is a gateway that calls the cached `AppleLookups` entrypoint through the self-binding `APPLE_LOOKUPS`, Workers Caching only there). Collector binds prod `APPLE_CACHE` and self-signs its developer token. api adds `StateCore.commitEnrichmentPatch`.
2. #212 (6473759): ingress enriches via `COLLECTOR` before `CORE.commitIngest`, follow-up via waitUntil; site sends `shared/apple-music-paths.ts#APPLE_MUSIC_HTTP_PATHS` and SSR lyrics to collector via `COLLECTOR_SERVICE`. Verified in prod: two `Collector.jsrpc` calls per track change, then a lyrics prefetch.
3. #213 (3b82686, deployed 07:51Z): api lost its Apple code, preview proxy, Apple vars and the `CREDENTIALS` / `APPLE_CACHE` bindings; `appleDeveloperToken` stays in the add-only contract and throws; dev-router sends Apple paths to collector. `api.homepage.lyjw.llc/api/lyrics` now 404. When collector is unreachable, ingress commits unenriched and api keeps the same-track stored enrichment (no api fallback). iOS is reporter-only ([[ios-reporter-only]]).

Branch previews never had working music paths: production api and collector `ALLOWED_ORIGINS` exclude `*.lyjw.workers.dev`, and the old api preview proxy also 403'd SSR (no Origin). Devin and Codex flagged it on #213; declined as out of scope (would mean widening collector's prod allowlist).

Collector secret APPLE_MUSIC_PRIVATE_KEY set 2026-10-12 (piped, [[credentials-pipe-only]]). api's copy was deleted by name 2026-10-13 07:57Z after lyjw tapped 删掉 on a card (Cloudflare API `DELETE .../workers/scripts/api/secrets/APPLE_MUSIC_PRIVATE_KEY`, value never read); api has no secrets now. Doc follow-up PR #214 (merged 2026-10-13 as 2d190d8; docs only, no Worker builds) updated docs/ops-facts.md and docs/telemetry-subsystems.md. The series continues with domain retirement in [[same-origin-api-assessment]], which waits on lyjw's go-ahead.

**Why:** the move's goal was that api holds no secrets; a secret delete is irreversible from here (the value is only on lyjw's Mac), so it waited for lyjw.
**How to apply:** don't re-add Apple bindings or secrets to api; the key lives only on collector. Deleting a Worker secret by name auto-deploys a new version with the same code (triggered_by `secret`), which does not disturb Workers Builds.
