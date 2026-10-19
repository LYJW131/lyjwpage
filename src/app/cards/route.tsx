import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";

import { PulseCard } from "@/components/live/pulse-card";
import { ServerCard } from "@/components/live/server-card";
import { SiteStatusCard } from "@/components/live/site-status-card";
import { VibeCodingCard } from "@/components/live/vibecoding-card";
import { RenderClock } from "@/hooks/use-mounted-at";
import { FIRST_SCREEN_UNAVAILABLE, type FirstScreen } from "@/lib/first-screen";
import { NO_STORE } from "@/lib/site-policy";
import { timezoneAbbreviation } from "@/lib/timezone-display";
import { siteContext, type SiteServices } from "@/server/site-context";
import { stampNow } from "@shared/fixture-time";
import { site as siteConfig } from "@shared/site";
import type { StatusViewKey } from "@shared/status-views";

import serverFixture from "../../../workers/core/dev-fixtures/server-traffic.json";
import cardsCss from "./readme-cards.css?inline";

import type { Route } from "./+types/route";

// GitHub 经 camo 代取 README 图片并按这个头缓存；与 workers/core/src/week-card.ts#WEEK_CARD_CACHE_CONTROL 同档。
const CARD_CACHE_CONTROL = "public, max-age=600, stale-while-revalidate=3600";

// 卡宽取首页在 1280 视口下的内容宽（max-w-5xl），宽度断点按它定死成桌面布局。
const CARD_WIDTH = 1024;
// 硬阴影向右下偏移，画布留出这一圈。
const SHADOW_PAD = 4;

type Theme = "light" | "dark";
type Status = <K extends StatusViewKey>(key: K) => Promise<FirstScreen<K>>;
type Rendered = { element: ReactElement; height: number; sample: boolean };

const CARDS: Record<string, { label: string; render: (status: Status) => Promise<Rendered> }> = {
  "vibe-coding": {
    label: "Vibe Coding",
    async render(status) {
      const [coding, codingNow, limits] = await Promise.all([status("coding"), status("codingNow"), status("limits")]);
      return {
        element: <VibeCodingCard fallback={coding} nowFallback={codingNow} limitsFallback={limits} />,
        height: 834,
        sample: false,
      };
    },
  },
  server: {
    label: "Exit Node",
    async render(status) {
      const live = await status("server");
      const sample = !live.ok;
      const server = sample ? (stampNow(serverFixture, Date.now()) as FirstScreen<"server">) : live;
      return { element: <ServerCard fallback={server} className="md:col-span-2" />, height: 292, sample };
    },
  },
  pulse: {
    label: "Pulse",
    async render(status) {
      return { element: <PulseCard fallback={await status("pulse")} />, height: 363, sample: false };
    },
  },
  "site-status": {
    label: "LYJWPAGE",
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
        height: 938,
        sample: false,
      };
    },
  },
};

// 图片里的媒体查询按图片显示宽度算，README 把卡缩到正文宽就会掉进窄屏布局、超出写死的高度；按 CARD_WIDTH 定死断点。
const freezeWidthQueries = (css: string) =>
  css.replace(/@media\s*(not all and\s*)?\(width\s*>=\s*([\d.]+)(px|rem)\)\s*{/g, (_, not, size, unit) => {
    const matches = Number(size) * (unit === "rem" ? 16 : 1) <= CARD_WIDTH;
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
  const sources = [...new Set([...html.matchAll(/<img\b[^>]*?\ssrc="([^"]+)"/g)].map((match) => match[1]))].filter(
    (src) => !src.startsWith("data:"),
  );
  const inlined = await Promise.all(sources.map(async (src) => [src, await site.asset(unescapeAttribute(src))] as const));
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

function svgDocument(body: string, height: number, theme: Theme, label: string): string {
  const width = CARD_WIDTH + SHADOW_PAD;
  const fullHeight = height + SHADOW_PAD;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${fullHeight}" viewBox="0 0 ${width} ${fullHeight}" role="img" aria-label="${label}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${fullHeight}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" class="${theme === "dark" ? "dark " : ""}font-mono text-foreground antialiased" style="position:relative;width:${CARD_WIDTH}px;height:${height}px;display:flex;flex-direction:column">` +
    `<style><![CDATA[${CSS}]]></style>` +
    `<div style="position:relative;flex:1;display:flex;flex-direction:column">${body}</div>` +
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
    const { element, height, sample } = await card.render(status);
    const now = Date.now();
    const html = renderToString(<RenderClock value={now}>{element}</RenderClock>);
    const titled = annotateTitle(html, sample ? "Sample data" : capturedAt(now));
    const body = await inlineImages(svgNamespaces(flattenNumberFlow(titled)), site);
    return new Response(svgDocument(body, height, theme, card.label), {
      headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": CARD_CACHE_CONTROL },
    });
  } catch (error) {
    console.error("[readme-card]", match?.[1], error instanceof Error ? (error.stack ?? error.message) : String(error));
    return new Response("Card unavailable", { status: 503, headers: { "Cache-Control": NO_STORE } });
  }
}
