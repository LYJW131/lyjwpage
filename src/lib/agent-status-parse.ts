/**
 * 把各家状态页收成同一张卡能画的五行。
 *
 * Claude / OpenAI / Cursor 是 Statuspage，`/api/v2/summary.json` 就是当前
 * 组件和未解决事件，边缘缓存大约 10 秒。xAI 没有这份 JSON：官方机器可读源
 * 是 `/feed.xml`，此刻亮哪盏灯写在首页 HTML 里。DeepSeek 是 Flashduty 的
 * `/feed.atom`：事件状态和受影响组件都在条目摘要里，灯按有没有未结束事件推。
 *
 * 不在这里发请求。调用方把正文传进来，单测才能不打网。
 */

import type {
  AgentIncident,
  AgentIndicator,
  AgentStatusPayload,
  AgentStatusRow,
} from "@/lib/agent-status-types";

export const AGENT_STATUS_URLS = {
  claude: "https://status.claude.com/api/v2/summary.json",
  openai: "https://status.openai.com/api/v2/summary.json",
  cursor: "https://status.cursor.com/api/v2/summary.json",
  xaiHome: "https://status.x.ai/",
  xaiFeed: "https://status.x.ai/feed.xml",
  deepseekFeed: "https://status.deepseek.com/feed.atom",
  vercel: "https://www.vercel-status.com/api/v2/summary.json",
  github: "https://www.githubstatus.com/api/v2/summary.json",
  cloudflare: "https://www.cloudflarestatus.com/api/v2/summary.json",
} as const;

const STATUS_PAGES = {
  claude: "https://status.claude.com",
  openai: "https://status.openai.com",
  cursor: "https://status.cursor.com",
  xai: "https://status.x.ai/grok-build",
  deepseek: "https://status.deepseek.com",
  vercel: "https://www.vercel-status.com",
  github: "https://www.githubstatus.com",
  cloudflare: "https://www.cloudflarestatus.com",
} as const;

const MAX_INCIDENTS = 3;
const MAX_BODY = 500;

const RANK: Record<Exclude<AgentIndicator, "unavailable" | "unmonitored">, number> = {
  operational: 0,
  maintenance: 1,
  degraded: 2,
  partial_outage: 3,
  major_outage: 4,
};

type FetchText = (url: string) => Promise<string>;

type StatuspageComponent = { name: string; indicator: AgentIndicator };
type StatuspageIncident = {
  id: string;
  name: string;
  status: string;
  impact: string | null;
  url: string;
  updatedAt: string | null;
  body: string;
  componentNames: string[];
};

type XaiItem = {
  id: string;
  title: string;
  url: string;
  updatedAt: string | null;
  status: string;
  severity: string;
  body: string;
};

function worst(indicators: AgentIndicator[]): AgentIndicator {
  let selected: AgentIndicator = "operational";
  let seen = false;
  for (const indicator of indicators) {
    if (indicator === "unavailable" || indicator === "unmonitored") continue;
    seen = true;
    if (RANK[indicator] > RANK[selected]) selected = indicator;
  }
  return seen ? selected : "unavailable";
}

function componentIndicator(status: string): AgentIndicator | null {
  switch (status) {
    case "operational":
      return "operational";
    case "degraded_performance":
      return "degraded";
    case "partial_outage":
      return "partial_outage";
    case "major_outage":
      return "major_outage";
    case "under_maintenance":
      return "maintenance";
    default:
      return null;
  }
}

/** Statuspage 的页面灯和事件 impact 共用这组词。 */
function rollupIndicator(value: string | null): AgentIndicator | null {
  switch (value) {
    case "none":
      return "operational";
    case "minor":
      return "degraded";
    case "major":
      return "partial_outage";
    case "critical":
      return "major_outage";
    case "maintenance":
      return "maintenance";
    default:
      return null;
  }
}

function displayStatus(status: string): string {
  const words = status.replaceAll("_", " ").trim().toLowerCase();
  if (!words) return "Update";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function clip(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_BODY) return flat;
  return `${flat.slice(0, MAX_BODY - 1).trimEnd()}…`;
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const hex = body[1]?.toLowerCase() === "x";
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    switch (body.toLowerCase()) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        return whole;
    }
  });
}

function plain(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function xmlTag(chunk: string, name: string): string {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(chunk);
  if (!match) return "";
  let inner = match[1].trim();
  if (inner.startsWith("<![CDATA[")) inner = inner.slice("<![CDATA[".length);
  if (inner.endsWith("]]>")) inner = inner.slice(0, -3);
  return inner.trim();
}

function iso(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function isClaudeComponent(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized === "claude code" || normalized.startsWith("claude api");
}

/**
 * Codex 自己的三块，加上 CLI 和 VS Code extension。
 * 后两个在状态页上不带 Codex 前缀，但是 Codex 的入口，不是 ChatGPT。
 * Sora、Ads、语音这些同页组件不进这一行。
 */
function isCodexComponent(name: string): boolean {
  switch (name.trim().toLowerCase()) {
    case "codex web":
    case "codex in chatgpt desktop":
    case "codex api":
    case "cli":
    case "vs code extension":
      return true;
    default:
      return false;
  }
}

/**
 * 站点实际跑在这些产品上，再加上域名能解析所靠的基础面。
 * Workers、Durable Objects、KV、R2、D1、WebSockets 是三个 Worker 的运行时；
 * Workers Builds 和 API 是发布与统计卡在用的控制面；
 * Authoritative DNS、DNS Updates 扛 api / online / playstation-reporter 的自定义域名。
 * 机房、WARP、Bot Management、CDN 不进这一行：主站不在 Cloudflare 的缓存上。
 * 用全名，避免 Workers 带上 Workers AI，API 带上 API Shield。
 */
const CLOUDFLARE_SITE_COMPONENTS: Record<string, true> = {
  api: true,
  "authoritative dns": true,
  d1: true,
  "dns updates": true,
  "durable objects": true,
  r2: true,
  websockets: true,
  workers: true,
  "workers builds": true,
  "workers kv": true,
};

function parseStatuspage(body: string, pageUrl: string): {
  page: AgentIndicator | null;
  components: StatuspageComponent[];
  incidents: StatuspageIncident[];
  maintenances: StatuspageIncident[];
} {
  const root = asRecord(JSON.parse(body));
  if (!root) throw new Error("status page JSON is not an object");
  const page = rollupIndicator(text(asRecord(root.status)?.indicator));
  const components: StatuspageComponent[] = [];
  for (const item of list(root.components)) {
    const record = asRecord(item);
    const name = text(record?.name);
    const indicator = componentIndicator(text(record?.status) ?? "");
    if (name && indicator) components.push({ name, indicator });
  }
  const incident = (item: unknown): StatuspageIncident | null => {
    const record = asRecord(item);
    const name = text(record?.name);
    const id = text(record?.id);
    if (!record || !name || !id) return null;
    const updates = list(record.incident_updates)
      .map((update) => {
        const row = asRecord(update);
        const created = text(row?.created_at) ?? text(row?.display_at);
        return {
          at: created ? Date.parse(created) : Number.NaN,
          body: text(row?.body) ?? "",
          status: text(row?.status),
        };
      })
      .filter((update) => update.body);
    updates.sort((left, right) => (right.at || 0) - (left.at || 0));
    const latest = updates[0];
    const componentNames = list(record.components)
      .map((component) => text(asRecord(component)?.name))
      .filter((component): component is string => !!component);
    return {
      id,
      name,
      status: text(record.status) ?? latest?.status ?? "update",
      impact: text(record.impact),
      url: text(record.shortlink) ?? `${pageUrl}/incidents/${id}`,
      updatedAt: iso(text(record.updated_at) ?? (Number.isFinite(latest?.at) ? new Date(latest.at).toISOString() : null)),
      body: clip(latest?.body ?? ""),
      componentNames,
    };
  };
  return {
    page,
    components,
    incidents: list(root.incidents).map(incident).filter((item): item is StatuspageIncident => !!item),
    maintenances: list(root.scheduled_maintenances).map(incident).filter((item): item is StatuspageIncident => !!item),
  };
}

function toPublicIncident(incident: StatuspageIncident): AgentIncident {
  return {
    id: incident.id,
    title: incident.name,
    status: displayStatus(incident.status),
    url: incident.url,
    updatedAt: incident.updatedAt,
    body: incident.body,
  };
}

function closedStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized === "resolved" || normalized === "completed" || normalized === "scheduled";
}

function statuspageRow(
  id: AgentStatusRow["id"],
  name: string,
  pageUrl: string,
  body: string,
  include: (component: string) => boolean,
  wholePage: boolean,
): AgentStatusRow {
  const parsed = parseStatuspage(body, pageUrl);
  const selected = parsed.components.filter((component) => include(component.name));
  const names = new Set(selected.map((component) => component.name));
  const touches = (incident: StatuspageIncident) =>
    wholePage || incident.componentNames.some((component) => names.has(component));
  const active = [...parsed.incidents, ...parsed.maintenances].filter(
    (incident) => touches(incident) && !closedStatus(incident.status),
  );
  const scheduled = parsed.maintenances.filter(
    (incident) => touches(incident) && incident.status.toLowerCase() === "scheduled",
  );
  /**
   * 整页行的灯跟页面灯和事件走，不跟组件走。页面上几个组件异常是常态，
   * 不该把整行点得比页面自己的灯更红。页面灯缺失（词没对上）时才退回组件。
   */
  const incidentIndicators: AgentIndicator[] = [];
  for (const incident of active) {
    const impact = rollupIndicator(incident.impact);
    if (impact) incidentIndicators.push(impact);
    if (incident.status.toLowerCase() === "in_progress" || incident.status.toLowerCase() === "verifying") {
      incidentIndicators.push("maintenance");
    }
  }
  const componentIndicators = selected.map((component) => component.indicator);
  const indicators =
    wholePage && parsed.page
      ? [parsed.page, ...incidentIndicators]
      : [...componentIndicators, ...incidentIndicators];
  const missing = selected.length === 0 && !wholePage;
  return {
    id,
    name,
    indicator: missing ? "unavailable" : worst(indicators),
    statusUrl: pageUrl,
    components: selected.map((component) => ({ name: component.name, indicator: component.indicator })),
    incidents: [...active, ...scheduled].slice(0, MAX_INCIDENTS).map(toPublicIncident),
    note: missing ? "The status page no longer lists the components this row watches." : null,
    stale: false,
  };
}

/** 首页每个服务是一个 `<a href="/grok-build">`，灯的词在 `text-text-*` 那个 div 里。 */
export function parseXaiServiceBadges(html: string): { href: string; name: string; badge: string }[] {
  const rows: { href: string; name: string; badge: string }[] = [];
  for (const chunk of html.split(/<a\b/i).slice(1)) {
    const href = /href="(\/[^"]+)"/.exec(chunk)?.[1];
    const name = /heading-2">([^<]+)/.exec(chunk)?.[1]?.trim();
    const badge = /text-text-[a-z]+">\s*([a-z][a-z -]*)\s*</i.exec(chunk)?.[1]?.trim().toLowerCase();
    if (!href || !name || !badge) continue;
    rows.push({ href, name, badge });
  }
  return rows;
}

function xaiBadge(badge: string): AgentIndicator | null {
  switch (badge) {
    case "available":
      return "operational";
    case "disruption":
    case "degraded":
    case "info":
      return "degraded";
    case "outage":
      return "major_outage";
    case "maintenance":
      return "maintenance";
    default:
      return null;
  }
}

export function parseXaiFeed(xml: string): XaiItem[] {
  return xml
    .split(/<item\b/i)
    .slice(1)
    .map((chunk) => {
      const title = plain(xmlTag(chunk, "title"));
      const url = xmlTag(chunk, "link").trim();
      const id = plain(xmlTag(chunk, "guid")) || url || title;
      if (!title || !id) return null;
      const description = xmlTag(chunk, "description");
      const categories = [...chunk.matchAll(/<category>([^<]*)<\/category>/gi)].map((match) =>
        match[1].trim().toLowerCase(),
      );
      const statusLine = /<h3>\s*Status:\s*([^<]+)<\/h3>/i.exec(description)?.[1]?.trim() ?? "";
      const resolved = categories.includes("resolved") || /^resolved$/i.test(statusLine);
      const severity =
        categories.find((category) => category !== "resolved") ??
        (/<p>\s*Severity:\s*([^<]+)<\/p>/i.exec(description)?.[1]?.trim().toLowerCase() ?? "");
      const blocks = [...description.matchAll(/<h3>([^<]*)<\/h3>\s*<p>([\s\S]*?)<\/p>/gi)];
      const update = blocks.find((block) => !/^status:/i.test(block[1].trim()));
      const published = iso(xmlTag(chunk, "pubDate").trim());
      return {
        id,
        title,
        url: url || STATUS_PAGES.xai,
        updatedAt: published,
        status: resolved ? "resolved" : displayStatus(statusLine || "investigating"),
        severity,
        body: clip(update ? plain(update[2]) : plain(description)),
      };
    })
    .filter((item): item is XaiItem => !!item);
}

function mentionsGrokBuild(item: XaiItem): boolean {
  const haystack = `${item.title} ${item.url}`.toLowerCase();
  return haystack.includes("grok build") || haystack.includes("/grok-build");
}

function xaiSeverity(severity: string): AgentIndicator | null {
  switch (severity) {
    case "outage":
      return "major_outage";
    case "disruption":
    case "degraded":
      return "degraded";
    case "maintenance":
      return "maintenance";
    default:
      return null;
  }
}

function xaiRow(html: string | null, feed: string | null): AgentStatusRow {
  const badge = html
    ? parseXaiServiceBadges(html).find((service) => service.href === "/grok-build")
    : undefined;
  const badgeIndicator = badge ? xaiBadge(badge.badge) : null;
  const items = feed ? parseXaiFeed(feed).filter(mentionsGrokBuild) : [];
  const active = items.filter((item) => item.status.toLowerCase() !== "resolved");
  const indicators: AgentIndicator[] = [];
  if (badgeIndicator) indicators.push(badgeIndicator);
  // 还没标成 resolved 的事件至少算降级。info / available 这种词没有单独的灯，
  // 但不能在事件还开着的时候把整行画成正常。
  for (const item of active) indicators.push(xaiSeverity(item.severity) ?? "degraded");
  // 首页经常对非浏览器回 403。feed 是官方机器可读源，里面没有未结束的
  // Grok Build 事件就按正常，不因为首页被拦把这一行画成读不到。
  if (!badgeIndicator && feed && active.length === 0) indicators.push("operational");
  const unreadable = indicators.length === 0;
  return {
    id: "grok",
    name: "Grok",
    indicator: unreadable ? "unavailable" : worst(indicators),
    statusUrl: STATUS_PAGES.xai,
    components: badgeIndicator ? [{ name: "Grok Build", indicator: badgeIndicator }] : [],
    incidents: active.slice(0, MAX_INCIDENTS).map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      url: item.url,
      updatedAt: item.updatedAt,
      body: item.body,
    })),
    note: unreadable ? "Grok Build status could not be read from status.x.ai." : null,
    stale: false,
  };
}

type DeepseekItem = {
  id: string;
  title: string;
  url: string;
  updatedAt: string | null;
  status: string;
  resolved: boolean;
  severity: Exclude<AgentIndicator, "unavailable" | "unmonitored">;
  body: string;
  componentNames: string[];
};

/**
 * Flashduty 的条目摘要是一段被转义的 HTML：Status、正文、Affected components
 * 各占一个 <p>。链接挂在 <link href> 上，不在标签体里。
 */
export function parseDeepseekFeed(xml: string): DeepseekItem[] {
  return xml
    .split(/<entry\b/i)
    .slice(1)
    .map((chunk) => {
      const title = plain(xmlTag(chunk, "title"));
      const id = xmlTag(chunk, "id").trim() || title;
      if (!title || !id) return null;
      const linkTag = /<link\b[^>]*>/i.exec(chunk)?.[0] ?? "";
      const url = /href="([^"]*)"/i.exec(linkTag)?.[1]?.trim() || STATUS_PAGES.deepseek;
      const summary = decodeEntities(xmlTag(chunk, "summary"));
      const statusLine = /<strong>\s*Status:\s*<\/strong>\s*([^<]+)/i.exec(summary)?.[1]?.trim() ?? "";
      const affected = /<strong>\s*Affected components:\s*<\/strong>\s*([^<]+)/i.exec(summary)?.[1]?.trim() ?? "";
      const message = [...summary.matchAll(/<p>([\s\S]*?)<\/p>/gi)]
        .map((match) => match[1])
        .filter((block) => !/<strong>/i.test(block));
      return {
        id,
        title,
        url,
        updatedAt: iso(xmlTag(chunk, "updated").trim() || null),
        status: displayStatus(statusLine || "update"),
        resolved: /^resolved$/i.test(statusLine),
        severity: deepseekSeverity(title),
        body: clip(message.map(plain).join(" ")),
        componentNames: affected
          ? affected
              .split(/[,，]/)
              .map((name) => plain(name))
              .filter(Boolean)
          : [],
      };
    })
    .filter((item): item is DeepseekItem => !!item);
}

/** 标题写明严重程度：中断 / unavailable 归 Partial outage，性能下降、异常归 Degraded。 */
function deepseekSeverity(title: string): Exclude<AgentIndicator, "unavailable" | "unmonitored"> {
  if (/维护|maintenance/i.test(title)) return "maintenance";
  if (/重大|完全中断|major outage|total outage/i.test(title)) return "major_outage";
  if (/中断|unavailable|outage/i.test(title)) return "partial_outage";
  return "degraded";
}

function deepseekRow(feed: string | null): AgentStatusRow {
  const readable = !!feed && /<feed[\s>]/i.test(feed);
  const items = readable ? parseDeepseekFeed(feed) : [];
  const active = items.filter((item) => !item.resolved);
  const names = [...new Set(active.flatMap((item) => item.componentNames))];
  return {
    id: "deepseek",
    name: "DeepSeek",
    indicator: readable ? (active.length ? worst(active.map((item) => item.severity)) : "operational") : "unavailable",
    statusUrl: STATUS_PAGES.deepseek,
    components: names.map((name) => ({
      name,
      indicator: worst(active.filter((item) => item.componentNames.includes(name)).map((item) => item.severity)),
    })),
    incidents: active.slice(0, MAX_INCIDENTS).map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      url: item.url,
      updatedAt: item.updatedAt,
      body: item.body,
    })),
    note: readable ? null : "DeepSeek status could not be read from status.deepseek.com.",
    stale: false,
  };
}

const FALLBACK: Record<AgentStatusRow["id"], { name: string; statusPage: string }> = {
  claude: { name: "Claude", statusPage: STATUS_PAGES.claude },
  codex: { name: "ChatGPT", statusPage: STATUS_PAGES.openai },
  cursor: { name: "Cursor", statusPage: STATUS_PAGES.cursor },
  grok: { name: "Grok", statusPage: STATUS_PAGES.xai },
  deepseek: { name: "DeepSeek", statusPage: STATUS_PAGES.deepseek },
  vercel: { name: "Vercel", statusPage: STATUS_PAGES.vercel },
  github: { name: "GitHub", statusPage: STATUS_PAGES.github },
  cloudflare: { name: "Cloudflare", statusPage: STATUS_PAGES.cloudflare },
};

function carried(previous: AgentStatusPayload | null, id: AgentStatusRow["id"], failure: string): AgentStatusRow {
  const prior = previous?.agents.find((agent) => agent.id === id);
  if (prior) return { ...prior, stale: true };
  const fallback = FALLBACK[id];
  return {
    id,
    name: fallback.name,
    indicator: "unavailable",
    statusUrl: fallback.statusPage,
    components: [],
    incidents: [],
    note: failure,
    stale: false,
  };
}

async function load(
  previous: AgentStatusPayload | null,
  id: AgentStatusRow["id"],
  run: () => Promise<AgentStatusRow>,
): Promise<AgentStatusRow> {
  try {
    return await run();
  } catch (error) {
    console.warn(
      "[agent-status]",
      id,
      error instanceof Error ? error.message : String(error),
    );
    return carried(previous, id, "Status check failed.");
  }
}

/**
 * 行序跟用量卡一致：Claude、ChatGPT、Cursor、Grok，DeepSeek 和基础设施
 * 三家（Vercel / GitHub / Cloudflare）排在后面。
 * 某一家失败就留着上一轮，不让整张卡空白。
 */
export async function collectAgentStatus(
  previous: AgentStatusPayload | null,
  fetchText: FetchText,
  now = Date.now(),
): Promise<AgentStatusPayload> {
  const text = async (url: string) => fetchText(url);
  const [claude, codex, cursor, grok, deepseek, vercel, github, cloudflare] = await Promise.all([
    load(previous, "claude", async () =>
      statuspageRow(
        "claude",
        "Claude",
        STATUS_PAGES.claude,
        await text(AGENT_STATUS_URLS.claude),
        isClaudeComponent,
        false,
      ),
    ),
    load(previous, "codex", async () =>
      statuspageRow(
        "codex",
        "ChatGPT",
        STATUS_PAGES.openai,
        await text(AGENT_STATUS_URLS.openai),
        isCodexComponent,
        false,
      ),
    ),
    load(previous, "cursor", async () =>
      statuspageRow("cursor", "Cursor", STATUS_PAGES.cursor, await text(AGENT_STATUS_URLS.cursor), () => true, true),
    ),
    load(previous, "grok", async () => {
      const [home, feed] = await Promise.all([
        text(AGENT_STATUS_URLS.xaiHome).then(
          (body) => ({ ok: true as const, body }),
          () => ({ ok: false as const, body: null }),
        ),
        text(AGENT_STATUS_URLS.xaiFeed).then(
          (body) => ({ ok: true as const, body }),
          () => ({ ok: false as const, body: null }),
        ),
      ]);
      if (!home.ok && !feed.ok) throw new Error("status.x.ai unreachable");
      return xaiRow(home.body, feed.body);
    }),
    load(previous, "deepseek", async () => deepseekRow(await text(AGENT_STATUS_URLS.deepseekFeed))),
    load(previous, "vercel", async () =>
      statuspageRow(
        "vercel",
        "Vercel",
        STATUS_PAGES.vercel,
        await text(AGENT_STATUS_URLS.vercel),
        () => true,
        true,
      ),
    ),
    load(previous, "github", async () =>
      statuspageRow(
        "github",
        "GitHub",
        STATUS_PAGES.github,
        await text(AGENT_STATUS_URLS.github),
        () => true,
        true,
      ),
    ),
    load(previous, "cloudflare", async () =>
      statuspageRow(
        "cloudflare",
        "Cloudflare",
        STATUS_PAGES.cloudflare,
        await text(AGENT_STATUS_URLS.cloudflare),
        (name) => name.trim().toLowerCase() in CLOUDFLARE_SITE_COMPONENTS,
        false,
      ),
    ),
  ]);
  return {
    fetchedAt: now,
    agents: [claude, codex, cursor, grok, deepseek, vercel, github, cloudflare],
  };
}

/** 推送只在灯、事件或失败标记变了才发。检查时刻每分钟都变，不拿它做比较。 */
export function agentStatusFingerprint(payload: AgentStatusPayload | null): string {
  if (!payload) return "";
  return JSON.stringify(payload.agents);
}

export function emptyAgentStatus(now = Date.now()): AgentStatusPayload {
  const failure = "Status check failed.";
  return {
    fetchedAt: now,
    agents: [
      carried(null, "claude", failure),
      carried(null, "codex", failure),
      carried(null, "cursor", failure),
      carried(null, "grok", failure),
      carried(null, "deepseek", failure),
      carried(null, "vercel", failure),
      carried(null, "github", failure),
      carried(null, "cloudflare", failure),
    ],
  };
}
