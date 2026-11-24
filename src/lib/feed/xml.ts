import { site } from "@shared/site";
import type { FeedItem } from "@/lib/feed/items";

export type FeedDocument = {
  title: string;
  description: string;
  selfUrl: string;
  updatedAt: number;
  items: readonly FeedItem[];
};

// XML 1.0 禁止控制字符（保留 \t \n \r）与非字符 U+FFFE / U+FFFF，含它们会让阅读器整份解析失败。
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

export function escapeXml(value: string): string {
  return value
    .replace(INVALID_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isoDate(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

function rfc2822Date(epochMs: number): string {
  return new Date(epochMs).toUTCString();
}

export function renderRss(feed: FeedDocument): string {
  const siteLink = `${site.url}/`;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(feed.title)}</title>`,
    `    <link>${escapeXml(siteLink)}</link>`,
    `    <description>${escapeXml(feed.description)}</description>`,
    "    <language>en</language>",
    `    <lastBuildDate>${escapeXml(rfc2822Date(feed.updatedAt))}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(feed.selfUrl)}" rel="self" type="application/rss+xml" />`,
  ];

  for (const item of feed.items) {
    lines.push("    <item>");
    lines.push(`      <title>${escapeXml(item.title)}</title>`);
    lines.push(`      <link>${escapeXml(item.link)}</link>`);
    lines.push(`      <guid isPermaLink="false">${escapeXml(item.id)}</guid>`);
    if (item.publishedAt != null) {
      lines.push(`      <pubDate>${escapeXml(rfc2822Date(item.publishedAt))}</pubDate>`);
    }
    lines.push(`      <description>${escapeXml(item.summary)}</description>`);
    for (const category of item.categories) {
      lines.push(`      <category>${escapeXml(category)}</category>`);
    }
    lines.push("    </item>");
  }

  lines.push("  </channel>");
  lines.push("</rss>");
  return `${lines.join("\n")}\n`;
}

export function renderAtom(feed: FeedDocument): string {
  const siteLink = `${site.url}/`;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">',
    `  <id>${escapeXml(feed.selfUrl)}</id>`,
    `  <title>${escapeXml(feed.title)}</title>`,
    `  <subtitle>${escapeXml(feed.description)}</subtitle>`,
    `  <updated>${escapeXml(isoDate(feed.updatedAt))}</updated>`,
    `  <link rel="alternate" type="text/html" href="${escapeXml(siteLink)}" />`,
    `  <link rel="self" type="application/atom+xml" href="${escapeXml(feed.selfUrl)}" />`,
    "  <author>",
    `    <name>${escapeXml(site.shortName)}</name>`,
    `    <uri>${escapeXml(siteLink)}</uri>`,
    "  </author>",
  ];

  for (const item of feed.items) {
    const entryUpdated = item.publishedAt ?? feed.updatedAt;
    lines.push("  <entry>");
    lines.push(`    <id>${escapeXml(item.id)}</id>`);
    lines.push(`    <title>${escapeXml(item.title)}</title>`);
    // 双引号 href 与显式 rel="alternate" 兼容严格 RFC 4287 及正则提取友链订阅的解析器。
    lines.push(`    <link rel="alternate" type="text/html" href="${escapeXml(item.link)}" />`);
    lines.push(`    <updated>${escapeXml(isoDate(entryUpdated))}</updated>`);
    if (item.publishedAt != null) {
      lines.push(`    <published>${escapeXml(isoDate(item.publishedAt))}</published>`);
    }
    lines.push(`    <summary type="text">${escapeXml(item.summary)}</summary>`);
    for (const category of item.categories) {
      lines.push(`    <category term="${escapeXml(category)}" />`);
    }
    lines.push("  </entry>");
  }

  lines.push("</feed>");
  return `${lines.join("\n")}\n`;
}
