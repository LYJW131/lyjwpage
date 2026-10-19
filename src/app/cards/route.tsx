import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";

import { GodChat } from "@/components/god-chat";
import { ActivityCard } from "@/components/live/activity-card";
import { AgentStatusCard } from "@/components/live/agent-status-card";
import { ChargerCard } from "@/components/live/charger-card";
import { DigestCard } from "@/components/live/digest-card";
import { ListeningCard } from "@/components/live/listening-card";
import { NowWatchingCard } from "@/components/live/now-watching-card";
import { PlaystationBlock } from "@/components/live/playstation-block";
import { PowerBankCard } from "@/components/live/powerbank-card";
import { PulseCard } from "@/components/live/pulse-card";
import { ServerCard } from "@/components/live/server-card";
import { SiteStatusCard } from "@/components/live/site-status-card";
import { VibeCodingCard } from "@/components/live/vibecoding-card";
import { WorkoutsStrip } from "@/components/live/workouts-strip";
import { RenderClock } from "@/hooks/use-mounted-at";
import { artworkPlaceholders } from "@/lib/artwork-placeholder";
import { inlineChargerIcon } from "@/lib/charger-icon-inline";
import { imageWidthBucket } from "@/lib/image-proxy";
import { playstationImage } from "@/lib/playstation-image";
import { FIRST_SCREEN_UNAVAILABLE, type FirstScreen } from "@/lib/first-screen";
import { NO_STORE } from "@/lib/site-policy";
import { timezoneAbbreviation } from "@/lib/timezone-display";
import { siteContext, type SiteServices } from "@/server/site-context";
import { stampNow } from "@shared/fixture-time";
import { chargingFeedClockStale, liveChargingFeed } from "@shared/freshness";
import { chargerActive, liveTrack, powerBankActive } from "@shared/home-layout";
import { site as siteConfig } from "@shared/site";
import type { StatusViewKey } from "@shared/status-views";
import type { StatusResponse, TrophiesSummaryPayload } from "@shared/types";

import chargerFixture from "../../../workers/core/dev-fixtures/charger-macbook-iphone.json";
import listeningFixture from "../../../workers/core/dev-fixtures/listening-now-yoasobi.json";
import powerBankFixture from "../../../workers/core/dev-fixtures/powerbank-charging.json";
import serverFixture from "../../../workers/core/dev-fixtures/server-traffic.json";
import watchingFixture from "../../../workers/core/dev-fixtures/watching-now.json";
import cardsCss from "./readme-cards.css?inline";

import type { Route } from "./+types/route";

// GitHub 经 camo 代取 README 图片并按这个头缓存；与 workers/core/src/week-card.ts#WEEK_CARD_CACHE_CONTROL 同档。
const CARD_CACHE_CONTROL = "public, max-age=600, stale-while-revalidate=3600";

// 首页在 1280 视口下的内容宽（max-w-5xl）与半卡宽（两列间 gap-3）；宽度断点按内容宽定死成桌面布局。
const FULL_WIDTH = 1024;
const HALF_WIDTH = (FULL_WIDTH - 12) / 2;
// 硬阴影向右下偏移，画布留出这一圈。
const SHADOW_PAD = 4;
// 须与 src/components/live/media-pair.tsx#SLOT_PX 同步：充电头、充电宝与正在听那一排的槽高。
const MEDIA_SLOT_PX = 396;

type Theme = "light" | "dark";
type Status = <K extends StatusViewKey>(key: K) => Promise<FirstScreen<K>>;
type Rendered = { element: ReactElement; sample: boolean };
type ReadmeCard = {
  label: string;
  width: number;
  height: number;
  render: (status: Status, site: SiteServices, now: number) => Promise<Rendered>;
};

// 此刻没在发生的状态卡用 dev-fixtures 的夹具补，卡头标 Sample data。
function orSample<K extends StatusViewKey>(
  live: FirstScreen<K>,
  showing: (data: Extract<FirstScreen<K>, { ok: true }>["data"]) => boolean,
  fixture: unknown,
  now: number,
): { value: FirstScreen<K>; sample: boolean } {
  if (live.ok && showing(live.data)) return { value: live, sample: false };
  return { value: stampNow(fixture, now) as FirstScreen<K>, sample: true };
}

const chargingLive = <T extends Parameters<typeof liveChargingFeed>[0]>(feed: T, now: number) =>
  liveChargingFeed(feed, chargingFeedClockStale(feed, now));

const CARDS: Record<string, ReadmeCard> = {
  digest: {
    label: "In Brief",
    width: HALF_WIDTH,
    height: 202,
    async render(status) {
      const [digest, pulse, timezone] = await Promise.all([status("digest"), status("pulse"), status("timezone")]);
      return { element: <DigestCard fallback={digest} pulseFallback={pulse} timezoneFallback={timezone} />, sample: false };
    },
  },
  "now-watching": {
    label: "Now Watching",
    width: FULL_WIDTH,
    height: 179,
    async render(status, _site, now) {
      const { value, sample } = orSample(await status("nowWatching"), (data) => data.nowPlaying != null, watchingFixture, now);
      // 卡片展开时自带的 marginTop 是给首页上一张卡留的缝，单独出图要抵掉。
      return { element: <div style={{ marginTop: -12 }}><NowWatchingCard nowFallback={value} /></div>, sample };
    },
  },
  charger: {
    label: "Charger",
    width: HALF_WIDTH,
    height: MEDIA_SLOT_PX,
    async render(status, site, now) {
      const { value, sample } = orSample(await status("charger"), (data) => chargerActive(chargingLive(data, now)), chargerFixture, now);
      return { element: <ChargerCard fallback={await inlineChargerIcon(site, value)} className="h-full" />, sample };
    },
  },
  powerbank: {
    label: "Power Bank",
    width: HALF_WIDTH,
    height: MEDIA_SLOT_PX,
    async render(status, _site, now) {
      const { value, sample } = orSample(await status("powerBank"), (data) => powerBankActive(chargingLive(data, now)), powerBankFixture, now);
      return { element: <PowerBankCard fallback={value} className="h-full" />, sample };
    },
  },
  "now-listening": {
    label: "Now Playing",
    width: FULL_WIDTH,
    height: MEDIA_SLOT_PX,
    async render(status, site, now) {
      const [listening, live] = await Promise.all([status("listening"), status("nowListening")]);
      const { value: nowListening, sample } = orSample(live, (data) => !data.idle, listeningFixture, now);
      const nowData = nowListening.ok && !nowListening.data.idle ? nowListening.data : null;
      const songId = nowData?.hasLyrics ? nowData.songId : null;
      const artworks = listening.ok ? listening.data.items.map((item) => item.artwork) : [];
      const hero = liveTrack(nowData?.music ?? null)?.artworkUrl ?? null;
      const [placeholders, lyrics] = await Promise.all([
        artworkPlaceholders(site, hero ? artworks : artworks.slice(1), hero ?? artworks[0]),
        songId ? site.lyrics(songId) : Promise.resolve(null),
      ]);
      return {
        element: (
          <ListeningCard
            fallback={listening}
            nowFallback={nowListening}
            lyricsFallback={songId && lyrics ? { songId, lines: lyrics.lines, songwriters: lyrics.songwriters } : null}
            artworkPlaceholders={placeholders}
            className="h-full"
            wide
          />
        ),
        sample,
      };
    },
  },
  chat: {
    label: "Talk to God",
    width: FULL_WIDTH,
    height: 352,
    async render() {
      return { element: <GodChat />, sample: false };
    },
  },
  activity: {
    label: "Activity",
    width: FULL_WIDTH,
    height: 253,
    async render(status) {
      const [activity, workouts] = await Promise.all([status("activity"), status("workouts")]);
      return {
        element: (
          <ActivityCard fallback={activity}>
            <WorkoutsStrip fallback={workouts} />
          </ActivityCard>
        ),
        sample: false,
      };
    },
  },
  server: {
    label: "Exit Node",
    width: FULL_WIDTH,
    height: 292,
    async render(status, _site, now) {
      const { value, sample } = orSample(await status("server"), () => true, serverFixture, now);
      return { element: <ServerCard fallback={value} className="md:col-span-2" />, sample };
    },
  },
  "provider-status": {
    label: "Provider Status",
    width: FULL_WIDTH,
    height: 172,
    async render(status) {
      return { element: <AgentStatusCard fallback={await status("agentStatus")} />, sample: false };
    },
  },
  "vibe-coding": {
    label: "Vibe Coding",
    width: FULL_WIDTH,
    height: 834,
    async render(status) {
      const [coding, codingNow, limits] = await Promise.all([status("coding"), status("codingNow"), status("limits")]);
      return {
        element: <VibeCodingCard fallback={coding} nowFallback={codingNow} limitsFallback={limits} />,
        sample: false,
      };
    },
  },
  playstation: {
    label: "PlayStation",
    width: FULL_WIDTH,
    height: 530,
    async render(status) {
      const [trophies, playing, playingNow] = await Promise.all([status("trophies"), status("playing"), status("playingNow")]);
      return {
        element: (
          <PlaystationBlock
            trophies={trophies as StatusResponse<TrophiesSummaryPayload>}
            playing={playing}
            playingNow={playingNow}
          />
        ),
        sample: false,
      };
    },
  },
  pulse: {
    label: "Pulse",
    width: FULL_WIDTH,
    height: 363,
    async render(status) {
      return { element: <PulseCard fallback={await status("pulse")} />, sample: false };
    },
  },
  "site-status": {
    label: "LYJWPAGE",
    width: FULL_WIDTH,
    height: 938,
    async render(status) {
      const [githubRepo, siteDeployments, cloudflareWorkers, health, server, reporters] = await Promise.all([
        status("githubRepo"),
        status("siteDeployments"),
        status("cloudflareWorkers"),
        status("health"),
        status("server"),
        status("reporters"),
      ]);
      return {
        element: (
          <SiteStatusCard
            githubFallback={githubRepo}
            siteFallback={siteDeployments}
            cloudflareFallback={cloudflareWorkers}
            healthFallback={health}
            serverFallback={server}
            reportersFallback={reporters}
          />
        ),
        sample: false,
      };
    },
  },
};

// 图片里的媒体查询按图片显示宽度算，README 把卡缩到正文宽就会掉进窄屏布局、超出写死的高度；按 FULL_WIDTH 定死断点。
const freezeWidthQueries = (css: string) =>
  css.replace(/@media\s*(not all and\s*)?\(width\s*>=\s*([\d.]+)(px|rem)\)\s*{/g, (_, not, size, unit) => {
    const matches = Number(size) * (unit === "rem" ? 16 : 1) <= FULL_WIDTH;
    return `@media ${matches === !not ? "all" : "not all"}{`;
  });

// 不内嵌字体：camo 回图带 CSP `default-src 'none'`，data: 字体照样被拦，经 GitHub 看到的总是系统等宽字体。
const CSS = freezeWidthQueries(cardsCss.replace(/@font-face\s*{[^}]*}/g, ""));

const unescapeAttribute = (value: string) =>
  value.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

// NumberFlow 的数字在声明式 Shadow DOM 里，XML 文档不解析 <template shadowrootmode>；去掉模板，留下它给的纯文本读数与配套样式。
const flattenNumberFlow = (html: string) => html.replace(/<template\b[^>]*\sshadowrootmode="open"[^>]*>[\s\S]*?<\/template\s*>/g, "");

// HTML 解析器自己认 <svg>，XML 里不写 xmlns 的 <svg> 落进 XHTML 命名空间，图标与图表就整个不画。
const svgNamespaces = (html: string) => html.replace(/<svg\b(?![^>]*\sxmlns=)/g, '<svg xmlns="http://www.w3.org/2000/svg"');

// <img> 里的 SVG 不跑脚本、不取外部资源，内联脚本删掉，图片换成 data URI。
async function inlineImages(html: string, site: SiteServices): Promise<string> {
  const widths = new Map<string, number>();
  for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
    const src = /\ssrc="([^"]+)"/.exec(tag)?.[1];
    if (!src || src.startsWith("data:")) continue;
    widths.set(src, Math.max(widths.get(src) ?? 0, Number(/\swidth="(\d+)"/.exec(tag)?.[1] ?? 0)));
  }
  // 封面原图常比显示尺寸大几倍：光栅图按显示宽度取 2 倍，PlayStation 图床自带缩放参数，其余走图片变体，取不到（不在白名单）再原样内嵌。
  const inlined = await Promise.all(
    [...widths].map(async ([src, width]) => {
      const url = unescapeAttribute(src);
      const sized = width > 0 ? playstationImage(url, width * 2) : url;
      const resized =
        width > 0 && sized === url && !/\.svg(\?|$)/.test(url)
          ? await site.image(url, imageWidthBucket(width * 2), "scale-down")
          : null;
      return [src, resized ?? (await site.asset(sized ?? url))] as const;
    }),
  );
  let out = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "").replace(/\ssrcSet="[^"]*"/g, "");
  for (const [src, data] of inlined) out = out.replaceAll(`"${src}"`, `"${data ?? ""}"`);
  return out;
}

function capturedAt(now: number): string {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: siteConfig.timezone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return `Captured ${time} ${timezoneAbbreviation(now, siteConfig.timezone) ?? ""}`.trimEnd();
}

// 卡片里第一个 label-mono 就是卡头标题。
const annotateTitle = (html: string, note: string) =>
  html.replace(/(<span class="label-mono[^"]*">[^<]*)(<\/span>)/, `$1 · ${note}$2`);

// 没有卡头的卡（每日摘要）把说明放在右上角，分两行避开表盘。
function svgDocument(body: string, card: ReadmeCard, theme: Theme, cornerNote: string | null): string {
  const { label, height } = card;
  const width = card.width + SHADOW_PAD;
  const fullHeight = height + SHADOW_PAD;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${fullHeight}" viewBox="0 0 ${width} ${fullHeight}" role="img" aria-label="${label}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${fullHeight}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" class="${theme === "dark" ? "dark " : ""}font-mono text-foreground antialiased" style="position:relative;width:${card.width}px;height:${height}px;display:flex;flex-direction:column">` +
    `<style><![CDATA[${CSS}]]></style>` +
    `<div style="position:relative;flex:1;display:flex;flex-direction:column">${body}${cornerNote ? `<div class="label-mono text-muted-foreground" style="position:absolute;right:1.25rem;top:1rem;text-align:right">${cornerNote.replace(/^(Captured) /, "$1<br/>")}</div>` : ""}</div>` +
    `</div></foreignObject></svg>`
  );
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const match = /^([a-z-]+)\.svg$/.exec(params.card ?? "");
  const card = match ? CARDS[match[1]] : undefined;
  if (!card) return new Response("Unknown card", { status: 404, headers: { "Cache-Control": NO_STORE } });
  const theme: Theme = new URL(request.url).searchParams.get("theme") === "dark" ? "dark" : "light";
  const site = context.get(siteContext);
  const status: Status = (key) =>
    site.status(key).catch((): FirstScreen<typeof key> => ({ ok: false, error: FIRST_SCREEN_UNAVAILABLE }));
  try {
    const now = Date.now();
    const { element, sample } = await card.render(status, site, now);
    const html = renderToString(<RenderClock value={now}>{element}</RenderClock>);
    const note = sample ? "Sample data" : capturedAt(now);
    const titled = annotateTitle(html, note);
    const body = await inlineImages(svgNamespaces(flattenNumberFlow(titled)), site);
    return new Response(svgDocument(body, card, theme, titled === html ? note : null), {
      headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": CARD_CACHE_CONTROL },
    });
  } catch (error) {
    console.error("[readme-card]", match?.[1], error instanceof Error ? (error.stack ?? error.message) : String(error));
    return new Response("Card unavailable", { status: 503, headers: { "Cache-Control": NO_STORE } });
  }
}
