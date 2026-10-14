<div align="center">

[中文](./README.md) · **English**

# lyjwpage

**A personal homepage driven by real devices and everyday activity.**

[Visit](https://lyjw.me) · [Mirror for mainland China](https://lyjw131.com) · [Interactive architecture diagram](https://lyjw131.github.io/lyjwpage/)

How-it-works explainer: [中文](https://lyjw131.com/explainer/?lang=zh) · [English](https://lyjw.me/explainer/?lang=en)

</div>

What I'm listening to, watching and playing, which apps are in use, how my devices are doing: this homepage gathers state scattered across a Mac, an iPhone, a NAS and cloud services onto one page. It is also a personal telemetry system that keeps evolving.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/overview-dark.webp">
  <img src="docs/screenshots/overview-light.webp" alt="Homepage overview: the daily digest, now watching, charger and power bank, now listening, Talk to God, activity rings with recent workouts, and the exit node lit up at once" width="100%">
</picture>

## What's on the page

| Module | What it shows |
| --- | --- |
| **Daily digest** | A tagline and a few readings sum up the last 24 hours, with a 24-hour dial |
| **This Mac and chargers** | The Mac's front app and window title; ports and power of Anker chargers and power banks |
| **Watching / Music** | Now playing on Emby; Apple Music and HomePod with word-by-word lyrics, plus a web player visitors can listen along with |
| **Activity** | Apple Watch rings and recent workouts |
| **Server** | Exit node rates, traffic, CPU, memory and disk |
| **AI Coding** | Token usage per coding tool, cost estimates, the agent in use, a yearly heatmap and limits |
| **Games** | PlayStation online status and trophies |
| **Pulse** | A 24-hour timeline of coding, listening, watching, playing, charging and activity |
| **Provider status** | Official status pages of Claude, ChatGPT, Cursor, GitHub, Cloudflare and more |
| **The site itself** | Repository and commits, 30-day uptime, performance scores, Worker and reporter metrics |
| **Talk to God** | Routes each question to a Claude tier by difficulty; it can read every card's live data, search the web and plan site changes |

The same data is open to AI agents: `https://lyjw.me/mcp` is a public MCP endpoint (Streamable HTTP, no auth).

## Screenshots

Cards only appear while their thing is happening. The images below light up all of them at once with sample data on a local build, following the system light or dark theme. How they are recorded: [docs/screenshots.md](./docs/screenshots.md); card details: [page details and key design choices](./docs/design-notes.md) (Chinese).

**Front app in the header**: Claude Code, Ghostty, Cursor and Antigravity get animated brand marks; a window title shows only after it passes a privacy check.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/desktop-marks-dark.gif">
  <img src="docs/screenshots/desktop-marks-light.gif" alt="Brand marks for the header's front app, and the window title appearing, changing and disappearing" width="788">
</picture>

**Daily digest**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/digest-dark.webp">
  <img src="docs/screenshots/digest-light.webp" alt="Daily digest card: a tagline, coding and agent hours and tokens, with a 24-hour dial" width="530">
</picture>

**Now watching on Emby**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/now-watching-dark.webp">
  <img src="docs/screenshots/now-watching-light.webp" alt="Emby now watching card" width="100%">
</picture>

**Charger and power bank**

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

**Now playing on Apple Music**: word-by-word synced lyrics, with recently played below.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/now-listening-dark.gif">
  <img src="docs/screenshots/now-listening-light.gif" alt="Apple Music now playing: lyrics sweep word by word, recently played below" width="100%">
</picture>

**Talk to God**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/chat-dark.webp">
  <img src="docs/screenshots/chat-light.webp" alt="Talk to God card: sample questions and the input box" width="100%">
</picture>

**Activity and workouts**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/activity-dark.gif">
  <img src="docs/screenshots/activity-light.gif" alt="Activity card: rings and readings change, recent workouts on the right" width="100%">
</picture>

**Exit node**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/server-dark.gif">
  <img src="docs/screenshots/server-light.gif" alt="Exit node card: rates, traffic, CPU, memory and disk" width="100%">
</picture>

**AI Coding**: merged from the Mac's local logs, Cursor account history and Claude Code cloud telemetry.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/vibecoding-dark.gif">
  <img src="docs/screenshots/vibecoding-light.gif" alt="AI Coding card: usage across sources, active tools and account limits" width="100%">
</picture>

**PlayStation**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/playstation-trophies-dark.webp">
  <img src="docs/screenshots/playstation-trophies-light.webp" alt="PlayStation card: online, now playing and expanded trophy details" width="100%">
</picture>

**Pulse**: hover any segment to see the state and title at that time.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/pulse-detail-dark.webp">
  <img src="docs/screenshots/pulse-detail-light.webp" alt="Pulse card: factual timelines with a daily summary; hovering shows a segment's details" width="100%">
</picture>

**Provider status**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/provider-status-dark.webp">
  <img src="docs/screenshots/provider-status-light.webp" alt="Provider status card: the operational state of each service" width="100%">
</picture>

**The site itself**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/site-status-dark.webp">
  <img src="docs/screenshots/site-status-light.webp" alt="LYJWPAGE card: repository stats and commits, 30-day uptime, performance scores and service metrics" width="100%">
</picture>

## Architecture

**Collectors adapt each source, Cloudflare Workers hold the state, and the site Worker (React Router SSR) renders the page.**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/architecture-dark.png">
  <img src="docs/architecture-light.png" alt="Architecture: multi-device collectors, the Cloudflare state hub, the AI Worker for chat and visitor builds, and the site Worker frontend" width="100%">
</picture>

- **Collectors** run where the data is produced: the Mac, iPhone, NAS, Linux reporters, Home Assistant and Claude Code cloud telemetry. External services (Apple Music, GitHub, Cloudflare, PageSpeed) are polled by the collector Worker.
- **State hub**: the ingress Worker checks identity behind Cloudflare Access and validates each report; realtime data goes to the core Worker's Durable Objects, lag-tolerant data to KV, archives to D1 and images to R2.
- **Frontend**: the site Worker renders the home page card by card, then WebSocket pushes and polling keep it current; visitors in mainland China go through Alibaba Cloud ESA.

[Interactive architecture diagram](https://lyjw131.github.io/lyjwpage/) · [Page details and key design choices](./docs/design-notes.md) (Chinese: first-screen caching, push vs. polling, stale-tab degradation, window-title privacy check, image addressing, observability)

## Tech stack

| Layer | Main technologies |
| --- | --- |
| Pages and types | React Router 8 · Vite · React 19 (React Compiler) · TypeScript 7 |
| Styling and interaction | Tailwind CSS 4 · Motion · Number Flow · Geist |
| Client data | SWR · WebSocket |
| State and asset storage | Cloudflare Workers · Durable Objects SQLite · KV · D1 · R2 |
| Activity scoring | Workers AI (Clef) |
| Homepage chat | Anthropic Claude (routed by Clef), Cloudflare Turnstile |
| Native device integration | Swift / SwiftUI · HealthKit · BLE |
| Hosting and delivery | Cloudflare Workers · Alibaba Cloud ESA |
| Error and performance monitoring | Cloudflare Workers Observability · Web Analytics |

## Where to start reading

| If you want to know | Start here |
| --- | --- |
| How the homepage assembles its modules | [`src/app/page.tsx`](./src/app/page.tsx) · [`src/components/live/`](./src/components/live/) |
| How the first paint reads and caches state per card | [`src/lib/first-screen.ts`](./src/lib/first-screen.ts) |
| How status views are registered on both sides | [`shared/status-views.ts`](./shared/status-views.ts) · [`workers/core/src/status-loaders.ts`](./workers/core/src/status-loaders.ts) |
| How push and polling update the same client state | [`src/hooks/use-live-events.ts`](./src/hooks/use-live-events.ts) · [`src/hooks/use-status.ts`](./src/hooks/use-status.ts) · [`src/lib/status-reads.ts`](./src/lib/status-reads.ts) |
| How the web player and lyrics work | [`src/hooks/use-web-player.ts`](./src/hooks/use-web-player.ts) · [`src/hooks/use-lyrics.ts`](./src/hooks/use-lyrics.ts) |
| How reports are authenticated, validated and split by data layer | [`workers/ingress/`](./workers/ingress/) |
| How state storage, live push and the public API are organized | [`workers/core/`](./workers/core/) |
| How homepage chat, MCP and model tools run | [`workers/ai/`](./workers/ai/) |
| How each device and service is connected | [`reporters/`](./reporters/) · [`workers/collector/`](./workers/collector/) |
| How the native iOS app reads the site and reports | [`apps/ios/`](./apps/ios/) |
| How online visitors are counted | [`workers/core/src/live-census.ts`](./workers/core/src/live-census.ts) · [`src/hooks/use-live-events.ts`](./src/hooks/use-live-events.ts) |

The Mac collector [MacTelemetryHub](https://github.com/LYJW131/MacTelemetryHub) is a submodule at `reporters/mac-telemetry-hub/`. For local development, see "本地开发" in [`workers/core/README.md`](./workers/core/README.md).

## Further reading

- [Telemetry and realtime subsystems](./docs/telemetry-subsystems.md): how each source connects and its protocol
- [Worker data backend and first-screen caching](./docs/state-storage.md): storage layers, public data boundary and cache invalidation
- [lyjwpage iOS App](./apps/ios/README.md): native client and iPhone reporter
- [Discord Gateway reporter](./reporters/discord-reporter/README.md): live Quest game data
- [Docs index](./docs/README.md)
