import { sha256Hex } from "@shared/sha256";
import { site as siteConfig } from "@shared/site";
import type { StatusViewKey } from "@shared/status-views";
import type { FirstScreen } from "@/lib/first-screen";
import { FEED_CACHE_CONTROL, NO_STORE } from "@/lib/site-policy";
import type { SiteServices } from "@/server/site-context";
import { buildFeedItems, feedUpdatedAt, type FeedSnapshot } from "@/lib/feed/items";
import {
  canonicalFeedUrl,
  parseFeedQuery,
  requiredViewsForTypes,
  type FeedFormat,
} from "@/lib/feed/query";
import { renderAtom, renderRss } from "@/lib/feed/xml";

const CONTENT_TYPES: Record<FeedFormat, string> = {
  rss: "application/rss+xml; charset=utf-8",
  atom: "application/atom+xml; charset=utf-8",
};

type StatusReader = <K extends StatusViewKey>(key: K) => Promise<FirstScreen<K>>;

export function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  const trimmed = header.trim();
  if (trimmed === "*") return true;
  const stripWeak = (value: string) => value.trim().replace(/^W\//i, "");
  const target = stripWeak(etag);
  return trimmed.split(",").some((part) => stripWeak(part) === target);
}

function assignView(snapshot: FeedSnapshot, key: StatusViewKey, data: unknown): void {
  switch (key) {
    case "digest":
      snapshot.digest = data as FeedSnapshot["digest"];
      break;
    case "githubRepo":
      snapshot.githubRepo = data as FeedSnapshot["githubRepo"];
      break;
    case "siteDeployments":
      snapshot.siteDeployments = data as FeedSnapshot["siteDeployments"];
      break;
    case "trophies":
      snapshot.trophies = data as FeedSnapshot["trophies"];
      break;
    case "playing":
      snapshot.playing = data as FeedSnapshot["playing"];
      break;
    case "workouts":
      snapshot.workouts = data as FeedSnapshot["workouts"];
      break;
    case "watching":
      snapshot.watching = data as FeedSnapshot["watching"];
      break;
    case "pulse":
      snapshot.pulse = data as FeedSnapshot["pulse"];
      break;
    case "agentStatus":
      snapshot.agentStatus = data as FeedSnapshot["agentStatus"];
      break;
  }
}

export async function serveFeed(
  request: Request,
  services: Pick<SiteServices, "status">,
  defaultFormat: FeedFormat,
): Promise<Response> {
  const url = new URL(request.url);
  const parsed = parseFeedQuery(url.searchParams, defaultFormat);
  if (!parsed.ok) {
    return new Response(parsed.error, {
      status: 400,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": NO_STORE,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const { query } = parsed;
  const views = requiredViewsForTypes(query.types);
  const read: StatusReader = (key) => services.status(key);

  const results = await Promise.all(
    views.map(async (key) => {
      try {
        const envelope = await read(key);
        return { key, envelope };
      } catch (error) {
        console.error("[feed]", key, error instanceof Error ? error.message : String(error));
        return { key, envelope: { ok: false as const, error: "unavailable" } };
      }
    }),
  );

  const snapshot: FeedSnapshot = {};
  let succeeded = 0;
  let failed = 0;
  for (const { key, envelope } of results) {
    if (envelope.ok) {
      succeeded += 1;
      assignView(snapshot, key, envelope.data);
    } else {
      failed += 1;
    }
  }

  if (succeeded === 0) {
    return new Response("Feed upstream unavailable", {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": NO_STORE,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const items = buildFeedItems(snapshot, query);
  const selfUrl = canonicalFeedUrl(url.pathname, query, defaultFormat);
  const document = {
    title: siteConfig.name,
    description: siteConfig.description,
    selfUrl,
    updatedAt: feedUpdatedAt(items, snapshot),
    items,
  };
  const xml = query.format === "atom" ? renderAtom(document) : renderRss(document);
  const etag = `"${(await sha256Hex(xml)).slice(0, 16)}"`;
  // 部分视图降级时不进边缘缓存，避免把残缺条目冻满整个缓存窗口（与 src/app/page.tsx 的 degraded 同口径）。
  const cacheControl = failed > 0 ? NO_STORE : FEED_CACHE_CONTROL;

  const headers: Record<string, string> = {
    "Content-Type": CONTENT_TYPES[query.format],
    "Cache-Control": cacheControl,
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
  };

  if (failed === 0 && etagMatches(request.headers.get("If-None-Match"), etag)) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(request.method === "HEAD" ? null : xml, {
    status: 200,
    headers,
  });
}
