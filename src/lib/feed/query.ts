import { site } from "@shared/site";
import type { StatusViewKey } from "@shared/status-views";

export const FEED_PATHS: ReadonlySet<string> = new Set(["/feed", "/rss.xml", "/atom.xml"]);

export const DEFAULT_FEED_TYPES = ["digest", "commits", "trophies", "gaming", "workouts"] as const;
export const OPTIONAL_FEED_TYPES = ["deployments", "watching", "listening", "incidents"] as const;
export const ALL_FEED_TYPES = [...DEFAULT_FEED_TYPES, ...OPTIONAL_FEED_TYPES] as const;

export type FeedType = (typeof ALL_FEED_TYPES)[number];
export type FeedFormat = "rss" | "atom";

export const DEFAULT_FEED_LIMIT = 20;
export const MIN_FEED_LIMIT = 1;
export const MAX_FEED_LIMIT = 50;

const MAX_FEED_TAGS = 20;
const MAX_TAG_LENGTH = 64;

const VALID_TYPE_SET: ReadonlySet<string> = new Set(ALL_FEED_TYPES);
const INTEGER_PATTERN = /^-?\d+$/;

const VIEWS_BY_TYPE: Record<FeedType, readonly StatusViewKey[]> = {
  digest: ["digest"],
  commits: ["githubRepo"],
  trophies: ["trophies"],
  gaming: ["playing"],
  workouts: ["workouts"],
  deployments: ["siteDeployments"],
  watching: ["watching", "pulse"],
  listening: ["pulse"],
  incidents: ["agentStatus"],
};

export type FeedQuery = {
  format: FeedFormat;
  types: FeedType[];
  tags: string[];
  limit: number;
};

export type FeedQueryResult =
  | { ok: true; query: FeedQuery }
  | { ok: false; error: string };

function splitCsv(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of values) {
    for (const part of raw.split(",")) {
      const normalized = part.trim().toLowerCase();
      if (normalized) out.push(normalized);
    }
  }
  return out;
}

function parseLimit(raw: string | null): number {
  if (raw == null) return DEFAULT_FEED_LIMIT;
  const trimmed = raw.trim();
  if (!trimmed || !INTEGER_PATTERN.test(trimmed)) return DEFAULT_FEED_LIMIT;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return DEFAULT_FEED_LIMIT;
  return Math.min(MAX_FEED_LIMIT, Math.max(MIN_FEED_LIMIT, parsed));
}

export function parseFeedQuery(searchParams: URLSearchParams, defaultFormat: FeedFormat): FeedQueryResult {
  const rawFormat = searchParams.get("format")?.trim().toLowerCase() ?? "";
  let format: FeedFormat = defaultFormat;
  if (rawFormat) {
    if (rawFormat !== "rss" && rawFormat !== "atom") {
      return { ok: false, error: `Invalid format "${rawFormat}". Valid values: rss, atom.` };
    }
    format = rawFormat;
  }

  const rawTypes = splitCsv(searchParams.getAll("type"));
  let types: FeedType[];
  if (!rawTypes.length) {
    types = [...DEFAULT_FEED_TYPES];
  } else {
    const unknown = rawTypes.filter((token) => token !== "all" && !VALID_TYPE_SET.has(token));
    if (unknown.length) {
      return {
        ok: false,
        error: `Unknown type "${unknown.join(", ")}". Valid values: ${ALL_FEED_TYPES.join(", ")}, all.`,
      };
    }
    if (rawTypes.includes("all")) {
      types = [...ALL_FEED_TYPES];
    } else {
      types = [...new Set(rawTypes)] as FeedType[];
    }
  }

  const tags: string[] = [];
  const seenTags = new Set<string>();
  for (const token of splitCsv(searchParams.getAll("tag"))) {
    const clipped = token.slice(0, MAX_TAG_LENGTH);
    if (seenTags.has(clipped)) continue;
    seenTags.add(clipped);
    tags.push(clipped);
    if (tags.length >= MAX_FEED_TAGS) break;
  }

  return {
    ok: true,
    query: {
      format,
      types,
      tags,
      limit: parseLimit(searchParams.get("limit")),
    },
  };
}

export function requiredViewsForTypes(types: readonly FeedType[]): StatusViewKey[] {
  const views = new Set<StatusViewKey>();
  for (const type of types) {
    for (const view of VIEWS_BY_TYPE[type]) views.add(view);
  }
  return [...views];
}

function isDefaultTypeSelection(types: readonly FeedType[]): boolean {
  return types.length === DEFAULT_FEED_TYPES.length && DEFAULT_FEED_TYPES.every((type, i) => types[i] === type);
}

export function canonicalFeedUrl(pathname: string, query: FeedQuery, defaultFormat: FeedFormat): string {
  const url = new URL(pathname, site.url);
  if (query.format !== defaultFormat) url.searchParams.set("format", query.format);
  if (!isDefaultTypeSelection(query.types)) {
    const isAll = query.types.length === ALL_FEED_TYPES.length && ALL_FEED_TYPES.every((type) => query.types.includes(type));
    url.searchParams.set("type", isAll ? "all" : query.types.join(","));
  }
  if (query.tags.length) url.searchParams.set("tag", query.tags.join(","));
  if (query.limit !== DEFAULT_FEED_LIMIT) url.searchParams.set("limit", String(query.limit));
  return url.href;
}
