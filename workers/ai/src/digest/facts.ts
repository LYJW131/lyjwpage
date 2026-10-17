import type { DigestHighlight, DigestTopic } from "@shared/digest";
import { modelLabel } from "@shared/god-chat-tiers";
import { site } from "@shared/site";
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

// 任一视图读不到就让整轮失败、保留上一份摘要：当成没有事实会让新摘要悄悄漏掉整类近况。
export async function readDigestViews(readStatus: (path: string) => Promise<Response>): Promise<DigestViews> {
  const entries = await Promise.all(DIGEST_VIEWS.map(async (key) => {
    const response = await readStatus(STATUS_VIEWS[key].path);
    const envelope = response.ok ? ((await response.json()) as StatusResponse<unknown>) : null;
    if (!envelope?.ok) throw new Error(`Digest view ${key} unavailable: ${envelope ? envelope.error : `HTTP ${response.status}`}`);
    return [key, envelope.data] as const;
  }));
  return Object.fromEntries(entries) as DigestViews;
}

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

type Figure = Pick<DigestHighlight, "value" | "unit" | "atLeast">;

const MIN_ACTIVE_SECONDS = 300;

// 事实清单的数字有意取粗：小时级以下的抖动不改变清单，输入哈希不变，这一轮就不调模型。卡片上的数取自同一套取粗。
function timeFigure(seconds: number): Figure {
  return seconds < 3_600
    ? { value: Math.max(5, Math.round(seconds / 300) * 5), unit: "minutes", atLeast: false }
    : { value: Math.round(seconds / 1_800) / 2, unit: "hours", atLeast: false };
}

export function duration(seconds: number): string {
  const { value, unit } = timeFigure(seconds);
  return unit === "minutes" ? `${value} min` : `${value} h`;
}

function roundCount(value: number): number {
  const divisor = value >= 1e9 ? 1e9 : value >= 1e6 ? 1e6 : value >= 1e3 ? 1e3 : 1;
  return Number((value / divisor).toPrecision(2)) * divisor;
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
  if (!identifier) return site.timezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: identifier });
    return identifier;
  } catch {
    return site.timezone;
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
  if (lane.summary.activeSeconds < MIN_ACTIVE_SECONDS) return null;
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
  if (lane.summary.activeSeconds < MIN_ACTIVE_SECONDS) return null;
  const plays = activePlays(lane, 2);
  const shows = totals(plays, (play) => play.title, (play) => play.seconds).slice(0, 3).map(([title, seconds]) => {
    const parts = [...new Set(plays.filter((play) => play.title === title && play.subtitle).map((play) => play.subtitle!.split(" · ")[0]))];
    return `${title}${parts.length ? ` [${parts.slice(0, 3).join(", ")}]` : ""} (${duration(seconds)})`;
  });
  return `Watching on Emby: ${duration(lane.summary.activeSeconds)}; ${shows.join(", ")}`;
}

function gamingLine(lane: PulseStateLane): string | null {
  if (lane.summary.activeSeconds < MIN_ACTIVE_SECONDS) return null;
  const games = totals(activePlays(lane, 2), (play) => play.title, (play) => play.seconds)
    .slice(0, 3)
    .map(([title, seconds]) => `${title} (${duration(seconds)})`);
  return `Gaming: ${duration(lane.summary.activeSeconds)}; ${games.join(", ")}`;
}

// 人在场只认编码 app 在前台的时段（含与 agent 重叠的部分）；agent 自己跑的时间不算 LYJW 在写代码，事实清单、情境规则和卡片的 coding 格都用这一口径。
function codingSeconds(pulse: NonNullable<DigestViews["pulse"]>): { handsOn: number; agents: number } {
  const { humanSeconds, agentSeconds, bothSeconds } = pulse.lanes.coding.summary;
  return { handsOn: humanSeconds + bothSeconds, agents: agentSeconds + bothSeconds };
}

function codingLines(views: DigestViews, windowFrom: number, today: string): string[] {
  const lines: string[] = [];
  const pulse = views.pulse!;
  const { handsOn, agents: agentTime } = codingSeconds(pulse);
  if (Math.max(handsOn, agentTime) >= MIN_ACTIVE_SECONDS) {
    const part = (seconds: number) => (seconds >= MIN_ACTIVE_SECONDS ? duration(seconds) : "none");
    lines.push(`Coding: LYJW hands-on (a coding app in front on the Mac) ${part(handsOn)}; AI agents working ${part(agentTime)}`);
  }
  const agents = (views.codingNow?.agents ?? []).flatMap((agent) => {
    const recent = agent.activity.filter((entry) => entry.lastActivityAt >= windowFrom).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    if (!recent.length) return [];
    const models = [...new Set(recent.flatMap((entry) => (entry.model ? [entry.model.startsWith("claude-") ? modelLabel(entry.model) : entry.model] : [])))];
    return [{ at: recent[0].lastActivityAt, text: `${AGENT_LABELS[agent.id] ?? agent.id}${models.length ? ` (${models.join(", ")})` : ""}` }];
  }).sort((a, b) => b.at - a.at);
  if (agents.length) lines.push(`Coding agents used: ${agents.map((agent) => agent.text).join(", ")}`);
  const tokens = pulse.lanes.tokens.summary.totalTokens;
  if (tokens > 0) lines.push(`Tokens through the agents: ${compactCount(tokens)}`);
  const cost = (views.coding?.agents ?? [])
    .filter((agent) => agent.lastDay?.date === today)
    .reduce((sum, agent) => sum + (agent.lastDay?.apiEquivalentCostUSD ?? 0), 0);
  if (cost >= 1) lines.push(`API-equivalent value of today's agent usage so far: $${compactCount(cost)}`);
  return lines;
}

// 来源列表有条数上限：列出的最旧一条还在窗口里，窗口里就可能还有没列出的，只能写下限；这时一条都没筛中也不能说成零，返回 null 不写。
// 列表为空（如仓库提交没取到时视图里没有 recentCommits）同样是不知道，不是零。
function windowTally(count: number, listedAt: (number | null)[], windowFrom: number): Figure | null {
  const times = listedAt.filter((at): at is number => at != null && Number.isFinite(at));
  if (!times.length) return null;
  if (Math.min(...times) < windowFrom) return { value: count, unit: "count", atLeast: false };
  return count > 0 ? { value: count, unit: "count", atLeast: true } : null;
}

function tallyText(tally: Figure | null): string | null {
  return tally && `${tally.value}${tally.atLeast ? "+" : ""}`;
}

function siteTallies(views: DigestViews, windowFrom: number) {
  const commits = views.githubRepo?.recentCommits ?? [];
  const committedAt = (commit: (typeof commits)[number]) => (commit.committedAt ? Date.parse(commit.committedAt) : null);
  const inWindow = commits.filter((commit) => (committedAt(commit) ?? -Infinity) >= windowFrom);
  const deploys = views.siteDeployments?.recent ?? [];
  const shipped = deploys.filter((deploy) => deploy.target === "production" && deploy.state === "READY" && deploy.createdAt >= windowFrom);
  return {
    inWindow,
    commits: inWindow.length || shipped.length ? windowTally(inWindow.length, commits.map(committedAt), windowFrom) : null,
    deploys: inWindow.length || shipped.length ? windowTally(shipped.length, deploys.map((deploy) => deploy.createdAt), windowFrom) : null,
  };
}

function trophyTally(trophies: TrophiesSummaryPayload | null, windowFrom: number) {
  const recent = trophies?.recent ?? [];
  const earned = recent.filter((trophy) => trophy.earnedAt >= windowFrom);
  if (!earned.length) return null;
  return { earned, tally: windowTally(earned.length, recent.map((trophy) => trophy.earnedAt), windowFrom) ?? { value: earned.length, unit: "count", atLeast: false } as Figure };
}

function siteLine(views: DigestViews, windowFrom: number): string | null {
  const { inWindow, commits, deploys } = siteTallies(views, windowFrom);
  if (!commits && !deploys) return null;
  const scopes = [...new Set(inWindow.flatMap((commit) => {
    const scope = /^\w+\(([^)]+)\)!?:/.exec(commit.title)?.[1];
    return scope ? [scope] : [];
  }))].slice(0, 5);
  const counts = [commits && `${tallyText(commits)} commits`, deploys && `${tallyText(deploys)} production deploys`].filter(Boolean).join(", ");
  return [
    `This homepage's own code: ${counts}`,
    scopes.length ? `areas touched ${scopes.join(", ")}` : null,
  ].filter(Boolean).join("; ");
}

function roundSteps(steps: number): number {
  return Math.round(steps / 100) * 100;
}

function fitnessLines(views: DigestViews, windowFrom: number, now: number): string[] {
  const lines: string[] = [];
  const steps = roundSteps(views.pulse!.lanes.activity.summary.steps);
  // 步数桶只在有步数时才上报，零步分不清是没走还是没上报，只能不写。
  if (steps > 0) lines.push(`Steps: ${steps.toLocaleString("en-US")} in 24 h`);
  const workouts = (views.workouts?.items ?? []).filter((workout) => workout.startedAt >= windowFrom);
  const described = workouts.map((workout) => {
    const distance = workout.distanceMeters && workout.distanceMeters >= 100 ? `, ${Math.round(workout.distanceMeters / 100) / 10} km` : "";
    return `${workout.activityType} ${duration(workout.durationSeconds)}${distance}`;
  });
  const last = views.workouts?.items.reduce<(typeof workouts)[number] | null>((latest, workout) => (!latest || workout.startedAt > latest.startedAt ? workout : latest), null);
  const sinceLast = last ? Math.floor((now - last.endedAt) / 86_400_000) : null;
  if (described.length) lines.push(`Workouts: ${described.join(", ")}`);
  else if (last && sinceLast != null) lines.push(`No workout (last one: ${last.activityType}, ${sinceLast} ${sinceLast === 1 ? "day" : "days"} ago)`);
  const rings = views.activity;
  if (rings?.currentAtSource) {
    const percent = (value: number, goal: number) => `${goal > 0 ? Math.min(100, Math.round((value / goal) * 10) * 10) : 0}%`;
    lines.push(`Apple Watch rings today so far: move ${percent(rings.moveKcal, rings.moveGoalKcal)}, exercise ${percent(rings.exerciseMinutes, rings.exerciseGoalMinutes)}, stand ${percent(rings.standHours, rings.standGoalHours)}`);
  }
  return lines;
}

function trophyLine(trophies: TrophiesSummaryPayload | null, windowFrom: number): string | null {
  const found = trophyTally(trophies, windowFrom);
  if (!found) return null;
  const listed = found.earned.slice(0, 3).map((trophy) => `${trophy.trophyName} (${trophy.type}, ${trophy.titleName})`);
  return `PlayStation trophies earned: ${tallyText(found.tally)}; ${listed.join(", ")}`;
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

export type DigestSignals = { weekend: boolean; workoutMinutes: number; deploys: number; date: string };

export function digestSignals(views: DigestViews, now: number): DigestSignals {
  const pulse = views.pulse;
  if (!pulse) throw new Error("Pulse view unavailable");
  const { weekday, date } = localClock(now, validTimeZone(views.timezone?.timezone?.identifier));
  const seconds = (views.workouts?.items ?? []).filter((workout) => workout.startedAt >= pulse.window.from).reduce((sum, workout) => sum + workout.durationSeconds, 0);
  const deploys = siteTallies(views, pulse.window.from).deploys?.value ?? 0;
  return { weekend: weekday === "Saturday" || weekday === "Sunday", workoutMinutes: Math.round(seconds / 60), deploys, date };
}

// 卡片上的三格只从这里挑：数由代码按事实清单同样的取粗算出，模型只选主题，不写数字和说明。
export function digestHighlightOptions(views: DigestViews): DigestHighlight[] {
  const pulse = views.pulse;
  if (!pulse) throw new Error("Pulse view unavailable");
  const windowFrom = pulse.window.from;
  const options: DigestHighlight[] = [];
  const add = (topic: DigestTopic, figure: Figure | null, caption: string) => {
    if (figure) options.push({ topic, ...figure, caption });
  };
  const time = (seconds: number) => (seconds >= MIN_ACTIVE_SECONDS ? timeFigure(seconds) : null);
  const count = (value: number): Figure | null => (value > 0 ? { value, unit: "count", atLeast: false } : null);
  const coding = codingSeconds(pulse);
  add("coding", time(coding.handsOn), "hands-on");
  add("agents", time(coding.agents), "agent time");
  add("tokens", count(roundCount(pulse.lanes.tokens.summary.totalTokens)), "tokens");
  const site = siteTallies(views, windowFrom);
  if (site.commits?.value) add("site", site.commits, "commits");
  else if (site.deploys?.value) add("site", site.deploys, "deploys");
  add("music", time(pulse.lanes.listening.summary.activeSeconds), "music");
  add("watching", time(pulse.lanes.watching.summary.activeSeconds), "watching");
  add("gaming", time(pulse.lanes.gaming.summary.activeSeconds), "gaming");
  add("trophies", trophyTally(views.trophies && "recent" in views.trophies ? views.trophies : null, windowFrom)?.tally ?? null, "trophies");
  add("fitness", count(roundSteps(pulse.lanes.activity.summary.steps)), "steps");
  return options;
}

function figureText({ value, unit, atLeast }: Figure): string {
  const number = unit === "minutes" ? `${value} min` : unit === "hours" ? `${value} h` : value >= 1_000 ? compactCount(value) : String(value);
  return `${number}${atLeast ? "+" : ""}`;
}

export function digestMessage(views: DigestViews, now: number): { content: string; options: DigestHighlight[] } {
  const options = digestHighlightOptions(views);
  const listed = options.length ? options.map((option) => `${option.topic}: ${figureText(option)} ${option.caption}`).join("; ") : "none";
  return { content: `${digestFacts(views, now)}\n\nHighlight options: ${listed}`, options };
}
