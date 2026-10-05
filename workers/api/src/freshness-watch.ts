import {
  AGENT_LIMITS_STALE_MS,
  AGENT_STATUS_STALE_MS,
  CLOUDFLARE_DEPLOYMENTS_STALE_MS,
  CLOUDFLARE_METRICS_STALE_MS,
  GITHUB_CHART_STALE_MS,
  GITHUB_REPO_STALE_MS,
  PAGESPEED_STALE_MS,
  PLAYSTATION_STALE_MS,
  SENTRY_STALE_MS,
  SERVER_STALE_MS,
  VERCEL_DEPLOYMENTS_STALE_MS,
  VERCEL_METRICS_STALE_MS,
} from "@/lib/freshness";
import { CRON_HEARTBEAT_EVERY_MINUTES } from "@/lib/sentry";
import { RESUME_STALE_MS, resumeMirror } from "@shared/emby-store";
import { LAG_KEYS, readLag, writeLag, type LagKey, type LagStore } from "@shared/lag";
import { presenceMirror } from "@shared/playstation-store";
import { QUEST_STALE_MS, questMirror, questNow, type QuestPresence } from "@shared/quest";
import type { StorageCommand, StorageResult } from "@shared/storage-contract";

// 最短阈值是 QUEST_STALE_MS；值得告警的断流按小时计，检测晚几轮换来成倍少的 KV 与 DO 读。
export const FRESHNESS_CHECK_EVERY_ROUNDS = 3;

export function freshnessCheckDue(scheduledTime: number): boolean {
  return Math.floor(scheduledTime / (CRON_HEARTBEAT_EVERY_MINUTES * 60_000)) % FRESHNESS_CHECK_EVERY_ROUNDS === 0;
}

type Stamp = { lastSeenAt: number; thresholdMs: number; stale: boolean };

function byAge(lastSeenAt: unknown, thresholdMs: number, now: number): Stamp | null {
  if (typeof lastSeenAt !== "number" || !Number.isFinite(lastSeenAt)) return null;
  return { lastSeenAt, thresholdMs, stale: now - lastSeenAt > thresholdMs };
}

const field = (value: unknown, name: string): unknown =>
  value && typeof value === "object" ? (value as Record<string, unknown>)[name] : undefined;

type HubFeed = { source: string; key: string; stamp(value: unknown, now: number): Stamp | null };
type LagFeed = { source: string; key: LagKey; thresholdMs: number };

export const HUB_FEEDS: readonly HubFeed[] = [
  {
    source: "quest",
    key: questMirror.key,
    stamp(value, now) {
      const observedAt = field(value, "observedAt");
      if (typeof observedAt !== "number" || typeof field(value, "receivedAt") !== "number") return null;
      return { lastSeenAt: observedAt, thresholdMs: QUEST_STALE_MS, stale: !questNow(value as QuestPresence, now).available };
    },
  },
  { source: "playstation", key: presenceMirror.key, stamp: (value, now) => byAge(field(value, "observedAt"), PLAYSTATION_STALE_MS, now) },
  { source: "emby", key: resumeMirror.key, stamp: (value, now) => byAge(field(value, "at"), RESUME_STALE_MS, now) },
];

export const LAG_FEEDS: readonly LagFeed[] = [
  { source: "server", key: LAG_KEYS.server, thresholdMs: SERVER_STALE_MS },
  { source: "agents-reporter", key: LAG_KEYS.reporterAgents, thresholdMs: AGENT_LIMITS_STALE_MS },
  { source: "agent-status", key: LAG_KEYS.agentStatus, thresholdMs: AGENT_STATUS_STALE_MS },
  { source: "github-chart", key: LAG_KEYS.githubChart, thresholdMs: GITHUB_CHART_STALE_MS },
  { source: "github-repo", key: LAG_KEYS.githubRepo, thresholdMs: GITHUB_REPO_STALE_MS },
  { source: "vercel-deployments", key: LAG_KEYS.vercelDeployments, thresholdMs: VERCEL_DEPLOYMENTS_STALE_MS },
  { source: "vercel-metrics", key: LAG_KEYS.vercelMetrics, thresholdMs: VERCEL_METRICS_STALE_MS },
  { source: "pagespeed", key: LAG_KEYS.pagespeed, thresholdMs: PAGESPEED_STALE_MS },
  { source: "cloudflare-deployments", key: LAG_KEYS.cloudflareDeployments, thresholdMs: CLOUDFLARE_DEPLOYMENTS_STALE_MS },
  { source: "cloudflare-metrics", key: LAG_KEYS.cloudflareMetrics, thresholdMs: CLOUDFLARE_METRICS_STALE_MS },
  { source: "sentry", key: LAG_KEYS.sentry, thresholdMs: SENTRY_STALE_MS },
];

export type FreshnessEvent = {
  source: string;
  state: "stale" | "recovered";
  lastSeenAt: number;
  ageMs: number;
  thresholdMs: number;
};

type Watched = Record<string, "fresh" | "stale">;

export type FreshnessWatchDeps = {
  now: number;
  lag: LagStore;
  hubRead(commands: StorageCommand[]): Promise<StorageResult[] | null>;
  emit(event: FreshnessEvent): void;
};

async function readHubStamps(deps: FreshnessWatchDeps): Promise<Map<string, Stamp>> {
  const stamps = new Map<string, Stamp>();
  const values = await deps.hubRead(HUB_FEEDS.map(({ key }) => ({ op: "get", key })));
  if (!values) return stamps;
  HUB_FEEDS.forEach((feed, index) => {
    const raw = values[index];
    if (typeof raw !== "string") return;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return; }
    const stamp = feed.stamp(parsed, deps.now);
    if (stamp) stamps.set(feed.source, stamp);
  });
  return stamps;
}

async function readLagStamps(deps: FreshnessWatchDeps): Promise<Map<string, Stamp>> {
  const entries = await Promise.all(LAG_FEEDS.map((feed) => readLag(deps.lag, feed.key)));
  const stamps = new Map<string, Stamp>();
  LAG_FEEDS.forEach((feed, index) => {
    const stamp = byAge(entries[index]?.updatedAt, feed.thresholdMs, deps.now);
    if (stamp) stamps.set(feed.source, stamp);
  });
  return stamps;
}

// 读不到的来源（没写过、DO 未初始化或读失败）这一轮不下结论，沿用上次状态，免得把读故障报成断流或恢复。
export async function watchFreshness(deps: FreshnessWatchDeps): Promise<FreshnessEvent[]> {
  const [hub, lag, previous] = await Promise.all([
    readHubStamps(deps).catch((error: unknown) => {
      console.warn("[freshness-watch]", error);
      return new Map<string, Stamp>();
    }),
    readLagStamps(deps),
    readLag<Watched>(deps.lag, LAG_KEYS.freshnessWatch),
  ]);
  const watched: Watched = { ...previous?.data };
  const events: FreshnessEvent[] = [];
  for (const [source, stamp] of [...hub, ...lag]) {
    const next = stamp.stale ? "stale" : "fresh";
    if ((watched[source] ?? "fresh") === next) continue;
    watched[source] = next;
    events.push({
      source,
      state: stamp.stale ? "stale" : "recovered",
      lastSeenAt: stamp.lastSeenAt,
      ageMs: deps.now - stamp.lastSeenAt,
      thresholdMs: stamp.thresholdMs,
    });
  }
  if (!events.length) return events;
  await writeLag(deps.lag, LAG_KEYS.freshnessWatch, watched, deps.now);
  for (const event of events) deps.emit(event);
  return events;
}
