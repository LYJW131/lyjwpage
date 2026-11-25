import type { AgentStatusPayload } from "@shared/agent-status-types";
import type { DigestHighlight, DigestPayload } from "@shared/digest";
import type { WatchingPayload } from "@shared/emby";
import { LISTENING_STATES, WATCHING_STATES } from "@shared/pulse-timeline";
import { site } from "@shared/site";
import type { SiteDeploymentsPayload } from "@shared/site-deployments-types";
import type {
  GithubRepoPayload,
  PlaystationPlayingPayload,
  PulsePayload,
  TrophiesPayload,
  TrophiesSummaryPayload,
  WorkoutsPayload,
} from "@shared/types";
import { stripUntilStable } from "@/lib/strip-scripts";
import type { FeedQuery, FeedType } from "@/lib/feed/query";

export type FeedSnapshot = {
  digest?: DigestPayload;
  githubRepo?: GithubRepoPayload;
  siteDeployments?: SiteDeploymentsPayload;
  trophies?: TrophiesSummaryPayload | TrophiesPayload;
  playing?: PlaystationPlayingPayload;
  workouts?: WorkoutsPayload;
  watching?: WatchingPayload;
  pulse?: PulsePayload;
  agentStatus?: AgentStatusPayload;
};

export type FeedItem = {
  id: string;
  type: FeedType;
  title: string;
  summary: string;
  link: string;
  publishedAt: number | null;
  updatedAt?: number | null;
  categories: string[];
};

const SITE_HOME_URL = `${site.url}/`;
const MINUTE_MS = 60_000;
const MULTI_TYPE_LISTENING_LIMIT = 3;
const LISTENING_PLAYING_STATE = LISTENING_STATES.indexOf("playing");
const WATCHING_PLAYING_STATE = WATCHING_STATES.indexOf("playing");
const MERGE_COMMIT_PATTERN = /^Merge\s+(?:remote-tracking\s+branch|branch)\b/i;

function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function parseTimestamp(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function slugTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stableShortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function uniqueTags(tags: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const normalized = tag?.trim().toLowerCase() ?? "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function formatDurationSec(seconds: number): string {
  const totalSec = Math.max(0, Math.round(seconds));
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.round(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatHoursMinutes(ms: number): string {
  return formatDurationSec(ms / 1000);
}

function formatCompactCount(value: number): string {
  if (value >= 1_000_000) {
    const scaled = value / 1_000_000;
    return `${Number(scaled.toFixed(scaled >= 10 ? 0 : 1))}M`;
  }
  if (value >= 1_000) {
    const scaled = value / 1_000;
    return `${Number(scaled.toFixed(scaled >= 10 ? 0 : 1))}K`;
  }
  return String(value);
}

function formatHighlight(highlight: DigestHighlight): string {
  const plus = highlight.atLeast ? "+" : "";
  if (highlight.unit === "hours") return `${highlight.value}${plus}h ${highlight.caption}`;
  if (highlight.unit === "minutes") return `${highlight.value}${plus}m ${highlight.caption}`;
  return `${formatCompactCount(highlight.value)}${plus} ${highlight.caption}`;
}

function conventionalCommitTags(title: string): string[] {
  const match = /^([a-z]+)(?:\(([^)]+)\))?!?:\s/.exec(title.trim().toLowerCase());
  if (!match) return [];
  const scope = match[2] ? slugTag(match[2]) : "";
  return scope ? [match[1], scope] : [match[1]];
}

function playstationPlatform(category: string | null): string | null {
  if (!category) return null;
  const match = /^(ps[1-5]|psv|psp)\b/i.exec(category.replace(/_/g, " "));
  return match ? match[1].toUpperCase() : null;
}

function cleanPlainText(raw: string, maxChars: number): string {
  const withoutTags = stripUntilStable(raw, /<[^>]*>/g);
  const collapsed = withoutTags.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, maxChars - 1).trimEnd()}…`;
}

function digestItems(data: DigestPayload | undefined): FeedItem[] {
  if (!data || data.quiet || !data.headline.trim()) return [];
  const headline = data.headline.trim();
  const highlightsText = data.highlights.map(formatHighlight).join(", ");
  return [
    {
      id: `tag:lyjw.me,2026:digest:${data.generatedAt}`,
      type: "digest",
      title: highlightsText ? `Digest: ${headline} · ${highlightsText}` : `Digest: ${headline}`,
      summary: highlightsText
        ? `Past 24 hours summary: ${headline} (${highlightsText}).`
        : `Past 24 hours summary: ${headline}.`,
      link: SITE_HOME_URL,
      publishedAt: parseTimestamp(data.generatedAt),
      categories: uniqueTags(["digest", ...data.highlights.map((h) => h.topic)]),
    },
  ];
}

function commitItems(data: GithubRepoPayload | undefined): FeedItem[] {
  if (!data?.recentCommits?.length) return [];
  return data.recentCommits.flatMap((commit) => {
    const title = commit.title.split("\n")[0].trim() || commit.sha;
    if (MERGE_COMMIT_PATTERN.test(title)) return [];
    const key = commit.oid ?? commit.sha;
    const authors = commit.authors.length ? commit.authors.join(", ") : site.githubLogin;
    return [{
      id: `tag:lyjw.me,2026:commit:${key}`,
      type: "commits",
      title,
      summary: `Commit ${commit.sha} in ${data.repo} · Authors: ${authors}${commit.verified ? " · Verified" : ""}`,
      link: safeHttpUrl(commit.url) ?? `${site.repo}/commit/${key}`,
      publishedAt: parseTimestamp(commit.committedAt),
      categories: uniqueTags(["commits", "github", ...conventionalCommitTags(title)]),
    }];
  });
}

function deploymentItems(data: SiteDeploymentsPayload | undefined): FeedItem[] {
  if (!data?.recent?.length) return [];
  return data.recent.map((dep) => {
    const message = dep.commit?.message?.split("\n")[0].trim() || dep.commit?.sha.slice(0, 7) || dep.id;
    const parts = [`Site deployment (${dep.target})`, `State: ${dep.state}`];
    if (dep.buildDurationMs != null) parts.push(`Build: ${formatDurationSec(dep.buildDurationMs / 1000)}`);
    if (dep.commit?.branch) parts.push(`Branch: ${dep.commit.branch}`);
    if (dep.commit?.sha) parts.push(`Commit: ${dep.commit.sha.slice(0, 7)}`);
    const publishedAt = parseTimestamp(dep.createdAt);
    const updatedAt = publishedAt != null && dep.buildDurationMs != null && dep.buildDurationMs > 0
      ? publishedAt + dep.buildDurationMs
      : publishedAt;
    return {
      id: `tag:lyjw.me,2026:deployment:${dep.id}`,
      type: "deployments",
      title: `Deploy ${dep.state}: ${message}`,
      summary: parts.join(" · "),
      link: dep.commit?.sha ? `${site.repo}/commit/${dep.commit.sha}` : SITE_HOME_URL,
      publishedAt,
      updatedAt,
      categories: uniqueTags(["deployments", dep.target, dep.state]),
    };
  });
}

function trophyItems(data: TrophiesSummaryPayload | TrophiesPayload | undefined): FeedItem[] {
  if (!data || !("recent" in data) || !Array.isArray(data.recent)) return [];
  return data.recent.map((unlock) => ({
    id: `tag:lyjw.me,2026:trophy:${unlock.npCommunicationId}:${unlock.groupId}:${unlock.id}`,
    type: "trophies",
    title: `${capitalize(unlock.type)} Trophy: ${unlock.trophyName} · ${unlock.titleName}`,
    summary: `Unlocked ${unlock.type} trophy "${unlock.trophyName}" in ${unlock.titleName} on PlayStation.`,
    link: SITE_HOME_URL,
    publishedAt: parseTimestamp(unlock.earnedAt),
    categories: uniqueTags(["trophies", "playstation", unlock.type]),
  }));
}

function isPlaystationMediaApp(category: string | null): boolean {
  return category?.endsWith("_media_app") === true;
}

function isUnplayedPreorder(item: PlaystationPlayingPayload["items"][number]): boolean {
  return item.preOrder && item.playCount === 0 && item.playDurationMs == null;
}

function gamingItems(data: PlaystationPlayingPayload | undefined): FeedItem[] {
  if (!data?.items?.length) return [];
  const games = data.items.filter((item) => !isPlaystationMediaApp(item.category) && !isUnplayedPreorder(item));
  return games.map((game) => {
    const platform = playstationPlatform(game.category);
    const parts = [platform ? `PlayStation (${platform})` : "PlayStation"];
    parts.push(`${game.playCount} session${game.playCount === 1 ? "" : "s"}`);
    if (game.playDurationMs != null) parts.push(`${formatHoursMinutes(game.playDurationMs)} total`);
    return {
      id: `tag:lyjw.me,2026:gaming:${game.titleId}:${game.lastPlayedAt ?? 0}`,
      type: "gaming",
      title: `Played ${game.name}`,
      summary: parts.join(" · "),
      link: SITE_HOME_URL,
      publishedAt: parseTimestamp(game.lastPlayedAt),
      categories: uniqueTags(["gaming", "playstation", platform]),
    };
  });
}

function workoutItems(data: WorkoutsPayload | undefined): FeedItem[] {
  if (!data?.items?.length) return [];
  return data.items.map((workout) => {
    const duration = formatDurationSec(workout.durationSeconds);
    const kcal = workout.activeEnergyKcal != null ? `${Math.round(workout.activeEnergyKcal)} kcal` : null;
    const distance = workout.distanceMeters != null && workout.distanceMeters > 0
      ? `${(workout.distanceMeters / 1000).toFixed(2)} km`
      : null;
    const environment = workout.indoor === true ? "Indoor" : workout.indoor === false ? "Outdoor" : null;
    const summaryParts = [
      `Workout: ${workout.activityType}`,
      `Duration: ${duration}`,
      ...(kcal ? [`Active energy: ${kcal}`] : []),
      ...(distance ? [`Distance: ${distance}`] : []),
      ...(environment ? [environment] : []),
    ];
    return {
      id: `tag:lyjw.me,2026:workout:${workout.id}`,
      type: "workouts",
      title: kcal ? `Workout: ${workout.activityType} · ${duration} · ${kcal}` : `Workout: ${workout.activityType} · ${duration}`,
      summary: summaryParts.join(" · "),
      link: SITE_HOME_URL,
      publishedAt: parseTimestamp(workout.endedAt || workout.startedAt),
      categories: uniqueTags(["workouts", "fitness", slugTag(workout.activityType), environment]),
    };
  });
}

function pulseWatchingLookup(pulse: PulsePayload | undefined): { byFull: Map<string, number>; byTitle: Map<string, number> } {
  const byFull = new Map<string, number>();
  const byTitle = new Map<string, number>();
  if (!pulse) return { byFull, byTitle };
  const { startSec, endSec, state, title, subtitle } = pulse.lanes.watching.segments;
  for (let i = 0; i < startSec.length; i++) {
    if (state[i] !== WATCHING_PLAYING_STATE) continue;
    const name = title[i]?.trim();
    if (!name) continue;
    const endMs = Math.round((pulse.window.from + (endSec[i] ?? startSec[i]) * 1000) / MINUTE_MS) * MINUTE_MS;
    const sub = subtitle[i]?.trim() ?? "";
    if (sub) {
      const fullKey = `${name}\0${sub}`;
      byFull.set(fullKey, Math.max(byFull.get(fullKey) ?? 0, endMs));
    } else {
      byTitle.set(name, Math.max(byTitle.get(name) ?? 0, endMs));
    }
  }
  return { byFull, byTitle };
}

function watchingItems(data: WatchingPayload | undefined, pulse: PulsePayload | undefined): FeedItem[] {
  if (!data?.items?.length) return [];
  const { byFull, byTitle } = pulseWatchingLookup(pulse);
  return data.items.map((item) => {
    const sub = item.subtitle.trim();
    const title = sub ? `Watched ${item.title} · ${sub}` : `Watched ${item.title}`;
    const pulseTime = sub
      ? (byFull.get(`${item.title.trim()}\0${sub}`) ?? null)
      : (byTitle.get(item.title.trim()) ?? null);
    const parts = [`Emby · ${item.type}`];
    if (item.year != null) parts.push(String(item.year));
    if (item.progress > 0) parts.push(`${Math.round(item.progress)}% watched`);
    return {
      id: `tag:lyjw.me,2026:watching:${item.id}`,
      type: "watching",
      title,
      summary: parts.join(" · "),
      link: SITE_HOME_URL,
      publishedAt: parseTimestamp(item.playedAt) ?? pulseTime,
      categories: uniqueTags(["watching", "emby", item.type]),
    };
  });
}

function listeningItems(pulse: PulsePayload | undefined): FeedItem[] {
  if (!pulse) return [];
  type Span = { title: string; subtitle: string; startMs: number; durationSec: number; uncertain: boolean };
  const spans: Span[] = [];
  const lane = pulse.lanes.listening;

  for (let i = 0; i < lane.segments.startSec.length; i++) {
    if (lane.segments.state[i] !== LISTENING_PLAYING_STATE) continue;
    const title = lane.segments.title[i]?.trim();
    if (!title) continue;
    const startSec = lane.segments.startSec[i];
    const endSec = lane.segments.endSec[i] ?? startSec;
    const startMs = Math.round((pulse.window.from + startSec * 1000) / MINUTE_MS) * MINUTE_MS;
    spans.push({
      title,
      subtitle: lane.segments.subtitle[i]?.trim() ?? "",
      startMs,
      durationSec: Math.max(0, endSec - startSec),
      uncertain: false,
    });
  }

  if (lane.uncertain) {
    for (let i = 0; i < lane.uncertain.startSec.length; i++) {
      const title = lane.uncertain.title[i]?.trim();
      if (!title) continue;
      const startSec = lane.uncertain.startSec[i];
      const endSec = lane.uncertain.endSec[i] ?? startSec;
      const startMs = Math.round((pulse.window.from + startSec * 1000) / MINUTE_MS) * MINUTE_MS;
      spans.push({
        title,
        subtitle: lane.uncertain.subtitle[i]?.trim() ?? "",
        startMs,
        durationSec: Math.max(0, endSec - startSec),
        uncertain: true,
      });
    }
  }

  const ordered = [...spans].sort((a, b) => b.startMs - a.startMs || a.title.localeCompare(b.title));
  const collapsed: Span[] = [];
  for (const span of ordered) {
    const prev = collapsed[collapsed.length - 1];
    if (prev && prev.title === span.title && prev.subtitle === span.subtitle && Math.abs(prev.startMs - span.startMs) <= 2 * MINUTE_MS) {
      prev.durationSec += span.durationSec;
      continue;
    }
    collapsed.push({ ...span });
  }

  return collapsed.map((span) => {
    const hash = stableShortHash(`${span.title}\0${span.subtitle}`);
    return {
      id: `tag:lyjw.me,2026:listening:${Math.floor(span.startMs / MINUTE_MS)}:${hash}`,
      type: "listening",
      title: span.subtitle ? `Listened: ${span.title} — ${span.subtitle}` : `Listened: ${span.title}`,
      summary: `Apple Music${span.uncertain ? " (inferred elsewhere)" : ""} · ${formatDurationSec(span.durationSec)}`,
      link: SITE_HOME_URL,
      publishedAt: span.startMs,
      categories: uniqueTags(["listening", "music", span.uncertain ? "elsewhere" : "live"]),
    };
  });
}

function incidentItems(data: AgentStatusPayload | undefined): FeedItem[] {
  if (!data?.agents?.length) return [];
  const out: FeedItem[] = [];
  for (const agent of data.agents) {
    for (const incident of agent.incidents) {
      const body = cleanPlainText(incident.body, 400);
      out.push({
        id: `tag:lyjw.me,2026:incident:${agent.id}:${incident.id}`,
        type: "incidents",
        title: `${agent.name}: ${incident.title}`,
        summary: body ? `[${incident.status}] ${body}` : `[${incident.status}] ${incident.title}`,
        link: safeHttpUrl(incident.url) ?? safeHttpUrl(agent.statusUrl) ?? SITE_HOME_URL,
        publishedAt: parseTimestamp(incident.updatedAt) ?? parseTimestamp(data.fetchedAt),
        categories: uniqueTags(["incidents", "status", agent.id, slugTag(incident.status)]),
      });
    }
  }
  return out;
}

export function buildFeedItems(snapshot: FeedSnapshot, query: FeedQuery): FeedItem[] {
  const all: FeedItem[] = [];
  for (const type of query.types) {
    switch (type) {
      case "digest":
        all.push(...digestItems(snapshot.digest));
        break;
      case "commits":
        all.push(...commitItems(snapshot.githubRepo));
        break;
      case "deployments":
        all.push(...deploymentItems(snapshot.siteDeployments));
        break;
      case "trophies":
        all.push(...trophyItems(snapshot.trophies));
        break;
      case "gaming":
        all.push(...gamingItems(snapshot.playing));
        break;
      case "workouts":
        all.push(...workoutItems(snapshot.workouts));
        break;
      case "watching":
        all.push(...watchingItems(snapshot.watching, snapshot.pulse));
        break;
      case "listening":
        all.push(...listeningItems(snapshot.pulse));
        break;
      case "incidents":
        all.push(...incidentItems(snapshot.agentStatus));
        break;
    }
  }

  const tagFilter = query.tags.length ? new Set(query.tags) : null;
  const filtered = tagFilter
    ? all.filter((item) => item.categories.some((category) => tagFilter.has(category)))
    : all;

  const indexed = filtered.map((item, index) => ({ item, index }));
  indexed.sort((a, b) => {
    const ta = a.item.publishedAt;
    const tb = b.item.publishedAt;
    if (ta != null && tb != null && ta !== tb) return tb - ta;
    if (ta != null && tb == null) return -1;
    if (ta == null && tb != null) return 1;
    return a.index - b.index;
  });

  const sorted = indexed.map((entry) => entry.item);
  if (query.types.length <= 1) return sorted.slice(0, query.limit);

  const capped: FeedItem[] = [];
  let listeningCount = 0;
  for (const item of sorted) {
    if (item.type === "listening") {
      if (listeningCount >= MULTI_TYPE_LISTENING_LIMIT) continue;
      listeningCount += 1;
    }
    capped.push(item);
  }

  // 多类型混排时各维度最新一条置前（保留各自时间序），避免同类连发占满只展示前几条的友链卡片。
  const seenTypes = new Set<FeedType>();
  const lead: FeedItem[] = [];
  const rest: FeedItem[] = [];
  for (const item of capped) {
    if (item.publishedAt != null && !seenTypes.has(item.type)) {
      seenTypes.add(item.type);
      lead.push(item);
    } else {
      rest.push(item);
    }
  }
  return [...lead, ...rest].slice(0, query.limit);
}

// 优先取条目时间，缺项时退回数据源快照时间，不写 Date.now()，否则无变化时每次 ETag 都会变。
export function feedUpdatedAt(items: readonly FeedItem[], snapshot: FeedSnapshot): number {
  let latest = 0;
  for (const item of items) {
    const stamp = item.updatedAt ?? item.publishedAt;
    if (stamp != null && stamp > latest) latest = stamp;
  }
  if (latest > 0) return latest;
  const candidates = [
    snapshot.digest?.generatedAt,
    snapshot.githubRepo?.fetchedAt,
    snapshot.siteDeployments?.fetchedAt,
    snapshot.trophies?.observedAt,
    snapshot.playing?.observedAt,
    snapshot.workouts?.pushedAt,
    snapshot.agentStatus?.fetchedAt,
    snapshot.pulse?.generatedAt ? Math.floor(snapshot.pulse.generatedAt / MINUTE_MS) * MINUTE_MS : undefined,
  ];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value) && value > latest) latest = value;
  }
  return latest;
}
