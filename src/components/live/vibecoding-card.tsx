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
  codingAgentRows,
  codingDisplayModel,
  codingSourceHealth,
  describeCodingSources,
  liveCodingActivity,
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

/**
 * 默认那一扇窗口：几条里取用量最高的，并列时留先出现的。
 *
 * 先剔掉专项窗口 —— Spark / Fable 那类不代表这个 agent 的整体余量，全量
 * 面板的主额度槽也是这么挡的（isExtraWindow），两条渲染路径得给同一个答案。
 * 已经过点的窗口按 0 参与：刚重置的那扇不该压过另一扇还有 60% 的。
 * `now` 为 0（还没挂载）时不判过期，挂载后的重渲染会自己纠正。
 */
function busiestLimit(limits: VibeCodingLimit[], now: number) {
  const candidates = limits.filter((limit) => !isExtraWindow(limit));
  if (candidates.length === 0) return null;
  const effective = (limit: VibeCodingLimit) =>
    now && limit.resetsAt != null && limit.resetsAt * 1000 <= now ? 0 : limit.usedPercent;
  return candidates.reduce((best, row) => (effective(row) > effective(best) ? row : best));
}

/** 用量视图与此刻两份的轮询间隔；此刻那份变了另有推送（`coding-now`，整份） */
const REFRESH_MS = 2 * 60_000;

/**
 * 首帧的钟：用量、此刻、限额是三份首屏信封（各自的首屏缓存条目、各自的填充时刻），
 * 各判各的就拿各自的 servedAt（见 hooks/use-stale）。挂载后都换浏览器的钟。
 */
type FirstFrameClocks = {
  /** /api/status/coding：今天是哪一天 */
  usage?: number;
  /** /api/status/coding/now：活动灯 */
  now?: number;
  /**
   * 此刻那份 SWR 键在不在回源。活动灯按钟判的熄灭要过 useConfirmedStale：放了五分钟
   * 以上的首屏 HTML 挂载时按访客钟全都「过了五分钟」，不挡的话灯先灭、回源回来再亮。
   */
  nowValidating: boolean;
  /** /api/status/limits：限额读数 */
  limits?: number;
};

/**
 * 这盏灯亮不亮：各来源最近一条用量事件里有效的最新那条（lib/coding-agents 的
 * liveCodingActivity：Mac 亲口离线时 mac 那一路作废）离此刻不超过 CODING_ACTIVE_WINDOW_MS。
 * 只看时刻、没有要和存活取与的电平：采集停了时刻就不前进，窗口到点自己灭。
 */
function useAgentActive(row: CodingAgentRow, macDeclaredOffline: boolean, clocks: FirstFrameClocks) {
  const live = liveCodingActivity(row.activity, macDeclaredOffline);
  const expired = useConfirmedClockStale(live?.lastActivityAt, CODING_ACTIVE_WINDOW_MS, {
    validating: clocks.nowValidating,
    servedAt: clocks.now,
  });
  const mountedAt = useMountedAt();
  // 首帧有 servedAt 当钟就照它判（首屏填缓存那一刻的结论）；连它也没有才等挂载
  const clockKnown = mountedAt > 0 || clocks.now != null;
  const active = live != null && clockKnown && !expired;
  return { active, source: active ? live.source : null, model: codingDisplayModel(row, live, active) };
}

/** 亮着那条来自哪：本机扫描是 Mac，其余（账号、云端遥测）都在云上 */
function ActiveBadge({ source }: { source: CodingActivityEntry["source"] | null }) {
  const label = source ? (CODING_SOURCE_LABELS[source] ?? source) : undefined;
  return (
    <span className="flex shrink-0 items-center gap-1 text-live" title={label ? `Active on ${label}` : undefined}>
      <span className="label-mono">Active</span>
      {source === "mac" ? (
        <MacBookProIcon className="size-3.5" aria-label={label} />
      ) : source ? (
        <Cloud className="size-3.5" aria-label={label} />
      ) : null}
    </span>
  );
}

/**
 * Cursor 的 Bugbot、Grok Bot 用量事件报的是内部名，面板上换成产品名。
 * 其余模型名照原样显示，和其他几家一致。
 */
function displayModelName(model: string) {
  if (model === "github_bugbot") return "Bugbot";
  if (model.startsWith("grok-bot-")) return "Grok Bot";
  if (model === "agent_review") return "Agent Review";
  return model;
}

/**
 * 分档阈值。条和数字共用同一组，别在两处各写一遍 —— 分开写迟早改漏一个，
 * 出现「条红了数字还是蓝的」。
 *
 * 这两个数是拍的，不是上游给的：Codex 的响应带 severity 字段，Claude 那边没有，
 * 两边口径对不齐，索性都按百分比自己判，至少行为一致。
 */
const LIMIT_WARN_PERCENT = 75;
const LIMIT_ALERT_PERCENT = 90;
/**
 * 跟同文件的 TOKEN_SEGMENTS 一样直接写 oklch 字面量、不进主题变量：
 * 这是数据编码色，不该被亮暗主题改掉 —— 尤其告警那支，红就得是红。
 * 常态色沿用 TOKEN_SEGMENTS 里 Input 那支蓝，同一张卡里不再多引入一种色相。
 */
const LIMIT_BAR_COLOR = "oklch(0.63 0.18 250)";
/** 预警档。沿用同文件 Cache read 那支琥珀（也是 --live-idle 的色相），不另挑一支黄。 */
const LIMIT_WARN_COLOR = "oklch(0.72 0.16 75)";
const LIMIT_ALERT_COLOR = "oklch(0.62 0.21 25)";
/**
 * 配速指示器那根竖线的两支颜色：用得比时钟快是红，没快是绿。
 *
 * 红是告警那支；绿沿用 --live 那支的色相，不为这件事再引入新色相。
 * 条本身不受影响，仍按用量分档 —— 见 LimitMeter 里的 overPace。
 */
const LIMIT_OVER_PACE_COLOR = LIMIT_ALERT_COLOR;
const LIMIT_ON_PACE_COLOR = "oklch(0.65 0.17 145)";

/** 蓝 → 琥珀 → 红，只有三档没有渐变：中间色会让人去猜具体数，而数就写在旁边 */
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

/**
 * 品牌图标，按站点登记表（lib/coding-agents）给的 `icon` 键取 —— 不是按 `id`：id 是
 * agent 的名字，这个是牌子，两者不一定一致。
 *
 * 认不出来的键退回首字母。上报器新配一个 agent 时页面上立刻就该有一行，
 * 图标是后补的事，不该因为少一个矢量就让那行的限额也跟着看不见。
 */
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
    // 这个牌子只有黑白两色，Mono 就是它的本来面目，不是退而求其次
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

/**
 * 名次色跟 AIHOT 排行榜一致：无底色圆，只是等宽加粗数字上色。
 * https://aihot.virxact.com/leaderboard
 *
 * 和同文件的 TOKEN_SEGMENTS / LIMIT_*_COLOR 一样写 oklch 字面量、不进主题变量：
 * 这是数据编码色（金银铜对齐排行榜的名次语义），不该被亮暗主题改掉。
 * 三个值是原来那三支 hex 的等价换算，往返回 sRGB 逐通道一字不差。
 */
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

/**
 * 首字母大写。空段原样返回 —— `part[0]` 在空串上是 undefined，
 * 直接 `.toUpperCase()` 会抛 TypeError。
 */
function capitalize(part: string) {
  return part ? `${part[0].toUpperCase()}${part.slice(1)}` : part;
}

/**
 * 模型名是上报器那侧的原样字符串，前端没有清洗：一条尾随连字符（`gpt-4-`）、
 * 连着两个连字符（`gpt-5--pro`）或者空串，都会切出空段来。这是渲染期调用的
 * 纯函数，抛出去就是整张卡连同「Vibe Coding」区块一起白掉，所以一律走
 * capitalize，绝不假设段非空。
 */
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

/**
 * 有来源采集失败时标在用量读数旁边：数字只含其余来源和它失败前的旧账，别当完整值读。
 * 有读数时说 Partial，一个读数都没有（全靠失败的那个来源）时说 Unavailable。
 */
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
  /** 各 agent 里采集失败的来源，见 SourceIssue */
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
            {/* 没有一个来源数得出会话（只有 Cursor 账号那种）时是 null，不是 0 */}
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

/** 判定「当日档」的上限。跨过一天的窗口按周额度那类算，不该顶替 5 小时档。 */
const SESSION_WINDOW_MAX_MINUTES = 1440;

/**
 * 全量面板固定画的几条限额窗口，按 agent id。站点登记表（lib/coding-agents 的 CODING_AGENTS）
 * 里 `row: "featured"` 的 agent 要在这里有一项，否则面板的限额区是空的。
 *
 * Claude 的窗口按时长和名字认；Cursor 按上报器的键直接认。
 *
 * Cursor 三行对它网页 dashboard 的三根条：自家模型、其他模型两个月度池子，加 Grok Bot
 * 周额度。套餐总额那扇（cursor.primary）不画，它只是两个池子折算后的合计。
 * 不能走时长推断：`cursor.tertiary` 会被 isSparkWindow 的 `.tertiary` 规则当成专项
 * 窗口剔掉 —— 那恰好常是最紧的一条。口径见 agents-reporter 的 providers/cursor.ts。
 */
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

/** 紧凑行只显示最紧的主额度窗口。 */
function compactLimit(row: Pick<CodingAgentRow, "limits">, now: number) {
  return busiestLimit(row.limits, now);
}

type FeaturedLimitRow =
  | { kind: "limit"; key: string; title: string; limit: VibeCodingLimit }
  | { kind: "unavailable"; key: string; title: string; reason: string };

/** 固定三行，取不到的那行留着占位写 Unavailable，不让面板高度跟着变。 */
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

/**
 * 重置时刻。
 *
 * 一天以内说还剩多久，超过一天直接报星期几几点 —— 「2 天 13 小时后」要在脑子里
 * 换算一次才知道是哪天，而周额度重置本来就是个固定时刻，直接说更省事。
 * 跟 Claude Code 自己 /usage 面板的分档一致。
 *
 * resetsAt 是 Unix 秒，不是毫秒。
 */
const WEEK_MS = 7 * 86_400_000;
/** setTimeout 的上限是 2^31-1 毫秒（约 24.8 天），调用点还要再加半秒，留足余量 */
const MAX_TIMEOUT_MS = 24 * 86_400_000;

type ResetDisplay =
  /** 一天以内：时和分要滚，所以拆成数字，不拼成整句 */
  | { kind: "relative"; hours: number; minutes: number }
  /** 超过一天：是个固定时刻，不随时间变，也就没有可滚的 */
  | { kind: "absolute"; text: string };

function formatReset(resetsAt: number | null, referenceTime: number): ResetDisplay | null {
  if (resetsAt == null) return null;
  const remain = resetsAt * 1000 - referenceTime;
  // 已经过点了就不显示：这份快照只是还没刷新，倒计时写成负数更容易让人误会
  if (remain <= 0) return null;
  if (remain >= 86_400_000) {
    // 四舍五入到整分：同时重置的两条上游给的是 02:59:59 和 03:00:00，
    // 直接截断会显示成差一分钟，看着像两个不同的时刻
    const at = new Date(Math.round(resetsAt / 60) * 60_000);
    // 一周以外说星期几就分不清是哪一周了（Cursor 是按月的计费周期），改报日期
    if (remain >= WEEK_MS) {
      return {
        kind: "absolute",
        text: `Resets ${at.toLocaleString("en-US", { month: "short", day: "numeric" })}`,
      };
    }
    // 分两次格式化：合在一起 en-US 会插一个逗号（"Mon, 11:00 AM"）
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

/**
 * 距离下一次「显示会变」还有多久。
 *
 * 只在文案真的会变的时刻醒，不做无谓的定时重渲染：
 *
 * - 超过一天时显示的是「Resets Mon 11:00 AM」或「Resets Oct 16」，那句话跟时间
 *   流逝无关，只在跌破一周（日期换星期几）和跌破一天（换相对写法）时才需要醒。
 * - 一天以内显示到分钟，所以在每个整分边界醒一次。
 * - 剩不到一分钟时直接等到点，那一下要同时翻文案和把条归零。
 */
function nextTickDelay(remain: number) {
  // 超过上限的延迟会立刻触发、每轮重排停不下来，月度窗口够得着这个数
  if (remain > WEEK_MS) return Math.min(remain - WEEK_MS, MAX_TIMEOUT_MS);
  if (remain > 86_400_000) return remain - 86_400_000;
  if (remain <= 60_000) return Math.max(0, remain);
  return remain % 60_000 || 60_000;
}

/**
 * 紧凑行的重置文案。
 *
 * 全量面板的窗口写着 Weekly，报「Resets Mon 11:00 AM」不会误会是哪一周。
 * 这里没有窗口名：Cursor 可能是月、Antigravity 是周，用星期几就会歧义，
 * 一律说还剩几天 / 几小时。
 */
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

/**
 * 配速指示器自己的刷新节奏：让它每次大约挪动 0.2% 的宽度。
 *
 * 不能搭 nextTickDelay 的车 —— 那个是给重置倒计时排的，剩余超过一天时它一觉睡到
 * 「还剩 24 小时」，7 天那条窗口的指示器会几天不动。上下限是防两头：5 小时窗口
 * 按 0.2% 算是 36 秒，太密；7 天窗口是 20 分钟，太疏。
 */
function paceTickInterval(windowMs: number) {
  return Math.min(Math.max(windowMs / 500, 60_000), 10 * 60_000);
}

/**
 * 这个限额窗口走到哪儿了（0~1），指示器就钉在这个位置。
 *
 * 窗口起点由 `resetsAt - windowMinutes` 反推 —— 两个字段缺一就返回 null，那时不画
 * 指示器。**不能拿 `group` 里那个 "weekly" 当七天用**，契约里明写着展示层不得由分组
 * 反推窗口时长（见 types 的 VibeCodingLimit）。眼下 Grok 和 Antigravity 就是只给了
 * resetsAt 没给窗口时长，知道什么时候结束推不出什么时候开始。
 *
 * `now` 为 0（首帧还没有访客钟）时也返回 null：这是拿当下时刻算的东西，服务端那一遍
 * 算不得数，画了必然水合不一致。
 */
function limitPace(limit: VibeCodingLimit, now: number): number | null {
  if (!now || limit.windowMinutes == null || limit.resetsAt == null) return null;
  const windowMs = limit.windowMinutes * 60_000;
  if (windowMs <= 0) return null;
  const remain = limit.resetsAt * 1000 - now;
  // 已经过点了：新周期刚从头开始
  if (remain <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - remain / windowMs));
}

/**
 * 配速指示器：这个周期走到哪儿了。用量条超过它说明用得比时钟快，标记变红；没超是绿。
 *
 * 两侧各切开一小段底色，标记才不会和「已用」那段糊成一片。整块 6px 宽，居中 2px 是
 * 标记本身；往左挪半个身位，让它正落在刻度上而不是刻度右边。
 */
function PaceMarker({ pace, overPace }: { pace: number; overPace: boolean }) {
  // 只在周期进度 10%–90%（含边界）之间显示，避免贴住限额条两端。
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

/** 超过一天时按小时刷新，一天以内按分钟。 */
function nextCompactTickDelay(remain: number) {
  if (remain > 86_400_000) return remain % 3_600_000 || 3_600_000;
  if (remain <= 60_000) return Math.max(0, remain);
  return remain % 60_000 || 60_000;
}

/**
 * 进度条本身是链接。条只有 6px：上方的间距改成链接自己的内边距，下方补到和下一行
 * 之间的缝一样高，再用负边距把多出来的高度还回去，行距不变，点击区凑够 24px。没有官方用量页的 agent（Antigravity）保持普通条。
 */
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
  /**
   * 自己盯着重置时刻，不跟面板其它部分共用快照时间。
   *
   * 快照时间是采集那一刻，用它当基准的话「重置到点了」这件事前端永远感知不到 ——
   * 倒计时是冻住的，只在新数据到达时跳一下。NAS 上报器几分钟才重取一次限额，
   * 再等站点轮询，这段时间里这根条会一直显示上一个周期的百分比。
   * 那个数是确定错的：周期已经翻篇了。
   *
   * 到点归零不是编数据 —— 重置那一刻用量就是零。之后至多低估这几分钟新用掉的
   * 量，比挂着一个上个周期的旧值准得多。
   *
   * 用一次性 setTimeout 而不是轮询式计时器：数据没变时轮询不会触发重渲染
   * （响应体已经不带时间戳了），光靠重渲染永远跨不过那个时刻；而定时器只在
   * 边界醒这一次，中间一点开销都没有。
   *
   * 首帧 now 是 0（见 useMountedAt），倒计时整块不画：它和「已过期」都是拿当下
   * 时刻算的，服务端那一遍算不得数 —— 超过一天的那支写成绝对时刻，
   * toLocaleString 不带 timeZone，服务端和访客各按各的时区格式化，水合必然对不
   * 上。行高由下面的 h-5 钉着，晚一拍出现也不会把版面顶开。
   */
  const mountedAt = useMountedAt();
  const [ticked, setTicked] = useState(0);
  const now = ticked || mountedAt;
  useEffect(() => {
    // 还没挂载就没有基准可排，等 now 落地这个 effect 会再跑一遍
    if (!now || limit.resetsAt == null) return;
    const target = limit.resetsAt * 1000;
    // 已经跨过去了就不再排，否则下面每轮都会重排定时器，停不下来
    if (now >= target) return;
    /**
     * 延迟按真实当下算，不能用 now 去减。
     *
     * now 是上一次醒来时的快照；拿它算差值等于把「now 已经落后多久」又加了
     * 一遍，定时器会排到远超目标时刻之后。实测那样会晚三分钟才归零。
     */
    const timer = window.setTimeout(
      () => setTicked(Date.now()),
      // 多等半秒，避开时钟精度导致醒来时刚好差几毫秒没到点
      nextTickDelay(target - Date.now()) + 500,
    );
    return () => window.clearTimeout(timer);
  }, [limit.resetsAt, now]);

  const expired = limit.resetsAt != null && limit.resetsAt * 1000 <= now;
  const usedPercent = expired ? 0 : limit.usedPercent;

  /**
   * 指示器要自己往前走。
   *
   * 上面那个定时器是给重置倒计时排的，剩余超过一天时它一觉睡到「还剩 24 小时」——
   * 7 天那条窗口的指示器会几天钉在挂载时的位置上。数据每轮轮询都在刷新，但 `now`
   * 只有定时器醒来才动，光靠新数据到达它不会挪。
   */
  const windowMs = limit.windowMinutes != null ? limit.windowMinutes * 60_000 : null;
  useEffect(() => {
    if (!now || windowMs == null || windowMs <= 0) return;
    const timer = window.setInterval(() => setTicked(Date.now()), paceTickInterval(windowMs));
    return () => window.clearInterval(timer);
  }, [now, windowMs]);

  const pace = limitPace(limit, now);
  const overPace = pace != null && usedPercent / 100 > pace;
  const color = limitColor(usedPercent);
  // 基准跟着上面那个 now，条和文案才会在同一刻翻面
  const reset = now ? formatReset(limit.resetsAt, now) : null;

  return (
    <div>
      {/*
        行高钉死，不让内容决定。

        NumberFlow 是个 inline-block 的 web component，会把 text-xs 的行盒从
        16px 撑到 20px。限额窗口有的带重置倒计时、有的没有，因此两侧面板的
        行高可能不一样，两侧全量面板的进度条整列也会跟着错位。

        改 items-center：几个子元素都是 text-xs，视觉上和原来的 items-baseline
        没有区别，但不再受 NumberFlow 合成基线的影响。
      */}
      <div className="flex h-5 items-center justify-between gap-2">
        <span className="truncate text-xs" title={title}>
          {title}
        </span>
        <span className="flex shrink-0 items-baseline gap-2">
          {reset?.kind === "absolute" && (
            <span className="text-xs text-muted-foreground">{reset.text}</span>
          )}
          {reset?.kind === "relative" && (
            /* 和充电头的瓦数同一种滚动。套 NumberFlowGroup 才能让 59→00 那一下
               时和分同时翻，否则各滚各的、时间差看得出来 */
            <NumberFlowGroup>
              <span className="text-xs tabular-nums text-muted-foreground">
                Resets in{" "}
                {reset.hours > 0 && (
                  <>
                    <NumberFlow value={reset.hours} locales="en-US" /> hr{" "}
                  </>
                )}
                {/* 整点时不写「0 min」，读着像没写完 */}
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
          className="h-full transition-[width] duration-700"
          style={{ width: `${usedPercent}%`, backgroundColor: color }}
        />
        {pace != null && <PaceMarker pace={pace} overPace={overPace} />}
      </UsageMeter>
    </div>
  );
}

/** 预期有但取不到的窗口，保留原位以免整行消失。 */
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

/**
 * 全量面板的标。Claude 有自己的转圈；别家没有终端里那种活动动画，在用时借 Codex 的
 * Braille 转圈，闲着显示自己的牌子。在不在用见 useAgentActive。
 */
function FeaturedMark({ row, active }: { row: Pick<CodingAgentRow, "id" | "icon" | "label">; active: boolean }) {
  if (row.id === "claude") return <ClaudeSpinner active={active} />;
  if (active) return <CodexActivityIndicator active />;
  return (
    <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
      {row.icon === "cursor" ? <CursorIcon size={18} /> : <BrandMark icon={row.icon} label={row.label} className="size-5" />}
    </span>
  );
}

/** 限额上报器多久没来就不再展示那份读数，统一说取不到 */
const LIMITS_SILENT = "Limits reporter is silent";

/** 站点日（YYYY-MM-DD）写成 `Sep 28`。日期串本身就是站点日，按 UTC 读写，服务端和浏览器给同一个字 */
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
  /** Mac 亲口离线：活动灯里 mac 那一路作废，见 useAgentActive */
  macDeclaredOffline: boolean;
  clocks: FirstFrameClocks;
  /** 站点今天（YYYY-MM-DD）；首帧没有钟又没有 servedAt 时为 null，那时不认任何一天是今天 */
  today: string | null;
}) {
  /**
   * 限额在可滞后层，是另一台机器（NAS 上的容器上报器）报的，每轮必发，所以
   * 「多久没来」就是「它还活着没有」。过了阈值就不再画那份读数：固定的三行照样
   * 占位，统一写 Unavailable，别让访客拿停住的数字当此刻的余量。
   * 首帧拿限额那份首屏信封的 servedAt 当钟，放久了的 HTML 首帧就是 Unavailable。
   */
  const limitsStale = useStale(row.limitsAt, AGENT_LIMITS_STALE_MS, clocks.limits);
  /**
   * 用量视图给的是这个 agent 最近一个有行的站点日，是不是今天在这里判：不是今天就写明
   * 是哪一天，不把昨天的数当今天的。来源保证当天有行（没用就是一行 0），所以最近一天
   * 停在昨天说明今天还没报到，不是今天没用。
   */
  const lastDay = row.usage?.lastDay ?? null;
  const isToday = lastDay != null && today != null && lastDay.date === today;
  const { failing, notes } = codingSourceHealth(row.usage);
  const promptTokens =
    (lastDay?.inputTokens ?? 0) +
    (lastDay?.cacheCreationTokens ?? 0) +
    (lastDay?.cacheReadTokens ?? 0);
  // 命中只认 cache read；cache creation 是新写入，不能算作命中。
  // output 与 prompt cache 无关，也不应该进入分母。
  const cacheHitRate = promptTokens
    ? ((lastDay?.cacheReadTokens ?? 0) / promptTokens) * 100
    : 0;
  const { active, source, model } = useAgentActive(row, macDeclaredOffline, clocks);
  const displayModel = model ? displayModelName(model) : "No model";
  const rows = featuredLimitRows(limitsStale ? { ...row, limits: [], limitsError: LIMITS_SILENT } : row);
  const usageUrl = agentUsageUrl(row.id);
  return (
    <div className="flex min-w-0 flex-col px-4 py-4 md:px-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FeaturedMark row={row} active={active} />
          <span className="text-sm font-medium">{row.label}</span>
          {active && <ActiveBadge source={source} />}
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
  /** 和全量面板同一个开关，见 useAgentActive */
  macDeclaredOffline: boolean;
  clocks: FirstFrameClocks;
}) {
  // 和全量面板同一个判断：限额上报器过了阈值没来，这一行不再画读数
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

  /**
   * 配速指示器，和上面全量面板的限额条同一套。
   *
   * 这一行画的是 compactLimit 挑出的那条，所以指示器跟着的也是它。
   * 上面那个定时器最疏是按小时醒，31 天的窗口一小时才挪 0.13% —— 够用，但仍然
   * 单排一个：那个定时器的节奏是给重置倒计时定的，不该让指示器跟着它的取舍走。
   */
  const windowMs = limit?.windowMinutes != null ? limit.windowMinutes * 60_000 : null;
  useEffect(() => {
    if (!now || windowMs == null || windowMs <= 0) return;
    const timer = window.setInterval(() => setTicked(Date.now()), paceTickInterval(windowMs));
    return () => window.clearInterval(timer);
  }, [now, windowMs]);

  const pace = limit ? limitPace(limit, now) : null;
  const overPace = pace != null && usedPercent != null && usedPercent / 100 > pace;
  // 和全量面板同一盏灯，只是不像全量面板那样换模型名
  const { active, source } = useAgentActive(row, macDeclaredOffline, clocks);
  const usageUrl = agentUsageUrl(row.id);

  return (
    <div
      className="min-w-0 py-3"
      title={limitsStale ? LIMITS_SILENT : (row.limitsError ?? undefined)}
    >
      <div className="flex flex-col gap-1 md:h-5 md:flex-row md:items-center md:justify-between md:gap-2">
        <div className="flex h-5 min-w-0 items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
            {/* Codex 从全量面板挪下来，终端里那个 spinner 跟着它走 */}
            {row.id === "codex" ? (
              <CodexActivityIndicator active={active} />
            ) : (
              <BrandMark icon={row.icon} label={row.label} className="size-5" />
            )}
          </span>
          <span className="truncate text-sm font-medium">{row.label}</span>
          {active && <ActiveBadge source={source} />}
        </div>
        {/*
          读数和全量面板的 LimitMeter 一样放在条的上方、这一行的右端，条下面不再挂
          东西：站内所有进度条的文案都在条上方。窄屏时这一行单独一行，读数靠右。
          行高钉在 h-5，倒计时一换行就压到条上：倒计时不换行，放不下时截套餐名。
        */}
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
            className="h-full transition-[width] duration-700"
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
  // 排序不看过期（now 传 0）：这里只定行序，行内画什么由行自己判
  const sortedRows = [...rows].sort((left, right) => {
    const leftUsed = compactLimit(left, 0)?.usedPercent ?? -1;
    const rightUsed = compactLimit(right, 0)?.usedPercent ?? -1;
    return rightUsed - leftUsed;
  });
  /*
   * 竖向不留内边距：每行自己的 py-3 就是间距。容器再加一层的话，首尾到边框是
   * 16+12，行与行之间只有 12 —— 上边框和行间那几条分隔线是同一种线，眼睛会拿
   * 它们互相比，差出来的那截看着就是没对齐。
   */
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
  /** /api/status/coding：多来源合并后的合计、排名、各 agent 最近一个有行的日子 */
  fallback: StatusResponse<CodingUsagePayload>;
  /** /api/status/coding/now：各 agent 各来源最近一条用量事件，带 Mac 存活 */
  nowFallback: StatusResponse<CodingNowPayload>;
  /** 可滞后层那份限额（/api/status/limits），按 id 贴到行上 */
  limitsFallback: StatusResponse<AgentLimitsPayload>;
  className?: string;
}) {
  /**
   * 此刻那份走推送（`coding-now` 带整份，直接写键）；用量靠轮询。这张卡整体不当实时源、
   * 不因 Mac 掉线变灰：用量、排名都是累计事实，采集停了只是不再增长，不会变得不可信。
   * 限额在可滞后层，另一台机器报的，有自己的阈值（limitsAt），各行自己管。
   */
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
  /**
   * 站点今天：挂载后按浏览器的钟、跨零点自己翻；首帧（服务端预渲染和水合）没有钟，拿用量那份
   * 首屏信封的出站时刻算，两边读到的是同一个值，也不会每次打开先画成「某月某日」再跳成今天。
   */
  const siteDay = useSiteDay();
  const today = siteDay ?? (usageServedAt != null ? zonedDay(usageServedAt, site.timezone) : null);
  /**
   * Mac 的存活只认亲口离线这一条：优雅离开时 mac 那一路的灯立刻灭。崩溃、断网不用心跳窗口去判 ——
   * mac 的时刻不再前进，灯的 5 分钟窗口到点自己灭；别的来源的灯和 Mac 在不在线无关。
   */
  const macDeclaredOffline = Boolean(now?.declaredOffline);
  // 只有限额、只有此刻的 agent 也要一行；用量那份还没到时，这张卡照样能先画出限额和灯
  const rows = usage || now || limits ? codingAgentRows(usage ?? null, now ?? null, limits ?? null) : null;
  // 合计含全部 agent（包括不单独占行的）：它们谁的来源采集失败，合计就只是部分
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
                  {/* 套餐 badge 的位置 */}
                  <div className="h-4 w-14 bg-muted" />
                </div>
                <div className="mt-6 h-12 w-36 rounded bg-muted" />
                {/* 与全量面板一致的三行限额占位 */}
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
