import { modelLabel } from "@shared/god-chat-tiers";
import type { StatusPayloads } from "@shared/status-payloads";
import { STATUS_VIEWS } from "@shared/status-views";
import type { PulseStateLane, StatusResponse, TrophiesSummaryPayload } from "@shared/types";

export const DIGEST_VIEWS = [
  "pulse",
  "timezone",
  "activity",
  "workouts",
  "coding",
  "codingNow",
  "trophies",
  "githubRepo",
  "siteDeployments",
] as const;

type DigestViewKey = (typeof DIGEST_VIEWS)[number];

export type DigestViews = { [K in DigestViewKey]: StatusPayloads[K] | null };

export async function readDigestViews(readStatus: (path: string) => Promise<Response>): Promise<DigestViews> {
  const entries = await Promise.all(DIGEST_VIEWS.map(async (key) => {
    try {
      const response = await readStatus(STATUS_VIEWS[key].path);
      if (!response.ok) return [key, null] as const;
      const envelope = (await response.json()) as StatusResponse<unknown>;
      return [key, envelope.ok ? envelope.data : null] as const;
    } catch (error) {
      console.warn("[digest] read", key, error instanceof Error ? error.message : String(error));
      return [key, null] as const;
    }
  }));
  return Object.fromEntries(entries) as DigestViews;
}

const DEFAULT_TIME_ZONE = "Asia/Shanghai";

const AGENT_LABELS: Record<string, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
  grok: "Grok Build",
  antigravity: "Antigravity",
  opencode: "OpenCode",
  pi: "Pi",
  devin: "Devin CLI",
};

// 事实清单的数字有意取粗：小时级以下的抖动不改变清单，输入哈希不变，这一轮就不调模型。
export function duration(seconds: number): string {
  if (seconds < 3_600) return `${Math.max(5, Math.round(seconds / 300) * 5)} min`;
  return `${Math.round(seconds / 1_800) / 2} h`;
}

export function compactCount(value: number): string {
  const [divisor, suffix] = value >= 1e9 ? [1e9, "B"] : value >= 1e6 ? [1e6, "M"] : value >= 1e3 ? [1e3, "K"] : [1, ""];
  return `${Number((value / divisor).toPrecision(2))}${suffix}`;
}

function partOfDay(hour: number): string {
  if (hour < 5) return "late night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

function localClock(now: number, timeZone: string): { weekday: string; hour: number; date: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", hour: "numeric", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return { weekday: parts.weekday, hour: Number(parts.hour), date: `${parts.year}-${parts.month}-${parts.day}` };
}

function validTimeZone(identifier: string | undefined): string {
  if (!identifier) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: identifier });
    return identifier;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

type Play = { title: string; subtitle: string | null; seconds: number };

function activePlays(lane: PulseStateLane, activeState: number): Play[] {
  const { startSec, endSec, state, title, subtitle } = lane.segments;
  const plays: Play[] = [];
  for (let index = 0; index < startSec.length; index += 1) {
    const name = title[index];
    if (state[index] !== activeState || !name) continue;
    plays.push({ title: name, subtitle: subtitle[index] ?? null, seconds: endSec[index] - startSec[index] });
  }
  const elsewhere = lane.uncertain;
  for (let index = 0; elsewhere && index < elsewhere.startSec.length; index += 1) {
    const name = elsewhere.title[index];
    if (name) plays.push({ title: name, subtitle: elsewhere.subtitle[index] ?? null, seconds: elsewhere.endSec[index] - elsewhere.startSec[index] });
  }
  return plays;
}

function totals<T>(items: T[], key: (item: T) => string | null, seconds: (item: T) => number): [string, number][] {
  const sums = new Map<string, number>();
  for (const item of items) {
    const name = key(item);
    if (name) sums.set(name, (sums.get(name) ?? 0) + seconds(item));
  }
  return [...sums].sort((a, b) => b[1] - a[1]);
}

function musicLine(lane: PulseStateLane): string | null {
  if (lane.summary.activeSeconds < 300) return null;
  const plays = activePlays(lane, 2);
  const artists = totals(plays, (play) => play.subtitle, (play) => play.seconds)
    .filter(([, seconds], index) => index === 0 || seconds >= 1_200)
    .slice(0, 3)
    .map(([artist, seconds]) => `${artist} (${duration(seconds)})`);
  const repeats = totals(plays, (play) => play.title, (play) => play.seconds)
    .filter(([, seconds]) => seconds >= 900)
    .slice(0, 2)
    .map(([title, seconds]) => `${title} (${duration(seconds)})`);
  const tracks = lane.summary.titles;
  return [
    `Music: ${duration(lane.summary.activeSeconds)}, ${tracks} ${tracks === 1 ? "track" : "tracks"}`,
    artists.length ? `top artists ${artists.join(", ")}` : null,
    repeats.length ? `most played tracks ${repeats.join(", ")}` : null,
  ].filter(Boolean).join("; ");
}

function watchingLine(lane: PulseStateLane): string | null {
  if (lane.summary.activeSeconds < 300) return null;
  const plays = activePlays(lane, 2);
  const shows = totals(plays, (play) => play.title, (play) => play.seconds).slice(0, 3).map(([title, seconds]) => {
    const parts = [...new Set(plays.filter((play) => play.title === title && play.subtitle).map((play) => play.subtitle!.split(" · ")[0]))];
    return `${title}${parts.length ? ` [${parts.slice(0, 3).join(", ")}]` : ""} (${duration(seconds)})`;
  });
  return `Watching on Emby: ${duration(lane.summary.activeSeconds)}; ${shows.join(", ")}`;
}

function gamingLine(lane: PulseStateLane): string | null {
  if (lane.summary.activeSeconds < 300) return null;
  const games = totals(activePlays(lane, 2), (play) => play.title, (play) => play.seconds)
    .slice(0, 3)
    .map(([title, seconds]) => `${title} (${duration(seconds)})`);
  return `Gaming: ${duration(lane.summary.activeSeconds)}; ${games.join(", ")}`;
}

function codingLines(views: DigestViews, windowFrom: number, today: string): string[] {
  const lines: string[] = [];
  const pulse = views.pulse!;
  const { humanSeconds, agentSeconds, bothSeconds } = pulse.lanes.coding.summary;
  const any = humanSeconds + agentSeconds + bothSeconds;
  if (any >= 300) {
    lines.push(`Coding: active ${duration(any)} of the 24 h; a coding app in front on LYJW's Mac ${duration(humanSeconds + bothSeconds)}, AI agents working ${duration(agentSeconds + bothSeconds)}`);
  }
  const agents = (views.codingNow?.agents ?? []).flatMap((agent) => {
    const recent = agent.activity.filter((entry) => entry.lastActivityAt >= windowFrom).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    if (!recent.length) return [];
    const models = [...new Set(recent.flatMap((entry) => (entry.model ? [entry.model.startsWith("claude-") ? modelLabel(entry.model) : entry.model] : [])))];
    return [{ at: recent[0].lastActivityAt, text: `${AGENT_LABELS[agent.id] ?? agent.id}${models.length ? ` (${models.join(", ")})` : ""}` }];
  }).sort((a, b) => b.at - a.at);
  if (agents.length) lines.push(`Coding agents used: ${agents.map((agent) => agent.text).join(", ")}`);
  const tokens = pulse.lanes.tokens.summary.freshTokens;
  if (tokens > 0) lines.push(`Tokens through the agents: ${compactCount(tokens)} (cache reads excluded)`);
  const cost = (views.coding?.agents ?? [])
    .filter((agent) => agent.lastDay?.date === today)
    .reduce((sum, agent) => sum + (agent.lastDay?.apiEquivalentCostUSD ?? 0), 0);
  if (cost >= 1) lines.push(`API-equivalent value of today's agent usage so far: $${compactCount(cost)}`);
  return lines;
}

function siteLine(views: DigestViews, windowFrom: number): string | null {
  const commits = views.githubRepo?.recentCommits ?? [];
  const inWindow = commits.filter((commit) => commit.committedAt && Date.parse(commit.committedAt) >= windowFrom);
  const deploys = views.siteDeployments?.recent ?? [];
  const shipped = deploys.filter((deploy) => deploy.target === "production" && deploy.state === "READY" && deploy.createdAt >= windowFrom);
  if (!inWindow.length && !shipped.length) return null;
  const atLeast = (count: number, listed: number) => (count && count === listed ? `${count}+` : String(count));
  const scopes = [...new Set(inWindow.flatMap((commit) => {
    const scope = /^\w+\(([^)]+)\)!?:/.exec(commit.title)?.[1];
    return scope ? [scope] : [];
  }))].slice(0, 5);
  return [
    `This homepage's own code: ${atLeast(inWindow.length, commits.length)} commits, ${atLeast(shipped.length, deploys.length)} production deploys`,
    scopes.length ? `areas touched ${scopes.join(", ")}` : null,
  ].filter(Boolean).join("; ");
}

function fitnessLines(views: DigestViews, windowFrom: number, now: number): string[] {
  const lines: string[] = [];
  const steps = views.pulse!.lanes.activity.summary.steps;
  const workouts = (views.workouts?.items ?? []).filter((workout) => workout.endedAt >= windowFrom);
  const described = workouts.map((workout) => {
    const distance = workout.distanceMeters && workout.distanceMeters >= 100 ? `, ${Math.round(workout.distanceMeters / 100) / 10} km` : "";
    return `${workout.activityType} ${duration(workout.durationSeconds)}${distance}`;
  });
  const last = views.workouts?.items.reduce<(typeof workouts)[number] | null>((latest, workout) => (!latest || workout.startedAt > latest.startedAt ? workout : latest), null);
  const sinceLast = last ? Math.floor((now - last.endedAt) / 86_400_000) : null;
  lines.push([
    `Steps: ${(Math.round(steps / 100) * 100).toLocaleString("en-US")} in 24 h`,
    described.length
      ? `workouts ${described.join(", ")}`
      : last && sinceLast != null ? `no workout (last one: ${last.activityType}, ${sinceLast} ${sinceLast === 1 ? "day" : "days"} ago)` : null,
  ].filter(Boolean).join("; "));
  const rings = views.activity;
  if (rings?.currentAtSource) {
    const percent = (value: number, goal: number) => `${goal > 0 ? Math.min(100, Math.round((value / goal) * 10) * 10) : 0}%`;
    lines.push(`Apple Watch rings today so far: move ${percent(rings.moveKcal, rings.moveGoalKcal)}, exercise ${percent(rings.exerciseMinutes, rings.exerciseGoalMinutes)}, stand ${percent(rings.standHours, rings.standGoalHours)}`);
  }
  return lines;
}

function trophyLine(trophies: TrophiesSummaryPayload | null, windowFrom: number): string | null {
  const earned = (trophies?.recent ?? []).filter((trophy) => trophy.earnedAt >= windowFrom);
  if (!earned.length) return null;
  const listed = earned.slice(0, 3).map((trophy) => `${trophy.trophyName} (${trophy.type}, ${trophy.titleName})`);
  return `PlayStation trophies earned: ${earned.length}; ${listed.join(", ")}`;
}

export function digestFacts(views: DigestViews, now: number): string {
  const pulse = views.pulse;
  if (!pulse) throw new Error("Pulse view unavailable");
  const timeZone = validTimeZone(views.timezone?.timezone?.identifier);
  const clock = localClock(now, timeZone);
  const windowFrom = pulse.window.from;
  const trophies = views.trophies && "recent" in views.trophies ? views.trophies : null;
  return [
    `Now: ${clock.weekday} ${partOfDay(clock.hour)} in LYJW's time zone (${timeZone}); every fact covers the past 24 hours unless it says today`,
    ...codingLines(views, windowFrom, clock.date),
    siteLine(views, windowFrom),
    musicLine(pulse.lanes.listening),
    watchingLine(pulse.lanes.watching),
    gamingLine(pulse.lanes.gaming),
    trophyLine(trophies, windowFrom),
    ...fitnessLines(views, windowFrom, now),
  ].filter((line): line is string => Boolean(line)).join("\n");
}
