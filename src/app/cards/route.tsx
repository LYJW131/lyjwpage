import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { SWRConfig } from "swr";

import { ContactCard } from "@/components/contact-card";
import { GodChat } from "@/components/god-chat";
import { ActivityCard } from "@/components/live/activity-card";
import { AgentStatusCard } from "@/components/live/agent-status-card";
import { ChargerCard } from "@/components/live/charger-card";
import { CloudflareOutageRow } from "@/components/live/cloudflare-outage-row";
import { DigestCard } from "@/components/live/digest-card";
import { FocusNowCard } from "@/components/live/focus-now-card";
import { ListeningCard } from "@/components/live/listening-card";
import { NowWatchingCard } from "@/components/live/now-watching-card";
import { PlaystationBlock } from "@/components/live/playstation-block";
import { PowerBankCard } from "@/components/live/powerbank-card";
import { PulseCard } from "@/components/live/pulse-card";
import { QuestNowCard } from "@/components/live/quest-now-card";
import { ServerCard } from "@/components/live/server-card";
import { SiteStatusCard } from "@/components/live/site-status-card";
import { VibeCodingCard } from "@/components/live/vibecoding-card";
import { WorkoutsStrip } from "@/components/live/workouts-strip";
import { PsPlusSprite } from "@/components/trophies/ps-plus";
import { trophyRowKey } from "@/components/trophies/trophy-details";
import { RenderClock } from "@/hooks/use-mounted-at";
import { trophiesTilePath } from "@/lib/paths";
import { githubAvatarDataUri } from "@/lib/github-avatar-inline";
import { artworkPlaceholders } from "@/lib/artwork-placeholder";
import { inlineChargerIcon } from "@/lib/charger-icon-inline";
import { FIRST_SCREEN_UNAVAILABLE, type FirstScreen } from "@/lib/first-screen";
import { NO_STORE } from "@/lib/site-policy";
import { timezoneAbbreviation } from "@/lib/timezone-display";
import { siteContext, type SiteServices } from "@/server/site-context";
import { stampNow } from "@shared/fixture-time";
import { AGENT_STATUS_STALE_MS, chargingFeedClockStale, liveChargingFeed } from "@shared/freshness";
import { chargerActive, liveTrack, powerBankActive } from "@shared/home-layout";
import { site as siteConfig } from "@shared/site";
import type { StatusViewKey } from "@shared/status-views";
import type { AgentStatusPayload } from "@shared/agent-status-types";
import type { StatusResponse, TrophiesSummaryPayload } from "@shared/types";

import cloudflareOutageFixture from "../../../workers/core/dev-fixtures/agent-status-cloudflare-outage.json";
import chargerFixture from "../../../workers/core/dev-fixtures/charger-macbook-iphone.json";
import focusFixture from "../../../workers/core/dev-fixtures/focus-now-sleep.json";
import questFixture from "../../../workers/core/dev-fixtures/quest-now-playing.json";
import listeningFixture from "../../../workers/core/dev-fixtures/listening-now-yoasobi.json";
import powerBankFixture from "../../../workers/core/dev-fixtures/powerbank-charging.json";
import serverFixture from "../../../workers/core/dev-fixtures/server-traffic.json";
import watchingFixture from "../../../workers/core/dev-fixtures/watching-now.json";
import cardsCss from "./readme-cards.css?inline";
import { inlineImages, inlineQuestCover } from "./inline-images";

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
const FOCUS_HEIGHT = 46;
const OUTAGE_HEIGHT = 74;
const DIGEST_HEIGHT = 202;
const QUEST_HEIGHT = 98;

type Theme = "light" | "dark";
type Status = <K extends StatusViewKey>(key: K) => Promise<FirstScreen<K>>;
// still：内容不随时间变（聊天卡），不标抓取时间。
type Rendered = { element: ReactElement; sample: boolean; still?: boolean };
type ReadmeCard = {
  label: string;
  width: number;
  height: number;
  // 并排的半卡：README 里两张图各占一半、中间不留空，左卡右侧补卡间距，右卡左侧补，右缘与整卡对齐。
  pair?: "left" | "right";
  annotate?: (html: string, note: string) => string;
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
  "cloudflare-outage": {
    label: "Cloudflare Outage",
    width: FULL_WIDTH,
    height: OUTAGE_HEIGHT,
    annotate: (html, note) => html.replace(/(Some features may not work[\s\S]*?)(<\/span><\/div>)/, `$1 · ${note}$2`),
    async render(status, _site, now) {
      const live = await status("agentStatus");
      const { value, sample } = orSample(
        live,
        // 与 CloudflareOutageRow 的显示条件一致：快照过期或没有起点时横幅不画，改用夹具。
        (data) =>
          now - data.fetchedAt <= AGENT_STATUS_STALE_MS &&
          data.agents.some((agent) => agent.id === "cloudflare" && agent.indicator === "major_outage" && !agent.stale && agent.outageSince != null),
        { ok: true, data: cloudflareOutageFixture },
        now,
      );
      return { element: <CloudflareOutageRow fallback={value as StatusResponse<AgentStatusPayload>} />, sample };
    },
  },
  contact: {
    label: "Contact",
    width: HALF_WIDTH,
    height: DIGEST_HEIGHT,
    pair: "left",
    annotate: (html) => html,
    async render(status, site) {
      const [avatar, chart, year] = await Promise.all([githubAvatarDataUri(site), status("githubChart"), status("codingYear")]);
      return { element: <ContactCard avatarDataUri={avatar} chartFallback={chart} yearFallback={year} />, sample: false };
    },
  },
  digest: {
    label: "In Brief",
    width: HALF_WIDTH,
    height: DIGEST_HEIGHT,
    pair: "right",
    async render(status) {
      const [digest, pulse, timezone] = await Promise.all([status("digest"), status("pulse"), status("timezone")]);
      return { element: <DigestCard fallback={digest} pulseFallback={pulse} timezoneFallback={timezone} />, sample: false };
    },
  },
  "now-watching": {
    label: "Now Watching",
    width: FULL_WIDTH,
    height: 151,
    // 没有卡头，说明接在设备名后面；没有设备时退回状态字后面。
    annotate: (html, note) => {
      const out = html.replace(/(<span class="label-mono min-w-0 truncate normal-case[^"]*"[^>]*>[\s\S]*?)(<\/span>)/, `$1 · ${note}$2`);
      return out === html ? annotateTitle(html, note) : out;
    },
    async render(status, _site, now) {
      const { value, sample } = orSample(await status("nowWatching"), (data) => data.nowPlaying != null, watchingFixture, now);
      // 卡片展开时自带的 marginTop 是给首页上一张卡留的缝，单独出图要抵掉。
      return { element: <div style={{ marginTop: -12 }}><NowWatchingCard nowFallback={value} /></div>, sample };
    },
  },
  focus: {
    label: "Focus",
    width: FULL_WIDTH,
    height: FOCUS_HEIGHT,
    // 勿扰卡没有卡头，说明接在模式名后面。
    annotate: (html, note) => html.replace(/(Do Not Disturb<\/span><span[^>]*>[\s\S]*?)(<\/span>)/, `$1 · ${note}$2`),
    async render(status, _site, now) {
      const { value, sample } = orSample(await status("focusNow"), (data) => data.mode != null, focusFixture, now);
      return { element: <div style={{ marginTop: -12 }}><FocusNowCard nowFallback={value} /></div>, sample };
    },
  },
  quest: {
    label: "Now Playing",
    width: FULL_WIDTH,
    height: QUEST_HEIGHT,
    annotate: (html, note) => html.replace(/(· Meta Quest)(<\/span>)/, `$1 · ${note}$2`),
    async render(status, site, now) {
      const { value, sample } = orSample(await status("questNow"), (data) => data.playing != null, questFixture, now);
      return { element: <div style={{ marginTop: -12 }}><QuestNowCard nowFallback={await inlineQuestCover(site, value)} /></div>, sample };
    },
  },
  charger: {
    label: "Charger",
    width: HALF_WIDTH,
    height: MEDIA_SLOT_PX,
    pair: "left",
    async render(status, site, now) {
      const { value, sample } = orSample(await status("charger"), (data) => chargerActive(chargingLive(data, now)), chargerFixture, now);
      return { element: <ChargerCard fallback={await inlineChargerIcon(site, value)} className="h-full" />, sample };
    },
  },
  powerbank: {
    label: "Power Bank",
    width: HALF_WIDTH,
    height: MEDIA_SLOT_PX,
    pair: "right",
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
      return { element: <GodChat />, sample: false, still: true };
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
    height: 1032,
    async render(status) {
      const [coding, codingNow, limits, history] = await Promise.all([
        status("coding"), status("codingNow"), status("limits"), status("limitsHistory"),
      ]);
      return {
        element: <VibeCodingCard fallback={coding} nowFallback={codingNow} limitsFallback={limits} historyFallback={history} />,
        sample: false,
      };
    },
  },
  playstation: {
    label: "PlayStation",
    width: FULL_WIDTH,
    height: 835,
    // 展开最近一个奖杯所在的游戏，和首页点「Latest」一样：先渲一遍找出展开的那格，取它的奖杯目录作 SWR 兜底再渲。
    async render(status, site, now) {
      const [summary, playing, playingNow] = await Promise.all([status("trophies"), status("playing"), status("playingNow")]);
      const trophies = summary as StatusResponse<TrophiesSummaryPayload>;
      const recent = trophies.ok ? trophies.data.recent[0] : undefined;
      const initialJump = recent
        ? { npCommunicationId: recent.npCommunicationId, trophyKey: trophyRowKey(recent.npCommunicationId, recent.groupId, recent.id) }
        : null;
      // PS Plus 标志用 <use> 引首页 root 里的符号，卡片自带一份。
      const block = (
        <>
          <PsPlusSprite />
          <PlaystationBlock trophies={trophies} playing={playing} playingNow={playingNow} initialJump={initialJump} />
        </>
      );
      const draft = renderToString(<RenderClock value={now}>{block}</RenderClock>);
      const ids = /data-warm-title-ids="([^"]+)"(?:(?!data-warm-title-ids)[\s\S])*?aria-expanded="true"/.exec(draft)?.[1];
      const catalog = ids ? await site.trophies(ids.split(",")) : null;
      return {
        element: catalog ? <SWRConfig value={{ fallback: { [trophiesTilePath(ids!.split(","))]: catalog } }}>{block}</SWRConfig> : block,
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
const CSS = freezeWidthQueries(cardsCss.replace(/@font-face\s*{[^}]*}/g, "")) +
  // 奖杯展开面板的高度在浏览器里量出来再动画过去，SSR 时是 0。
  "#playstation-trophies{height:auto!important}" +
  // 勿扰图标在浏览器里挂载后才上色，静态图直接画上色后的样子。
  ".focus-icon .tint{opacity:1}" +
  // 热力图切换挂在 <html data-heatmap> 上，图片里没有 <html>，按首页默认画 Tokens 那一面。
  '.heatmap-panel[data-heatmap-panel="tokens"]{display:block!important}' +
  '.heatmap-tab[data-heatmap-tab="tokens"]{background-color:var(--muted)!important;color:var(--foreground)!important}';

// NumberFlow 的数字在声明式 Shadow DOM 里，XML 文档不解析 <template shadowrootmode>；去掉模板，留下它给的纯文本读数与配套样式。
const flattenNumberFlow = (html: string) => html.replace(/<template\b[^>]*\sshadowrootmode="open"[^>]*>[\s\S]*?<\/template\s*>/g, "");

// HTML 解析器自己认 <svg>，XML 里不写 xmlns 的 <svg> 落进 XHTML 命名空间，图标与图表就整个不画。
const svgNamespaces = (html: string) => html.replace(/<svg\b(?![^>]*\sxmlns=)/g, '<svg xmlns="http://www.w3.org/2000/svg"');

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

const canvasSize = (card: ReadmeCard) => ({
  width: card.pair ? (FULL_WIDTH + SHADOW_PAD) / 2 : card.width + SHADOW_PAD,
  fullHeight: card.height + SHADOW_PAD,
});

// 没有卡头的卡（每日摘要）把说明放在右上角，分两行避开表盘。
function svgDocument(body: string, card: ReadmeCard, theme: Theme, cornerNote: string | null): string {
  const { label, height } = card;
  const { width, fullHeight } = canvasSize(card);
  const offset = card.pair === "right" ? width - card.width - SHADOW_PAD : 0;
  return (
    // 暗色类挂在 <svg> 上：它是图片里的 :root，`--color-*: var(--*)` 这类别名在 :root 上求值，挂在内层就仍取亮色。
    `<svg xmlns="http://www.w3.org/2000/svg"${theme === "dark" ? ' class="dark"' : ""} width="${width}" height="${fullHeight}" viewBox="0 0 ${width} ${fullHeight}" role="img" aria-label="${label}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${fullHeight}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" class="font-mono text-foreground antialiased" style="position:relative;left:${offset}px;width:${card.width}px;height:${height}px;display:flex;flex-direction:column">` +
    `<style><![CDATA[${CSS}]]></style>` +
    `<div style="position:relative;flex:1;display:flex;flex-direction:column">${body}${cornerNote ? `<div class="label-mono text-muted-foreground" style="position:absolute;right:1.25rem;top:1rem;text-align:right">${cornerNote}</div>` : ""}</div>` +
    `</div></foreignObject></svg>`
  );
}

// WebKit（iOS 的 GitHub App 与 Safari）缩小显示含 foreignObject 的 SVG 时，HTML 仍按原尺寸画、超出部分裁掉；
// 整张卡作为 <image> 套一层，内层按原尺寸渲染，缩放只落在外层图片上。
// WebKit 把显示高度取整后按 meet 等比放进去，矮卡（勿扰）的取整误差占比大，左右就缩进一截；preserveAspectRatio="none" 让它铺满盒子。
function scalableSvg(inner: string, card: ReadmeCard): string {
  const { width, fullHeight } = canvasSize(card);
  const href = `data:image/svg+xml;base64,${Buffer.from(inner).toString("base64")}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${fullHeight}" viewBox="0 0 ${width} ${fullHeight}" preserveAspectRatio="none" role="img" aria-label="${card.label}">` +
    `<image width="${width}" height="${fullHeight}" href="${href}"/></svg>`
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
    const { element, sample, still } = await card.render(status, site, now);
    const html = renderToString(<RenderClock value={now}>{element}</RenderClock>);
    const note = sample ? "Sample data" : capturedAt(now);
    const titled = still ? html : (card.annotate ?? annotateTitle)(html, note);
    const body = await inlineImages(svgNamespaces(flattenNumberFlow(titled)), site);
    return new Response(scalableSvg(svgDocument(body, card, theme, titled === html && sample ? note : null), card), {
      headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": CARD_CACHE_CONTROL },
    });
  } catch (error) {
    console.error("[readme-card]", match?.[1], error instanceof Error ? (error.stack ?? error.message) : String(error));
    return new Response("Card unavailable", { status: 503, headers: { "Cache-Control": NO_STORE } });
  }
}
