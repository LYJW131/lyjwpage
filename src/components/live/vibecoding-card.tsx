"use client";

import AnthropicIcon from "@lobehub/icons/es/Anthropic/components/Mono";
import AntigravityColor from "@lobehub/icons/es/Antigravity/components/Color";
import CursorIcon from "@lobehub/icons/es/Cursor/components/Mono";
import GrokIcon from "@lobehub/icons/es/Grok/components/Mono";
import OpenAIIcon from "@lobehub/icons/es/OpenAI/components/Mono";
import NumberFlow, { NumberFlowGroup } from "@number-flow/react";
import { Cloud } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { ClaudeSpinner } from "@/components/live/claude-spinner";
import { CodexActivityIndicator, CodexMark } from "@/components/live/codex-activity-indicator";
import { Card } from "@/components/ui/card";
import { MacBookProIcon } from "@/components/ui/device-icons";
import { FlowDash } from "@/components/ui/flow-dash";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useMountedAt } from "@/hooks/use-mounted-at";
import { useSiteDay } from "@/hooks/use-site-day";
import { useConfirmedClockStale, useStale } from "@/hooks/use-stale";
import { useStatus } from "@/hooks/use-status";
import { agentUsageLabel, agentUsageUrl } from "@/lib/agent-usage-url";
import {
  CODING_ACTIVE_WINDOW_MS,
  CODING_SOURCE_LABELS,
  codingActivitySlots,
  codingAgentRows,
  codingDisplayModel,
  codingSourceHealth,
  describeCodingSources,
  type CodingActivityEntry,
  type CodingAgentRow,
  type CodingSourceNote,
} from "@/lib/coding-agents";
import { AGENT_LIMITS_STALE_MS } from "@/lib/freshness";
import { zonedDay } from "@/lib/heatmap-window";
import { CODING_NOW_PATH, CODING_PATH, LIMITS_PATH } from "@/lib/paths";
import { site } from "@/lib/site";
import type {
  CodingNowPayload,
  CodingUsagePayload,
  CodingUsageTotals,
  StatusResponse,
  VibeCodingLimit,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import type { AgentLimitsPayload } from "@/lib/vibecoding-limits";

function busiestLimit(limits: VibeCodingLimit[], now: number) {
  const candidates = limits.filter((limit) => !isExtraWindow(limit));
  if (candidates.length === 0) return null;
  const effective = (limit: VibeCodingLimit) =>
    now && limit.resetsAt != null && limit.resetsAt * 1000 <= now ? 0 : limit.usedPercent;
  return candidates.reduce((best, row) => (effective(row) > effective(best) ? row : best));
}

const REFRESH_MS = 2 * 60_000;

type FirstFrameClocks = {
  usage?: number;
  now?: number;
  nowValidating: boolean;
  limits?: number;
};

function useSlotLive(entry: CodingActivityEntry | null, clockKnown: boolean, clocks: FirstFrameClocks) {
  const expired = useConfirmedClockStale(entry?.lastActivityAt, CODING_ACTIVE_WINDOW_MS, {
    validating: clocks.nowValidating,
    servedAt: clocks.now,
  });
  return entry != null && clockKnown && !expired ? entry : null;
}

function useAgentActive(row: CodingAgentRow, macDeclaredOffline: boolean, clocks: FirstFrameClocks) {
  const slots = codingActivitySlots(row.activity, macDeclaredOffline);
  const mountedAt = useMountedAt();
  const clockKnown = mountedAt > 0 || clocks.now != null;
  const mac = useSlotLive(slots.mac, clockKnown, clocks);
  const remote = useSlotLive(slots.remote, clockKnown, clocks);
  const sources = [mac, remote].filter((entry) => entry != null);
  const live = sources.reduce<CodingActivityEntry | null>(
    (newest, entry) => (newest == null || entry.lastActivityAt > newest.lastActivityAt ? entry : newest),
    null,
  );
  const active = live != null;
  return { active, sources: sources.map((entry) => entry.source), model: codingDisplayModel(row, live, active) };
}

function ActiveBadge({ sources }: { sources: CodingActivityEntry["source"][] }) {
  const labels = sources.map((source) => CODING_SOURCE_LABELS[source] ?? source);
  return (
    <span
      className="flex shrink-0 items-center gap-1 text-live"
      title={labels.length ? `Active on ${labels.join(" + ")}` : undefined}
    >
      <span className="label-mono">Active</span>
      {sources.map((source, index) =>
        source === "mac" ? (
          <MacBookProIcon key={source} className="size-3.5" aria-label={labels[index]} />
        ) : (
          <Cloud key={source} className="size-3.5" aria-label={labels[index]} />
        ),
      )}
    </span>
  );
}

function displayModelName(model: string) {
  if (model === "github_bugbot") return "Bugbot";
  if (model.startsWith("grok-bot-")) return "Grok Bot";
  if (model === "agent_review") return "Agent Review";
  return model;
}

const LIMIT_WARN_PERCENT = 75;
const LIMIT_ALERT_PERCENT = 90;
const LIMIT_BAR_COLOR = "oklch(0.63 0.18 250)";
const LIMIT_WARN_COLOR = "oklch(0.72 0.16 75)";
const LIMIT_ALERT_COLOR = "oklch(0.62 0.21 25)";
const LIMIT_OVER_PACE_COLOR = LIMIT_ALERT_COLOR;
const LIMIT_ON_PACE_COLOR = "oklch(0.65 0.17 145)";

function limitColor(usedPercent: number) {
  if (usedPercent >= LIMIT_ALERT_PERCENT) return LIMIT_ALERT_COLOR;
  if (usedPercent >= LIMIT_WARN_PERCENT) return LIMIT_WARN_COLOR;
  return LIMIT_BAR_COLOR;
}

const TOKEN_SEGMENTS = [
  { key: "inputTokens", label: "Input", shortLabel: "IN", color: "oklch(0.63 0.18 250)" },
  { key: "outputTokens", label: "Output", shortLabel: "OUT", color: "oklch(0.68 0.15 175)" },
  {
    key: "cacheReadTokens",
    label: "Cache read",
    shortLabel: "CR",
    color: "oklch(0.72 0.16 75)",
  },
  {
    key: "cacheCreationTokens",
    label: "Cache write",
    shortLabel: "CW",
    color: "oklch(0.65 0.18 315)",
  },
] as const;

function BrandMark({
  icon,
  label,
  className,
}: {
  icon: string;
  label: string;
  className?: string;
}) {
  switch (icon) {
    case "cursor":
      return <CursorIcon size={20} className={className} />;
    case "antigravity":
      return <AntigravityColor size={20} className={className} />;
    case "grok":
      return <GrokIcon size={20} className={className} />;
    case "openai":
    case "codex":
      return <CodexMark className={className} />;
    default:
      return (
        <span
          className={cn(
            "flex items-center justify-center text-xs font-medium text-muted-foreground",
            className,
          )}
        >
          {label.slice(0, 1).toUpperCase()}
        </span>
      );
  }
}

function ModelProviderIcon({ model }: { model: string }) {
  const name = model.toLowerCase();
  const mark = name.startsWith("claude") ? (
    <AnthropicIcon size={16} />
  ) : name.startsWith("grok") ? (
    <GrokIcon size={16} />
  ) : /^(gpt|codex|chatgpt|o\d)/.test(name) ? (
    <OpenAIIcon size={16} />
  ) : null;
  if (!mark) return null;
  return (
    <span className="flex size-6 shrink-0 items-center justify-center text-foreground" aria-hidden>
      {mark}
    </span>
  );
}

const RANK_MARK_COLOR = [
  "oklch(0.65 0.144 33.6)",
  "oklch(0.696 0.105 52)",
  "oklch(0.777 0.099 85.5)",
] as const;

function RankMark({ rank }: { rank: number }) {
  return (
    <span
      className="shrink-0 font-mono text-sm font-bold tracking-[0.02em] text-muted-foreground"
      style={
        rank < RANK_MARK_COLOR.length
          ? { color: RANK_MARK_COLOR[rank] }
          : undefined
      }
    >
      {String(rank + 1).padStart(2, "0")}
    </span>
  );
}

function capitalize(part: string) {
  return part ? `${part[0].toUpperCase()}${part.slice(1)}` : part;
}

function formatModelName(model: string) {
  if (!model) return model;
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/i.exec(model);
  if (claude) {
    const [, family, major, minor] = claude;
    return `Claude ${capitalize(family)} ${major}${minor ? `.${minor}` : ""}`;
  }
  const gpt = /^gpt-(\d+(?:\.\d+)?)(?:-(.+))?$/i.exec(model);
  if (gpt) {
    const [, version, variant] = gpt;
    const suffix = variant ? ` ${variant.split("-").map(capitalize).join(" ")}` : "";
    return `GPT ${version}${suffix}`;
  }
  return model.split("-").map(capitalize).join(" ");
}

function SourceIssue({ failing, hasValue }: { failing: CodingSourceNote[]; hasValue: boolean }) {
  if (failing.length === 0) return null;
  return (
    <span className="text-live-idle">
      <span aria-hidden className="mx-1.5">
        ·
      </span>
      {hasValue ? "Partial" : "Unavailable"}
    </span>
  );
}

function TotalUsage({
  totals,
  topModels,
  failing,
}: {
  totals: CodingUsageTotals;
  topModels: CodingUsagePayload["topModels"];
  failing: CodingSourceNote[];
}) {
  const values = {
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheCreationTokens: totals.cacheCreationTokens,
  };
  const stackTotal = Object.values(values).reduce((sum, value) => sum + value, 0);

  return (
    <div
      className={cn(
        "border-b border-line px-4 pt-5 md:px-5",
        topModels.length === 0 && "pb-5",
      )}
    >
      <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
        <div>
          <div className="label-mono text-muted-foreground" title={describeCodingSources(failing) || undefined}>
            Tokens
            <SourceIssue failing={failing} hasValue />
          </div>
          <div className="mt-2 text-3xl font-medium tracking-tight md:text-4xl">
            <NumberFlow
              value={totals.totalTokens}
              locales="en-US"
              format={{ notation: "compact", maximumFractionDigits: 1 }}
            />
          </div>
        </div>
        <div title="At public API prices">
          <div className="label-mono text-muted-foreground">Cost</div>
          <div className="mt-2 text-3xl font-medium tracking-tight md:text-4xl">
            {totals.costComplete || totals.apiEquivalentCostUSD > 0 ? (
              <NumberFlow
                value={totals.apiEquivalentCostUSD}
                locales="en-US"
                format={{
                  style: "currency",
                  currency: "USD",
                  notation: "compact",
                  maximumFractionDigits: 1,
                }}
              />
            ) : <FlowDash />}
          </div>
        </div>
        <div>
          <div className="label-mono text-muted-foreground">Active</div>
          <div className="mt-2 text-3xl font-medium tracking-tight md:text-4xl">
            <NumberFlow value={totals.activeDays} locales="en-US" />
          </div>
        </div>
        <div>
          <div className="label-mono text-muted-foreground">Sessions</div>
          <div className="mt-2 text-3xl font-medium tracking-tight md:text-4xl">
            {totals.sessionCount != null ? <NumberFlow value={totals.sessionCount} locales="en-US" /> : <FlowDash />}
          </div>
        </div>
      </div>

      <div className="mt-6 flex h-2 overflow-hidden bg-muted" aria-hidden>
        {TOKEN_SEGMENTS.map((segment) => {
          const value = values[segment.key];
          return value > 0 ? (
            <span
              key={segment.key}
              style={{
                width: `${(value / Math.max(stackTotal, 1)) * 100}%`,
                backgroundColor: segment.color,
              }}
            />
          ) : null;
        })}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 md:flex md:flex-wrap md:gap-x-5">
        {TOKEN_SEGMENTS.map((segment) => (
          <div key={segment.key} className="flex items-center gap-1.5 text-xs md:gap-2">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: segment.color }}
              aria-hidden
            />
            <span className="text-muted-foreground md:hidden">{segment.shortLabel}</span>
            <span className="hidden text-muted-foreground md:inline">{segment.label}</span>
            <span className="font-mono">
              <NumberFlow
                value={values[segment.key]}
                locales="en-US"
                format={{ notation: "compact", maximumFractionDigits: 1 }}
              />
            </span>
          </div>
        ))}
      </div>

      {topModels.length > 0 && (
        <div className="mt-3 border-t border-line md:py-3">
          <div className="grid divide-y divide-line md:grid-cols-3 md:divide-x md:divide-y-0">
            {topModels.map((item, index) => (
              <div
                key={item.model}
                className="flex min-w-0 items-center gap-3 py-3 md:px-4 md:py-0 md:first:pl-0 md:last:pr-0"
              >
                <RankMark rank={index} />
                <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <ModelProviderIcon model={item.model} />
                    <div className="truncate text-sm font-medium" title={item.model}>
                      {formatModelName(item.model)}
                    </div>
                  </div>
                  <div className="shrink-0 font-mono text-xs text-muted-foreground">
                    <NumberFlow
                      value={item.tokens}
                      locales="en-US"
                      format={{ notation: "compact", maximumFractionDigits: 1 }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const SESSION_WINDOW_MAX_MINUTES = 1440;

// Cursor 按键匹配；按时长推断会把 tertiary 误当专项窗口而剔除。
const FEATURED_LIMITS: Record<
  string,
  ReadonlyArray<{ slot: FeaturedLimitSlot; title: string }>
> = {
  claude: [
    { slot: "session", title: "5-hour limit" },
    { slot: "weekly", title: "Weekly · all models" },
    { slot: "fable", title: "Weekly · Fable only" },
  ],
  cursor: [
    { slot: "cursor.secondary", title: "Monthly · Cursor models" },
    { slot: "cursor.tertiary", title: "Monthly · other models" },
    { slot: "cursor.quaternary", title: "Weekly · Grok Bot" },
  ],
};

type FeaturedLimitSlot =
  | "session"
  | "weekly"
  | "fable"
  | "cursor.secondary"
  | "cursor.tertiary"
  | "cursor.quaternary";

function isNamedLimit(limit: VibeCodingLimit, name: string) {
  return `${limit.key} ${limit.label ?? ""}`.toLowerCase().includes(name);
}

function isSparkWindow(limit: VibeCodingLimit) {
  return (
    limit.key.endsWith(".tertiary") ||
    isNamedLimit(limit, "spark") ||
    isNamedLimit(limit, "bengalfox")
  );
}

function isExtraWindow(limit: VibeCodingLimit) {
  return isSparkWindow(limit) || limit.key.includes("weekly-scoped") || isNamedLimit(limit, "fable");
}

function isSessionWindow(limit: VibeCodingLimit) {
  return (
    limit.group === "session" ||
    (limit.windowMinutes != null && limit.windowMinutes < SESSION_WINDOW_MAX_MINUTES)
  );
}

function limitSlot(limit: VibeCodingLimit): "session" | "weekly" | null {
  if (isExtraWindow(limit)) return null;
  return isSessionWindow(limit) ? "session" : "weekly";
}

function pickSlotLimit(limits: VibeCodingLimit[], slot: FeaturedLimitSlot) {
  if (slot === "fable") {
    return limits.find((limit) => isNamedLimit(limit, "fable")) ?? null;
  }
  if (slot !== "session" && slot !== "weekly") {
    return limits.find((limit) => limit.key === slot) ?? null;
  }
  const matched = limits.filter((limit) => limitSlot(limit) === slot);
  if (matched.length === 0) return null;
  if (slot === "weekly") {
    return matched.find((limit) => limit.key === "weekly_all") ?? matched[0] ?? null;
  }
  return matched.find((limit) => limit.key.endsWith(".primary")) ?? matched[0] ?? null;
}

function compactLimit(row: Pick<CodingAgentRow, "limits">, now: number) {
  return busiestLimit(row.limits, now);
}

type FeaturedLimitRow =
  | { kind: "limit"; key: string; title: string; limit: VibeCodingLimit }
  | { kind: "unavailable"; key: string; title: string; reason: string };

function featuredLimitRows(row: Pick<CodingAgentRow, "id" | "limits" | "limitsError">): FeaturedLimitRow[] {
  const slots = Object.hasOwn(FEATURED_LIMITS, row.id) ? FEATURED_LIMITS[row.id]! : [];
  return slots.map(({ slot, title }) => {
    const limit = pickSlotLimit(row.limits, slot);
    if (limit) return { kind: "limit" as const, key: slot, title, limit };
    return {
      kind: "unavailable" as const, key: slot, title,
      reason: row.limitsError ?? "No limit reported for this window",
    };
  });
}

const WEEK_MS = 7 * 86_400_000;
// setTimeout 超过 2^31-1 会立即触发，且调用处还要加等待余量。
const MAX_TIMEOUT_MS = 24 * 86_400_000;

type ResetDisplay =
  | { kind: "relative"; hours: number; minutes: number }
  | { kind: "absolute"; text: string };

function formatReset(resetsAt: number | null, referenceTime: number): ResetDisplay | null {
  if (resetsAt == null) return null;
  const remain = resetsAt * 1000 - referenceTime;
  if (remain <= 0) return null;
  if (remain >= 86_400_000) {
    const at = new Date(Math.round(resetsAt / 60) * 60_000);
    if (remain >= WEEK_MS) {
      return {
        kind: "absolute",
        text: `Resets ${at.toLocaleString("en-US", { month: "short", day: "numeric" })}`,
      };
    }
    const weekday = at.toLocaleString("en-US", { weekday: "short" });
    const clock = at.toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
    return { kind: "absolute", text: `Resets ${weekday} ${clock}` };
  }
  const totalMinutes = Math.floor(remain / 60_000);
  return {
    kind: "relative",
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  };
}

function nextTickDelay(remain: number) {
  if (remain > WEEK_MS) return Math.min(remain - WEEK_MS, MAX_TIMEOUT_MS);
  if (remain > 86_400_000) return remain - 86_400_000;
  if (remain <= 60_000) return Math.max(0, remain);
  return remain % 60_000 || 60_000;
}

type CompactResetDisplay =
  | { kind: "relative"; hours: number; minutes: number }
  | { kind: "days"; days: number; hours: number };

function formatCompactReset(
  resetsAt: number | null,
  referenceTime: number,
): CompactResetDisplay | null {
  if (resetsAt == null) return null;
  const remain = resetsAt * 1000 - referenceTime;
  if (remain <= 0) return null;
  if (remain >= 86_400_000) {
    return {
      kind: "days",
      days: Math.floor(remain / 86_400_000),
      hours: Math.floor((remain % 86_400_000) / 3_600_000),
    };
  }
  const totalMinutes = Math.floor(remain / 60_000);
  return {
    kind: "relative",
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  };
}

// 倒计时可能几天不醒，配速指示器必须独立排期。
function paceTickInterval(windowMs: number) {
  return Math.min(Math.max(windowMs / 500, 60_000), 10 * 60_000);
}

// 分组名不是窗口时长，不能从 weekly 推断起点。
function limitPace(limit: VibeCodingLimit, now: number): number | null {
  if (!now || limit.windowMinutes == null || limit.resetsAt == null) return null;
  const windowMs = limit.windowMinutes * 60_000;
  if (windowMs <= 0) return null;
  const remain = limit.resetsAt * 1000 - now;
  if (remain <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - remain / windowMs));
}

function PaceMarker({ pace, overPace }: { pace: number; overPace: boolean }) {
  if (pace < 0.1 || pace > 0.9) return null;

  return (
    <span
      aria-hidden
      className="absolute inset-y-0 flex w-1.5 justify-center bg-surface"
      style={{ left: `calc(${pace * 100}% - 3px)` }}
    >
      <span
        className="w-0.5"
        style={{ backgroundColor: overPace ? LIMIT_OVER_PACE_COLOR : LIMIT_ON_PACE_COLOR }}
      />
    </span>
  );
}

function nextCompactTickDelay(remain: number) {
  if (remain > 86_400_000) return remain % 3_600_000 || 3_600_000;
  if (remain <= 60_000) return Math.max(0, remain);
  return remain % 60_000 || 60_000;
}

function UsageMeter({
  href,
  label,
  children,
}: {
  href: string | null;
  label: string;
  children?: ReactNode;
}) {
  if (!href) {
    return <div className="relative mt-1.5 h-1.5 overflow-hidden bg-muted">{children}</div>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={label}
      className="-mb-3 block pt-1.5 pb-3 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-live"
    >
      <span className="relative block h-1.5 overflow-hidden bg-muted">{children}</span>
    </a>
  );
}

function LimitMeter({
  limit,
  title,
  href,
  label,
}: {
  limit: VibeCodingLimit;
  title: string;
  href: string | null;
  label: string;
}) {
  const mountedAt = useMountedAt();
  const [ticked, setTicked] = useState(0);
  const now = ticked || mountedAt;
  useEffect(() => {
    if (!now || limit.resetsAt == null) return;
    const target = limit.resetsAt * 1000;
    if (now >= target) return;
    // now 是上次唤醒的快照；按它计算延迟会把已过去的时间再加一遍。
    const timer = window.setTimeout(
      () => setTicked(Date.now()),
      nextTickDelay(target - Date.now()) + 500,
    );
    return () => window.clearTimeout(timer);
  }, [limit.resetsAt, now]);

  const expired = limit.resetsAt != null && limit.resetsAt * 1000 <= now;
  const usedPercent = expired ? 0 : limit.usedPercent;

  const windowMs = limit.windowMinutes != null ? limit.windowMinutes * 60_000 : null;
  useEffect(() => {
    if (!now || windowMs == null || windowMs <= 0) return;
    const timer = window.setInterval(() => setTicked(Date.now()), paceTickInterval(windowMs));
    return () => window.clearInterval(timer);
  }, [now, windowMs]);

  const pace = limitPace(limit, now);
  const overPace = pace != null && usedPercent / 100 > pace;
  const color = limitColor(usedPercent);
  const reset = now ? formatReset(limit.resetsAt, now) : null;

  return (
    <div>
      {/* NumberFlow 合成基线会撑高行盒，固定行高并居中才能保持两侧限额条对齐。 */}
      <div className="flex h-5 items-center justify-between gap-2">
        <span className="truncate text-xs" title={title}>
          {title}
        </span>
        <span className="flex shrink-0 items-baseline gap-2">
          {reset?.kind === "absolute" && (
            <span className="text-xs text-muted-foreground">{reset.text}</span>
          )}
          {reset?.kind === "relative" && (
            <NumberFlowGroup>
              <span className="text-xs tabular-nums text-muted-foreground">
                Resets in{" "}
                {reset.hours > 0 && (
                  <>
                    <NumberFlow value={reset.hours} locales="en-US" /> hr{" "}
                  </>
                )}
                {(reset.minutes > 0 || reset.hours === 0) && (
                  <>
                    <NumberFlow value={reset.minutes} locales="en-US" /> min
                  </>
                )}
              </span>
            </NumberFlowGroup>
          )}
          <span className="font-mono text-xs tabular-nums" style={{ color }}>
            <NumberFlow value={Math.round(usedPercent)} locales="en-US" />%
          </span>
        </span>
      </div>
      <UsageMeter href={href} label={label}>
        <div
          className="h-full transition-[width] duration-700 motion-reduce:transition-none"
          style={{ width: `${usedPercent}%`, backgroundColor: color }}
        />
        {pace != null && <PaceMarker pace={pace} overPace={overPace} />}
      </UsageMeter>
    </div>
  );
}

function LimitUnavailable({
  title,
  reason,
  href,
  label,
}: {
  title: string;
  reason: string;
  href: string | null;
  label: string;
}) {
  return (
    <div title={reason}>
      <div className="flex h-5 items-center justify-between gap-2">
        <span className="truncate text-xs">{title}</span>
        <span className="flex shrink-0 items-baseline gap-2">
          <span className="text-xs text-muted-foreground">Unavailable</span>
          <span className="label-mono text-muted-foreground">—</span>
        </span>
      </div>
      <UsageMeter href={href} label={label} />
    </div>
  );
}

function FeaturedMark({ row, active }: { row: Pick<CodingAgentRow, "id" | "icon" | "label">; active: boolean }) {
  if (row.id === "claude") return <ClaudeSpinner active={active} />;
  if (active) return <CodexActivityIndicator active />;
  return (
    <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
      {row.icon === "cursor" ? <CursorIcon size={18} /> : <BrandMark icon={row.icon} label={row.label} className="size-5" />}
    </span>
  );
}

const LIMITS_SILENT = "Limits reporter is silent";

function formatSiteDay(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function AgentPanel({
  row,
  macDeclaredOffline,
  clocks,
  today,
}: {
  row: CodingAgentRow;
  macDeclaredOffline: boolean;
  clocks: FirstFrameClocks;
  today: string | null;
}) {
  const limitsStale = useStale(row.limitsAt, AGENT_LIMITS_STALE_MS, clocks.limits);
  const lastDay = row.usage?.lastDay ?? null;
  const isToday = lastDay != null && today != null && lastDay.date === today;
  const { failing, notes } = codingSourceHealth(row.usage);
  const promptTokens =
    (lastDay?.inputTokens ?? 0) +
    (lastDay?.cacheCreationTokens ?? 0) +
    (lastDay?.cacheReadTokens ?? 0);
  const cacheHitRate = promptTokens
    ? ((lastDay?.cacheReadTokens ?? 0) / promptTokens) * 100
    : 0;
  const { active, sources, model } = useAgentActive(row, macDeclaredOffline, clocks);
  const displayModel = model ? displayModelName(model) : "No model";
  const rows = featuredLimitRows(limitsStale ? { ...row, limits: [], limitsError: LIMITS_SILENT } : row);
  const usageUrl = agentUsageUrl(row.id);
  return (
    <div className="flex min-w-0 flex-col px-4 py-4 md:px-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FeaturedMark row={row} active={active} />
          <span className="text-sm font-medium">{row.label}</span>
          {active && <ActiveBadge sources={sources} />}
        </div>
        <span
          className={cn(
            "label-mono truncate",
            active ? "text-live" : "text-muted-foreground",
          )}
          title={row.usage?.models.join(" · ") || undefined}
        >
          {displayModel}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-5">
        <div className="min-w-0">
          <div className="label-mono text-muted-foreground" title={describeCodingSources(notes) || undefined}>
            {lastDay && !isToday ? `Tokens · ${formatSiteDay(lastDay.date)}` : "Today Tokens"}
            <SourceIssue failing={failing} hasValue={lastDay != null} />
          </div>
          <div className="mt-1 text-3xl font-medium tracking-tight tabular-nums md:text-5xl">
            {lastDay ? (
              <NumberFlow
                value={lastDay.totalTokens}
                locales="en-US"
                format={{ notation: "compact", maximumFractionDigits: 1 }}
              />
            ) : <FlowDash />}
          </div>
        </div>
        <div className="grid gap-3 border-l border-line pl-4">
          <div title="At public API prices">
            <div className="label-mono text-muted-foreground">Cost</div>
            <div className="mt-1 font-mono text-sm">
              {lastDay && (lastDay.costComplete || lastDay.apiEquivalentCostUSD > 0)
                ? `$${lastDay.apiEquivalentCostUSD.toFixed(2)}`
                : "—"}
            </div>
          </div>
          <div>
            <div className="label-mono text-muted-foreground">Hit</div>
            <div className="mt-1 font-mono text-sm">{lastDay ? `${cacheHitRate.toFixed(1)}%` : "—"}</div>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 border-t border-line pt-4">
        <div className="label-mono text-muted-foreground">
          Limits
          {row.plan && (
            <span title={`Plan ${row.plan.tier}`}>
              <span aria-hidden className="mx-1.5">
                ·
              </span>
              <span className="font-sans normal-case">{row.plan.label}</span>
            </span>
          )}
        </div>
        {rows.map((limitRow) =>
          limitRow.kind === "limit" ? (
            <LimitMeter
              key={limitRow.key}
              limit={limitRow.limit}
              title={limitRow.title}
              href={usageUrl}
              label={agentUsageLabel(row.label, limitRow.title)}
            />
          ) : (
            <LimitUnavailable
              key={limitRow.key}
              title={limitRow.title}
              reason={limitRow.reason}
              href={usageUrl}
              label={agentUsageLabel(row.label, limitRow.title)}
            />
          ),
        )}
      </div>
    </div>
  );
}

function CompactAgentRow({
  row,
  macDeclaredOffline,
  clocks,
}: {
  row: CodingAgentRow;
  macDeclaredOffline: boolean;
  clocks: FirstFrameClocks;
}) {
  const limitsStale = useStale(row.limitsAt, AGENT_LIMITS_STALE_MS, clocks.limits);
  const mountedAt = useMountedAt();
  const [ticked, setTicked] = useState(0);
  const now = ticked || mountedAt;
  const limit = limitsStale ? null : compactLimit(row, now);
  const usedPercentValue = limit?.usedPercent ?? null;
  const resetsAt = limit?.resetsAt ?? null;
  useEffect(() => {
    if (!now || resetsAt == null) return;
    const target = resetsAt * 1000;
    if (now >= target) return;
    const timer = window.setTimeout(
      () => setTicked(Date.now()),
      nextCompactTickDelay(target - Date.now()) + 500,
    );
    return () => window.clearTimeout(timer);
  }, [resetsAt, now]);

  const expired = resetsAt != null && resetsAt * 1000 <= now;
  const usedPercent =
    usedPercentValue == null ? null : expired ? 0 : usedPercentValue;
  const color = usedPercent == null ? undefined : limitColor(usedPercent);
  const reset = now ? formatCompactReset(resetsAt, now) : null;

  const windowMs = limit?.windowMinutes != null ? limit.windowMinutes * 60_000 : null;
  useEffect(() => {
    if (!now || windowMs == null || windowMs <= 0) return;
    const timer = window.setInterval(() => setTicked(Date.now()), paceTickInterval(windowMs));
    return () => window.clearInterval(timer);
  }, [now, windowMs]);

  const pace = limit ? limitPace(limit, now) : null;
  const overPace = pace != null && usedPercent != null && usedPercent / 100 > pace;
  const { active, sources } = useAgentActive(row, macDeclaredOffline, clocks);
  const usageUrl = agentUsageUrl(row.id);

  return (
    <div
      className="min-w-0 py-3"
      title={limitsStale ? LIMITS_SILENT : (row.limitsError ?? undefined)}
    >
      <div className="flex flex-col gap-1 md:h-5 md:flex-row md:items-center md:justify-between md:gap-2">
        <div className="flex h-5 min-w-0 items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
            {row.id === "codex" ? (
              <CodexActivityIndicator active={active} />
            ) : (
              <BrandMark icon={row.icon} label={row.label} className="size-5" />
            )}
          </span>
          <span className="truncate text-sm font-medium">{row.label}</span>
          {active && <ActiveBadge sources={sources} />}
        </div>
        <span className="flex h-5 min-w-0 items-baseline gap-2 text-xs text-muted-foreground md:shrink-0">
          {row.plan && (
            <span className="truncate" title={`Plan ${row.plan.tier}`}>
              {row.plan.label}
            </span>
          )}
          {row.plan && reset && (
            <span aria-hidden className="mx-1.5">
              /
            </span>
          )}
          {reset?.kind === "days" && (
            <NumberFlowGroup>
              <span className="shrink-0 whitespace-nowrap tabular-nums">
                Resets in{" "}
                <NumberFlow value={reset.days} locales="en-US" />{" "}
                {reset.days === 1 ? "day" : "days"}
                {reset.hours > 0 && (
                  <>
                    {" "}
                    <NumberFlow value={reset.hours} locales="en-US" /> hr
                  </>
                )}
              </span>
            </NumberFlowGroup>
          )}
          {reset?.kind === "relative" && (
            <NumberFlowGroup>
              <span className="shrink-0 whitespace-nowrap tabular-nums">
                Resets in{" "}
                {reset.hours > 0 && (
                  <>
                    <NumberFlow value={reset.hours} locales="en-US" /> hr{" "}
                  </>
                )}
                {(reset.minutes > 0 || reset.hours === 0) && (
                  <>
                    <NumberFlow value={reset.minutes} locales="en-US" /> min
                  </>
                )}
              </span>
            </NumberFlowGroup>
          )}
          {usedPercent == null ? (
            <span
              className="label-mono ml-auto shrink-0 text-muted-foreground md:ml-0"
              title="Unavailable"
            >
              —
            </span>
          ) : (
            <span
              className="ml-auto shrink-0 font-mono tabular-nums md:ml-0"
              style={{ color }}
            >
              <NumberFlow value={Math.round(usedPercent)} locales="en-US" />%
            </span>
          )}
        </span>
      </div>
      <UsageMeter href={usageUrl} label={agentUsageLabel(row.label)}>
        {usedPercent != null && (
          <div
            className="h-full transition-[width] duration-700 motion-reduce:transition-none"
            style={{ width: `${usedPercent}%`, backgroundColor: color }}
          />
        )}
        {pace != null && <PaceMarker pace={pace} overPace={overPace} />}
      </UsageMeter>
    </div>
  );
}

function CompactAgents({
  rows,
  macDeclaredOffline,
  clocks,
}: {
  rows: CodingAgentRow[];
  macDeclaredOffline: boolean;
  clocks: FirstFrameClocks;
}) {
  if (rows.length === 0) return null;
  const sortedRows = [...rows].sort((left, right) => {
    const leftUsed = compactLimit(left, 0)?.usedPercent ?? -1;
    const rightUsed = compactLimit(right, 0)?.usedPercent ?? -1;
    return rightUsed - leftUsed;
  });
  return (
    <div className="border-t border-line px-4 md:px-5">
      <div className="grid divide-y divide-line">
        {sortedRows.map((row) => (
          <CompactAgentRow
            key={row.id}
            row={row}
            macDeclaredOffline={macDeclaredOffline}
            clocks={clocks}
          />
        ))}
      </div>
    </div>
  );
}

export function VibeCodingCard({
  fallback,
  nowFallback,
  limitsFallback,
  className,
}: {
  fallback: StatusResponse<CodingUsagePayload>;
  nowFallback: StatusResponse<CodingNowPayload>;
  limitsFallback: StatusResponse<AgentLimitsPayload>;
  className?: string;
}) {
  useLiveEvents();
  const { data: usage, servedAt: usageServedAt } = useStatus<CodingUsagePayload>(CODING_PATH, REFRESH_MS, { fallback });
  const {
    data: now,
    servedAt: nowServedAt,
    isValidating: nowValidating,
  } = useStatus<CodingNowPayload>(CODING_NOW_PATH, REFRESH_MS, { fallback: nowFallback });
  const { data: limits, servedAt: limitsServedAt } = useStatus<AgentLimitsPayload>(LIMITS_PATH, {
    fallback: limitsFallback,
  });
  const clocks = useMemo<FirstFrameClocks>(
    () => ({ usage: usageServedAt, now: nowServedAt, nowValidating, limits: limitsServedAt }),
    [usageServedAt, nowServedAt, nowValidating, limitsServedAt],
  );
  const siteDay = useSiteDay();
  const today = siteDay ?? (usageServedAt != null ? zonedDay(usageServedAt, site.timezone) : null);
  const macDeclaredOffline = Boolean(now?.declaredOffline);
  const rows = usage || now || limits ? codingAgentRows(usage ?? null, now ?? null, limits ?? null) : null;
  const totalFailing = (rows ?? []).flatMap((row) =>
    codingSourceHealth(row.usage).failing.map((note) => ({ ...note, label: `${row.label} · ${note.label}` })),
  );

  return (
    <Card
      id="vibe-coding"
      label="Vibe Coding"
      action="All sources"
      className={cn("md:col-span-2", className)}
    >
      {rows ? (
        <>
          {usage?.totals ? (
            <TotalUsage totals={usage.totals} topModels={usage.topModels} failing={totalFailing} />
          ) : (
            <div className="border-b border-line px-4 py-5 text-sm text-muted-foreground md:px-5">
              Waiting for usage reports
            </div>
          )}
          <div className="grid grid-cols-1 divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
            {rows.filter((row) => row.row === "featured").map((row) => (
              <AgentPanel
                key={row.id}
                row={row}
                macDeclaredOffline={macDeclaredOffline}
                clocks={clocks}
                today={today}
              />
            ))}
          </div>
          <CompactAgents
            rows={rows.filter((row) => row.row === "compact")}
            macDeclaredOffline={macDeclaredOffline}
            clocks={clocks}
          />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-5 border-b border-line px-5 py-5 md:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <div key={index} className="animate-pulse">
                <div className="h-3 w-20 rounded bg-muted" />
                <div className="mt-3 h-9 w-24 rounded bg-muted" />
              </div>
            ))}
          </div>
          <div className="grid min-h-64 grid-cols-1 divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
            {["Claude Code", "Cursor"].map((label) => (
              <div key={label} className="animate-pulse px-5 py-4">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-24 rounded bg-muted" />
                  <div className="h-4 w-14 bg-muted" />
                </div>
                <div className="mt-6 h-12 w-36 rounded bg-muted" />
                <div className="mt-6 h-1.5 bg-muted" />
                <div className="mt-3 h-1.5 bg-muted" />
                <div className="mt-3 h-1.5 bg-muted" />
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
