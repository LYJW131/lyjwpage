import type { AgentIndicator, AgentStatusRow } from "@shared/agent-status-types";
import { MAX_INCIDENTS, STATUS_PAGES, clip, displayStatus, iso, worst } from "./agent-status-format";

type XaiItem = {
  id: string;
  title: string;
  url: string;
  updatedAt: string | null;
  status: string;
  severity: string;
  body: string;
};

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

function xmlTag(chunk: string, name: string): string {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(chunk);
  if (!match) return "";
  let inner = match[1].trim();
  if (inner.startsWith("<![CDATA[")) inner = inner.slice("<![CDATA[".length);
  if (inner.endsWith("]]>")) inner = inner.slice(0, -3);
  return inner.trim();
}

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

export function xaiRow(html: string | null, feed: string | null): AgentStatusRow {
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
