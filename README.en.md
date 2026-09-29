<div align="center">

[中文](./README.md) · **English**

# lyjwpage

**A personal homepage driven by real devices and everyday activity.**

[Visit](https://lyjw.me) · [Mirror for mainland China](https://lyjw131.com) · [Interactive architecture diagram](https://lyjw131.github.io/lyjwpage/)

How-it-works explainer: [中文](https://lyjw131.com/explainer?lang=zh) · [English](https://lyjw.me/explainer?lang=en)

</div>

What I'm listening to, watching and playing, which apps are in use, how my devices are doing: this homepage gathers state scattered across a Mac, an iPhone, a NAS and cloud services onto a single page.

It is both my personal homepage and a personal telemetry system that keeps evolving. This repository holds the site's source code, plus the architecture and implementation from device collection and state aggregation to page rendering.

## What's on the page

| Module | What it shows |
| --- | --- |
| **This Mac and chargers** | The Mac's front app (a few everyday tools get brand marks and animations) and the window title, when it passes the privacy check; port status, voltage, current and power of Anker chargers and power banks. |
| **Watching** | What's playing on Emby and recently watched, with progress, episode info, and video and audio specs. |
| **Music** | Apple Music and HomePod playback, recently played, word-by-word lyrics and animated covers; visitors can use the web player and "Listen together" with their own Apple Music account and subscription. |
| **Activity** | Apple Watch Move, Exercise and Stand rings from the iPhone's HealthKit data, plus duration, energy and heart rate of recent workouts. |
| **Server** | Uptime, CPU, memory and network throughput of the exit node, plus traffic accumulated over the billing cycle. |
| **AI Coding** | Token usage of coding tools (merged from Mac logs, Cursor account history and Claude Code cloud telemetry), API-equivalent cost estimates, which agent is in use right now, a yearly heatmap and account limit windows. |
| **Games** | PlayStation online status, game history and trophy progress; expand a game card for per-trophy details. |
| **Pulse** | A factual 24-hour timeline for coding, listening, watching, playing, charging and physical activity: coding split into coding app / agent / both plus a token-rate lane, listening, watching and playing drawn as playing, paused or idle with the track or title, watts for charging, steps and workouts for activity. Hover any segment to see its state and title. |
| **The site itself** | Site version, GitHub repository stats and recent commits (with signature status); 30-day uptime rows for the site and the API, rolling medians of PageSpeed lab scores and a real-visitor performance score; request stats and 12-hour error counts for Vercel and Cloudflare Workers, plus push counts, round-trip latency and live versions of the two resident reporters on the exit node. |

The interface is built on grayscale, hairline borders and cards, with tabular figures keeping live metrics steady. Color and motion mostly serve media, state changes and interaction feedback.

## Screenshots

The homepage is dynamic: cards like now watching, charging or playing only appear while that thing is happening. The images below light up all of those states at once using sample data on a local build, following the system light or dark theme; the animated ones were recorded from the live site.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/overview-dark.webp">
  <img src="docs/screenshots/overview-light.webp" alt="Homepage overview: now watching, charger and power bank, now listening, activity rings with recent workouts, and the exit node lit up at once" width="100%">
</picture>

**Front app in the header**: the middle of the header shows the Mac's current front app, with the icon and name reported by the Mac reporter. A few everyday tools get brand marks instead. Claude Code is the pixel mascot's fetch animation from [mascot-fetch-loop](https://github.com/LYJW131/mascot-fetch-loop): 19 poses rebuilt frame by frame from a screen recording, with the sprite data inlined and played by the site itself ([live preview](https://lyjw131.github.io/mascot-fetch-loop/)). Ghostty is the ASCII ghost from its [homepage](https://ghostty.org/). `scripts/ghostty-frames.mjs` pulls the character frames out of the homepage payload, buckets glyph ink into a few body levels and a few halo levels, and samples frames down to a coarse grid (`src/lib/ghostty-frames.json`; parameters are at the top of the script). The site loops it as SVG paths; the body follows the page's text color while the halo keeps the homepage blue. Cursor and Antigravity use wordmarks from the [LobeHub icon set](https://github.com/lobehub/lobe-icons).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/desktop-marks-dark.gif">
  <img src="docs/screenshots/desktop-marks-light.gif" alt="Four brand marks for the header's front app: the Claude Code mascot fetch animation, the Ghostty ASCII ghost, and the window title under Cursor and Antigravity appearing, changing and disappearing" width="788">
</picture>

The faint line under the app name is the current window title; the Cursor and Antigravity clips show it appearing, changing and disappearing. Only titles that pass the privacy check show up at all; see below.

**Now watching on Emby**: poster, episode, progress, plus video, audio and bitrate specs.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/now-watching-dark.webp">
  <img src="docs/screenshots/now-watching-light.webp" alt="Emby now watching card" width="100%">
</picture>

**Chargers**: per-port power, device and protocol of the Anker charger, plus a total power curve; charge level, charging and discharging, temperature and health of the power bank.

<table>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/charger-dark.gif">
        <img src="docs/screenshots/charger-light.gif" alt="Anker charger card: the reading rolls when total power changes and a new point joins the end of the curve">
      </picture>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/powerbank-dark.webp">
        <img src="docs/screenshots/powerbank-light.webp" alt="Anker power bank card: charge level, dock input, output and ports">
      </picture>
    </td>
  </tr>
</table>

**Now playing on Apple Music**: cover, source device, progress and synced lyrics highlighted word by word, with recently played below.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/now-listening-dark.gif">
  <img src="docs/screenshots/now-listening-light.gif" alt="Apple Music now playing: word-by-word lyrics sweep through a line and move to the next, with recently played below" width="100%">
</picture>

**Activity and workouts**: Apple Watch Move, Exercise and Stand rings with steps, distance and flights climbed; recent workouts on the right, paged sideways.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/activity-dark.gif">
  <img src="docs/screenshots/activity-light.gif" alt="Activity card: readings move from morning to afternoon, the rings turn to new positions and numbers roll, recent workouts on the right" width="100%">
</picture>

**Exit node**: location and carrier, up and down rates, traffic used this billing cycle, plus CPU and memory.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/server-dark.gif">
  <img src="docs/screenshots/server-light.gif" alt="Exit node card: up and down rates, CPU and memory readings roll as they change" width="100%">
</picture>

**AI Coding**: token usage, cost estimates, today's usage and account limit windows for each coding tool. Usage comes from three sources: local logs on the Mac, Cursor's account-side history and Claude Code's cloud telemetry. Sources report raw facts only; totals, rankings, today and the yearly cells are computed once in the state core (an agent with account-level history counts only that, otherwise sources add up). Whether an agent is in use comes from its latest usage event, so the cloud and Cursor lights stay on while the Mac sleeps; when a source fails to collect, the reading is marked Partial instead of treating the missing part as zero.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/vibecoding-dark.gif">
  <img src="docs/screenshots/vibecoding-light.gif" alt="AI Coding card: combined usage across sources, active tools and account limits; tokens and cost roll as usage increases" width="100%">
</picture>

**PlayStation**: online status, the game being played, trophy stats and recent unlocks; expand a game card for trophy groups and each trophy.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/playstation-trophies-dark.webp">
  <img src="docs/screenshots/playstation-trophies-light.webp" alt="PlayStation card: online, now playing and expanded trophy details" width="100%">
</picture>

**Pulse**: a factual timeline of what I was doing over the last 24 hours. Coding is a three-colour band: a coding app in front, only an agent running, or both at once; below it, the Tokens lane plots fresh tokens per minute summed over the three sources (cache reads excluded). Listening, watching and playing show playing / paused / idle (in game / online / offline) along with the track, show or game at the time; charging plots measured watts; physical activity plots steps from closed five-minute HealthKit buckets, with completed workouts drawn as labelled spans. Time with no observation stays empty, distinct from observed idle. Music played on an iPhone or similar device only leaves a trace in the recently played list, with no exact time, so it is drawn as a hatched span of uncertainty. The right column holds the day's facts (coding time and how much of it had an agent running, time playing and track count, peak and current token rates, peak charging power and energy, steps). Only raw values are stored; levels and colours are computed at display time. Jev scores only coding, in fifteen-minute windows, and its intensity and mode appear in the hover. The facts are archived to D1 every minute. Hover, click or arrow-key onto a segment to see its time range, state and title.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/pulse-detail-dark.webp">
  <img src="docs/screenshots/pulse-detail-light.webp" alt="Pulse card: factual timelines including token rates, with daily summaries; hovering a listening segment shows its time range, state and the track playing then" width="100%">
</picture>

**The site itself (LYJWPAGE)**: repository stats, contributors and recent commits. Below that, two status-page-style uptime rows: `lyjw.me` follows Sentry's uptime check, and `API` follows the heartbeat of the api Worker's minute cron, each with 30 daily cells and an availability figure. Further down are the PageSpeed lab score and the real-visitor Users score, 12-hour requests, CPU and error counts per service, and push counts, round-trip latency and live versions of the two resident reporters on the exit node.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/site-status-dark.webp">
  <img src="docs/screenshots/site-status-light.webp" alt="LYJWPAGE card: repository stats and commits, 30-day uptime rows for lyjw.me and API, performance scores, and 12-hour metrics for services and reporters" width="100%">
</picture>

## Architecture

The system has three parts: **collectors adapt to each source, Cloudflare manages state in one place, and Next.js renders the page.**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/architecture-dark.png">
  <img src="docs/architecture-light.png" alt="Architecture: multi-device collectors, the Cloudflare state hub and the Next.js frontend" width="100%">
</picture>

[Open the interactive architecture diagram](https://lyjw131.github.io/lyjwpage/)

**Collectors** run where the data is produced. The Mac collects local apps, music, BLE devices and coding usage; the iPhone reads activity; the NAS relays Emby playback; Linux reporters provide server metrics, agent limits and Cursor usage, and Claude Code's cloud environment reports through its built-in telemetry. Home Assistant brings in HomePod and other home devices; PlayStation, Apple Music recently played, and external data from GitHub, Vercel, Cloudflare, Sentry and PageSpeed are pulled on a schedule by the collector Worker.

**The state hub** is Cloudflare Workers: it receives reports, merges data from external services, and serves the public status API and live push. Reports first reach a stateless ingress Worker: behind Cloudflare Access it verifies each reporter's identity, validates and normalizes the payload, then splits it by data layer — the realtime half goes over a Service Binding to the state core (the api Worker, which owns the Durable Objects), while the lag layer, the archive and credentials are written by the ingress itself. Changing validation only redeploys the ingress; the state core keeps running and pages keep their push connections. Durable Objects SQLite holds the realtime layer's snapshots and history and is the single source of truth. Display-only data that may lag a few minutes (external service stats, the exit node, plan limits and so on) is written straight into a KV lag layer by its producers; every entry carries its update time, and the browser decides against each card's threshold whether it is stale. R2 stores images such as posters, D1 archives workouts, activity rings, limits, hourly server summaries, coding usage and Pulse's factual timeline, and the live-push WebSocket also counts online visitors.

**The frontend** runs on Vercel. Next.js reads each card's status endpoint from the Worker when building the homepage; once mounted, the browser connects straight to the Worker for the latest state, and Vercel no longer relays status requests. The mainland China entry point accelerates pages and static assets through Alibaba Cloud ESA.

## Key design choices

### First-paint snapshots and live updates are handled separately

The homepage reads each module's endpoint in parallel, one Next.js `use cache` entry per card, so the first paint doesn't depend on the browser requesting each card. Realtime cards read the state core and lag-tolerant cards read KV; none of them calls an external API on the request path, so one slow card can't hold up the whole first paint.

After load, each realtime card re-validates once and then follows pushes and polling; lag-tolerant cards keep the first-paint copy and fetch again just after the writer's next expected write (cadence registered as `cadenceMs` in `src/lib/status-views.ts`, scheduling in `src/lib/poll-schedule.ts`). The homepage cache is invalidated by tag and rebuilt in the background only when the layout changes (a card appears or disappears, changes form or changes row count; criteria in `src/lib/home-layout.ts`). Content changes such as readings, titles and progress are left to the first-screen cache's scheduled rebuild (`cacheLife` in `src/lib/first-screen.ts`), and bare heartbeats never trigger one.

So the cached page takes care of the first paint and the client catches up to the current state; the full HTML doesn't need refreshing on every device change.

### Push, polling and local extrapolation each have their job

Events like changing songs, switching front apps and plugging devices in are pushed over WebSocket. Most events carry the new data and write it into the SWR cache, so visitors don't each fire the same query after a notification.

Continuous metrics such as power curves and cumulative usage are polled as needed, while playback progress is extrapolated in the browser from time anchors. While the push connection is healthy, realtime cards whose pushes carry the whole payload keep only a safety-net poll (`PUSH_SAFETY_NET_MS` in `src/lib/poll-schedule.ts`); when it drops they go back to the card's own fast interval, with one refetch right after reconnecting. A freshness check on the client stops an older polling result from overwriting newer state it already received.

### Sources share state while keeping failure boundaries

Device protocols and third-party APIs are adapted by their own collectors; the page consumes one public state model and never depends directly on services inside the home network.

State read-modify-writes are merged serially and persisted inside the Durable Object. When one source is unavailable, the shared status response degrades just that card instead of making the whole page wait for every device.

Writing reports requires authentication, public queries return only explicit display models, and server credentials are kept apart from public state.

### The site and the Workers deploy separately, so a stale tab degrades one card at a time

Workers and the site deploy independently, and a browser tab can sit open for hours or days, so old scripts sometimes read data in a new shape. Every card sits inside its own error boundary (`src/components/card-boundary.tsx`, built on Next's `catchError`): when one card throws while rendering, only that slot falls back to "Unavailable" and reports to Sentry tagged with the card (once per card and error per episode), while the rest of the page carries on. The fallback has a Retry button and, when the page is not stale, retries on its own a few times (delays in `RECOVERY_DELAYS_MS` in `src/lib/card-recovery.ts`, waiting for the tab to come back to the foreground if it is hidden); before retrying it clears the SWR entries the card reads, because remounting on top of the data that made it crash would throw again during render before any refetch could run. When the page knows it is stale (`/api/version`, plus the `version` push once a new deployment lands), a background tab reloads itself onto the new build. In the foreground it only prompts (the update card at the top, a note on the fallback card) and never reloads on its own, so one failing card cannot interrupt what the visitor is doing elsewhere; only a whole page replaced by the error page reloads in the foreground. Each target version is tried at most `AUTO_RELOAD_MAX_TRIES` times per round, tracked per target rather than only for the last one (the home HTML on `lyjw131.com` is cached by ESA and may still be old after a reload, and the version endpoint may flip between two builds); a target that used up its tries has to wait `AUTO_RELOAD_RETRY_AFTER_MS` before its count resets, so it can still be reached once the edge cache recovers; two automatic reloads in one tab are at least `AUTO_RELOAD_COOLDOWN_MS` apart (all these constants live in `src/lib/app-version.ts`; if the system clock was set back, the cooldown restarts from now), and the page never reloads while the player is playing music. The decision lives in `autoReloadDecision` in `src/lib/app-version.ts`.

### Window titles pass a check before they are reported

The window title is the only piece of window content on the page, and the only one that can't be covered by exhaustive rules: there are only so many app names, but a title is whatever file, web page or chat is open right now. So before it leaves the Mac it goes through a privacy check. [TypeSafe](https://www.typesafe.ai/)'s Jev takes part in deciding whether it can be public, and cases it isn't sure about are left for me to decide on the Mac; only titles that are let through make it into the report envelope. The site side doesn't judge anything; it only looks at whether the envelope carries a title.

### Cost follows activity and visitors

Some collectors adjust how often they report based on device activity and visitor connections, and browser tabs pause status polling while hidden. WebSockets use the Hibernation API, so connections stay open without keeping an instance running when there are no events.

Live push connections and the visible-visitor count are tracked separately: the former is about keeping state in sync, the latter about how many people are looking at the page right now.

### Images are content-addressed, and the visitor's domain decides which edge delivers them

Posters and app icons are compressed once by the reporter and uploaded straight to R2 as `<sha256>.<ext>`; state only stores the object key. The Worker and the site turn the object key into the same-origin path `/img/<object key>`, so no delivery domain appears in pages, the status API or pushes.

On `lyjw.me`, a rewrite in `next.config.ts` proxies `/img/*` to R2's public origin (`R2_PUBLIC_BASE_URL`, configured only on Vercel): Vercel's edge forwards and caches by R2's `immutable` header without going through a Function. On `lyjw131.com`, ESA caches the same path by static suffix and goes back to the origin, so visitors in mainland China no longer connect to Cloudflare directly. Objects carry a one-year immutable cache and the address is the content fingerprint, so neither edge ever needs purging.

### Errors and performance go to Sentry

The site (browser and Vercel functions), the `api` Worker (requests, the minute cron and both Durable Objects) and the collector Worker (its scheduled jobs, each with a cron monitor `collector-<job>`) each report to their own Sentry project; the ingress Worker reports to the `api` project with a `worker: ingress` tag. The browser reports through the same-origin `/relay`, so visitors with ad blockers or no route to sentry.io still get through; Session Replay is a separate chunk loaded only after the page goes idle, and keeps only the part with the error. The minute cron reports a heartbeat on a schedule, and `lyjw.me` gets an uptime check. Sampling is set to fit the free tier; entry points are [`src/lib/sentry.ts`](./src/lib/sentry.ts), [`workers/api/src/sentry.ts`](./workers/api/src/sentry.ts), [`workers/ingress/src/sentry.ts`](./workers/ingress/src/sentry.ts) and [`workers/collector/src/sentry.ts`](./workers/collector/src/sentry.ts). Local development doesn't report by default; to try it, set `NEXT_PUBLIC_SENTRY_DEV=true` in `.env.local`.

Data in Sentry also comes back to the page: using a read-only token, the collector Worker fetches on a schedule the error counts of the site and of the backend (the `api` and collector Worker projects combined), real-visitor Web Vitals, uptime checks and cron heartbeats, and writes them to the lag-tolerant KV layer for the site card (`/api/status/sentry`). Uptime has two rows: the `lyjw.me` row checks a static route on Vercel, which only shows the frontend is still serving pages; the `API` row follows the cron heartbeat, where every run passes through the Worker, the Durable Object and KV, covering the backend side. When investigating production errors, agents first gather evidence through the Sentry MCP before reading code; the rules are in [`AGENTS.md`](./AGENTS.md).

## Tech stack

| Layer | Main technologies |
| --- | --- |
| Pages and types | Next.js 16 App Router · React 19 · TypeScript |
| Styling and interaction | Tailwind CSS 4 · Motion · Number Flow · Geist |
| Client data | SWR · WebSocket |
| State and asset storage | Cloudflare Workers · Durable Objects SQLite · KV · D1 · R2 |
| Activity scoring | TypeSafe System One (Jev) |
| Native device integration | Swift / SwiftUI · HealthKit · BLE |
| Hosting and delivery | Vercel · Alibaba Cloud ESA |
| Error and performance monitoring | Sentry |

## Where to start reading

| If you want to know | Start here |
| --- | --- |
| How the homepage assembles its modules | [`src/app/page.tsx`](./src/app/page.tsx) · [`src/components/live/`](./src/components/live/) |
| How the first paint reads and caches state per card | [`src/lib/first-screen.ts`](./src/lib/first-screen.ts) |
| How status views are registered on both sides | [`src/lib/status-views.ts`](./src/lib/status-views.ts) · [`src/lib/status-loaders.ts`](./src/lib/status-loaders.ts) |
| How push and polling update the same client state | [`src/hooks/use-live-events.ts`](./src/hooks/use-live-events.ts) · [`src/hooks/use-status.ts`](./src/hooks/use-status.ts) · [`src/lib/status-reads.ts`](./src/lib/status-reads.ts) |
| How the web player and lyrics work | [`src/hooks/use-web-player.ts`](./src/hooks/use-web-player.ts) · [`src/hooks/use-lyrics.ts`](./src/hooks/use-lyrics.ts) |
| How reports are authenticated, validated and split by data layer | [`workers/ingress/`](./workers/ingress/) |
| How state storage, live push and the public API are organized | [`workers/api/`](./workers/api/) |
| How each device and service is connected | [`reporters/`](./reporters/) · [`workers/collector/`](./workers/collector/) |
| How online visitors are counted | [`workers/api/src/live-census.ts`](./workers/api/src/live-census.ts) · [`src/hooks/use-live-events.ts`](./src/hooks/use-live-events.ts) |

The Mac collector [MacTelemetryHub](https://github.com/LYJW131/MacTelemetryHub) is maintained separately and included as a Git submodule at `reporters/mac-telemetry-hub/`.

## Further reading

The following documents are in Chinese.

[Telemetry and live state subsystems](./docs/telemetry-subsystems.md) covers how each data source is connected, its protocol and its implementation.

[Worker data backend and first-paint cache](./docs/state-storage.md) explains how state persistence, the realtime and lag layers, public data boundaries, cache invalidation and page updates relate.

The iPhone collector [iPhone Telemetry Hub](./reporters/iphone-telemetry-hub/README.md) (native SwiftUI on iOS 27) reports activity rings and recent workouts; for the protocol and rollout order, see its README and the [API Worker](./workers/api/README.md#最近训练) docs.
