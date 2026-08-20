"use client";

import AnthropicIcon from "@lobehub/icons/es/Anthropic/components/Mono";
import AntigravityColor from "@lobehub/icons/es/Antigravity/components/Color";
import GrokIcon from "@lobehub/icons/es/Grok/components/Mono";
import OpenAIIcon from "@lobehub/icons/es/OpenAI/components/Mono";
import NumberFlow, { NumberFlowGroup } from "@number-flow/react";
import { useEffect, useState } from "react";

import { ClaudeSpinner } from "@/components/live/claude-spinner";
import { CodexActivityIndicator } from "@/components/live/codex-activity-indicator";
import { Sparkline } from "@/components/live/sparkline";
import { Card } from "@/components/ui/card";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useMountedAt } from "@/hooks/use-mounted-at";
import { useReporterStale, useStale } from "@/hooks/use-stale";
import { incrementalFetcher, useStatus } from "@/hooks/use-status";
import { VIBECODING_STALE_MS } from "@/lib/freshness";
import { VIBECODING_PATH } from "@/lib/paths";
import {
  activityCursor,
  mergeVibeCodingActivity,
  seedVibeCodingActivity,
} from "@/lib/vibecoding-activity";
import type {
  StatusResponse,
  VibeCodingAgent,
  VibeCodingLimit,
  VibeCodingPayload,
  VibeCodingQuotaProvider,
  VibeCodingTotals,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const REFRESH_MS = 2 * 60_000;

/** 活动曲线增量拉取，和充电头共用同一个壳子。累加器在 lib/vibecoding-activity */
const fetchVibeCoding = incrementalFetcher<VibeCodingPayload>(
  activityCursor,
  mergeVibeCodingActivity,
);

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
/** 不受限那一档。沿用同文件 Reasoning 那支绿（也是 --live 用的那支），不再多引入一种色相。 */
const LIMIT_UNLIMITED_COLOR = "oklch(0.65 0.17 145)";

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

function CursorProviderMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 466.73 533.32" className={className} aria-hidden>
      <path
        fill="#72716d"
        d="M233.37,266.66l231.16,133.46c-1.42,2.46-3.48,4.56-6.03,6.03l-216.06,124.74c-5.61,3.24-12.53,3.24-18.14,0L8.24,406.15c-2.55-1.47-4.61-3.57-6.03-6.03l231.16-133.46h0Z"
      />
      <path
        fill="#55544f"
        d="M233.37,0v266.66L2.21,400.12c-1.42-2.46-2.21-5.3-2.21-8.24v-250.44c0-5.89,3.14-11.32,8.24-14.27L224.29,2.43c2.81-1.62,5.94-2.43,9.07-2.43h.01Z"
      />
      <path
        fill="#43413c"
        d="M464.52,133.2c-1.42-2.46-3.48-4.56-6.03-6.03L242.43,2.43c-2.8-1.62-5.93-2.43-9.06-2.43v266.66l231.16,133.46c1.42-2.46,2.21-5.3,2.21-8.24v-250.44c0-2.95-.78-5.77-2.21-8.24h-.01Z"
      />
      <path
        fill="#d6d5d2"
        d="M448.35,142.54c1.31,2.26,1.49,5.16,0,7.74l-209.83,363.42c-1.41,2.46-5.16,1.45-5.16-1.38v-239.48c0-1.91-.51-3.75-1.44-5.36l216.42-124.95h.01Z"
      />
      <path
        fill="#fff"
        d="M448.35,142.54l-216.42,124.95c-.92-1.6-2.26-2.96-3.92-3.92L20.62,143.83c-2.46-1.41-1.45-5.16,1.38-5.16h419.65c2.98,0,5.4,1.61,6.7,3.87Z"
      />
    </svg>
  );
}

function OpenCodeProviderMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 300" fill="none" className={className} aria-hidden>
      <path d="M180 240H60V120H180V240Z" className="fill-[#CFCECD] dark:fill-[#4B4646]" />
      <path
        d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z"
        className="fill-[#211E1E] dark:fill-[#F1ECEC]"
      />
    </svg>
  );
}

/**
 * 附加 provider 的品牌图标，按上报器给的 `icon` 键取 —— 不是按 `id`：
 * CodexBar 那个 provider 叫 `opencodego`，牌子叫 OpenCode。
 *
 * 认不出来的键退回首字母。上报器新配一个 provider 时页面上立刻就该有一行，
 * 图标是后补的事，不该因为少一个矢量就让那行的限额也跟着看不见。
 */
function QuotaProviderMark({
  icon,
  label,
  className,
}: {
  icon: VibeCodingQuotaProvider["icon"];
  label: string;
  className?: string;
}) {
  switch (icon) {
    case "cursor":
      return <CursorProviderMark className={className} />;
    case "opencode":
      return <OpenCodeProviderMark className={className} />;
    case "antigravity":
      return <AntigravityColor size={20} className={className} />;
    // 这个牌子只有黑白两色，Mono 就是它的本来面目，不是退而求其次
    case "grok":
      return <GrokIcon size={20} className={className} />;
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
  const mark = model.toLowerCase().startsWith("claude")
    ? <AnthropicIcon size={16} />
    : /^(gpt|codex|chatgpt|o\d)/i.test(model)
      ? <OpenAIIcon size={16} />
      : null;
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
 */
const RANK_MARK_COLOR = ["#d86a52", "#d18a5e", "#d3b26a"] as const;

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

function formatModelName(model: string) {
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/i.exec(model);
  if (claude) {
    const [, family, major, minor] = claude;
    return `Claude ${family[0].toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ""}`;
  }
  const gpt = /^gpt-(\d+(?:\.\d+)?)(?:-(.+))?$/i.exec(model);
  if (gpt) {
    const [, version, variant] = gpt;
    const suffix = variant
      ? ` ${variant.split("-").map((part) =>
          `${part[0].toUpperCase()}${part.slice(1)}`,
        ).join(" ")}`
      : "";
    return `GPT ${version}${suffix}`;
  }
  return model
    .split("-")
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function TotalUsage({
  totals,
  topModels,
}: {
  totals: VibeCodingTotals;
  topModels: VibeCodingPayload["topModels"];
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
          <div className="label-mono text-muted-foreground">Tokens</div>
          <div className="mt-2 text-3xl font-medium tracking-tight md:text-4xl">
            <NumberFlow
              value={totals.totalTokens}
              locales="en-US"
              format={{ notation: "compact", maximumFractionDigits: 1 }}
            />
          </div>
        </div>
        <div title="按公开 API 价格折算">
          <div className="label-mono text-muted-foreground">Cost</div>
          <div className="mt-2 text-3xl font-medium tracking-tight md:text-4xl">
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
            <NumberFlow value={totals.sessionCount} locales="en-US" />
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

/**
 * 窗口时长一律从分钟现算，不预设有哪几档 —— 上游的窗口组合是会变的。
 * 只有整天数才说「天」：1440 分钟按「24-hour」读着更顺，而且它跟 5 小时窗口
 * 是同一类（当日额度），说成「1-day」反而像周额度。
 */
function formatWindow(minutes: number | null) {
  if (minutes == null || minutes <= 0) return null;
  if (minutes === 10080) return "Weekly";
  if (minutes % 1440 === 0 && minutes > 1440) return `${minutes / 1440}-day limit`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour limit`;
  return `${minutes}-minute limit`;
}

/**
 * 分组的展示名。
 *
 * Claude 的 usage 接口只给分组不给时长，而 Claude Code 自己的 /usage 面板把
 * `session` 这一档就叫「5-hour limit」—— 这里跟它的文案保持一致，方便对照。
 * 注意这只是展示层的说法：载荷里那条的 windowMinutes 仍然是 null，
 * 没有把 5 小时当成数据写回去，官方并没有公开这个时长。
 */
const LIMIT_GROUP_NAMES: Record<string, string> = {
  session: "5-hour limit",
  weekly: "Weekly",
};

/**
 * 主额度桶的后缀，只认上游自己声明的那一个。
 *
 * 「没有 label 就是所有模型合计」这个归纳是错的 —— 它只在 Claude 那边成立：
 * 那边 weekly_scoped（Fable）是 weekly_all 的子集，所以后者确实是合计。
 * Codex 的 codex 和 codex_bengalfox（Spark）是并列的独立配额，主桶根本不含
 * Spark，写「all models」等于说了个假话。
 *
 * 两边的桶结构不一样，就别指望一条语义规则同时套住。这里只给上游明确叫
 * weekly_all 的那个加后缀，其余原样。
 */
const LIMIT_KEY_SUFFIXES: Record<string, string> = {
  weekly_all: "all models",
};

/** 判定「当日档」的上限。跨过一天的窗口按周额度那类算，不该顶替 5 小时档。 */
const SESSION_WINDOW_MAX_MINUTES = 1440;

function isSessionWindow(limit: VibeCodingLimit) {
  return (
    limit.group === "session" ||
    (limit.windowMinutes != null && limit.windowMinutes < SESSION_WINDOW_MAX_MINUTES)
  );
}

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

function limitRank(agent: VibeCodingAgent, limit: VibeCodingLimit) {
  if (isSessionWindow(limit)) return 0;
  if (agent.id === "claude" && isNamedLimit(limit, "fable")) return 2;
  if (agent.id === "codex" && isSparkWindow(limit)) return 2;
  return 1;
}

function orderedLimits(agent: VibeCodingAgent) {
  const limits = [...agent.limits];
  return limits.sort((left, right) => {
    const rank = limitRank(agent, left) - limitRank(agent, right);
    return rank || left.key.localeCompare(right.key);
  });
}

/**
 * 窗口名：有时长就按时长说，没有才退回分组。两者不会同时缺，
 * 但真缺了也得渲染这一条 —— 用量数字本身仍然有意义。
 */
function formatLimitTitle(limit: VibeCodingLimit) {
  const window =
    formatWindow(limit.windowMinutes) ??
    (limit.group ? (LIMIT_GROUP_NAMES[limit.group] ?? limit.group) : null);
  // label 非 null 就是子额度桶，附在窗口名后面把它和主额度区分开
  const suffix = limit.label ?? LIMIT_KEY_SUFFIXES[limit.key];
  const parts = [window, suffix].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : limit.key;
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
 * - 超过一天时显示的是「Resets Mon 11:00 AM」，那句话跟时间流逝无关，
 *   一直等到它跌破一天、要换成相对写法时才需要醒。周额度因此几小时才醒一次。
 * - 一天以内显示到分钟，所以在每个整分边界醒一次。
 * - 剩不到一分钟时直接等到点，那一下要同时翻文案和把条归零。
 */
function nextTickDelay(remain: number) {
  if (remain > 86_400_000) return remain - 86_400_000;
  if (remain <= 60_000) return Math.max(0, remain);
  return remain % 60_000 || 60_000;
}

/**
 * 附加 provider 的重置文案。
 *
 * Claude / Codex 的窗口写着 Weekly，报「Resets Mon 11:00 AM」不会误会是哪一周。
 * 这里没有窗口名：Cursor 可能是月、Antigravity 是周、Grok 只给一个时刻，
 * 再用星期几就会歧义，一律说还剩几天 / 几小时。
 */
type QuotaResetDisplay =
  | { kind: "relative"; hours: number; minutes: number }
  | { kind: "days"; days: number; hours: number };

function formatQuotaReset(
  resetsAt: number | null,
  referenceTime: number,
): QuotaResetDisplay | null {
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

/** 超过一天时按小时刷新，一天以内按分钟。 */
function nextQuotaTickDelay(remain: number) {
  if (remain > 86_400_000) return remain % 3_600_000 || 3_600_000;
  if (remain <= 60_000) return Math.max(0, remain);
  return remain % 60_000 || 60_000;
}

function LimitMeter({ limit }: { limit: VibeCodingLimit }) {
  /**
   * 自己盯着重置时刻，不跟面板其它部分共用快照时间。
   *
   * 快照时间是采集那一刻，用它当基准的话「重置到点了」这件事前端永远感知不到 ——
   * 倒计时是冻住的，只在新数据到达时跳一下。而上报器五分钟才重取一次限额、
   * 再搭 CodexBar 的包发出、站点再轮询一轮，最坏六分多钟里这根条一直显示上一个
   * 周期的百分比。那个数是确定错的：周期已经翻篇了。
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
  const color = limitColor(usedPercent);
  const title = formatLimitTitle(limit);
  // 基准跟着上面那个 now，条和文案才会在同一刻翻面
  const reset = now ? formatReset(limit.resetsAt, now) : null;

  return (
    <div>
      {/*
        行高钉死，不让内容决定。

        NumberFlow 是个 inline-block 的 web component，会把 text-xs 的行盒从
        16px 撑到 20px。限额窗口有的带重置倒计时、有的没有，因此两侧面板的
        行高可能不一样，Codex 和 Claude Code 的进度条整列也会跟着错位。

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
      <div className="mt-1.5 h-1.5 overflow-hidden bg-muted">
        <div
          className="h-full transition-[width] duration-700"
          style={{ width: `${usedPercent}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

/**
 * 5 小时档缺位时补哪一种，不缺就是 null。
 *
 * 两种缺法不是一回事：Codex 那边是窗口本身没了（OpenAI 撤掉了），Claude 那边这一档
 * 本该在，缺了只说明这一轮没取到。所以不能共用一句文案。
 */
function syntheticSessionState(
  agent: VibeCodingAgent,
  limits: VibeCodingLimit[],
): "unlimited" | "unknown" | null {
  if (limits.some(isSessionWindow)) return null;
  // 一条限额都没取到时不替 Codex 说「无限」—— 那时候连它还有没有这个窗口都不知道
  if (agent.id === "codex") return agent.limits.length > 0 ? "unlimited" : null;
  // limitsError 非空就是「配了但取不到」，和「没配」一样是空 limits，但该占位
  if (agent.limits.length > 0 || agent.limitsError) return "unknown";
  return null;
}

/**
 * 顶在 5 小时档位置上的合成行。
 *
 * 缺这一行，两侧面板的进度条整列就会错位，而且一片空白里看不出是「这一档不存在」
 * 还是「这一档没取到」。骨架和 LimitMeter 严格一致（h-5 + mt-1.5 h-1.5），
 * 两边的条才对得齐。
 *
 * - `unlimited`：条画满，说 Unlimited。
 * - `unknown`：空槽配破折号，不写 0% —— 归零的条会被读成「一点没用」，那是句假话。
 *   取不到的原因（如果上游给了）挂在 title 上，跟附加 provider 那行的处理一致。
 */
function SyntheticLimitMeter({
  state,
  title,
}: {
  state: "unlimited" | "unknown";
  title?: string;
}) {
  const unlimited = state === "unlimited";
  return (
    <div title={title}>
      <div className="flex h-5 items-center justify-between gap-2">
        <span className="truncate text-xs">5-hour limit</span>
        <span className="flex shrink-0 items-baseline gap-2">
          <span className="text-xs text-muted-foreground">
            {unlimited ? "Unlimited" : "Unavailable"}
          </span>
          <span
            className={cn(
              "font-mono text-xs tabular-nums",
              !unlimited && "text-muted-foreground",
            )}
            style={unlimited ? { color: LIMIT_UNLIMITED_COLOR } : undefined}
          >
            {unlimited ? (
              <span className="inline-block origin-right scale-[1.6]">∞</span>
            ) : (
              "—"
            )}
          </span>
        </span>
      </div>
      <div
        className={cn("mt-1.5 h-1.5", !unlimited && "bg-muted")}
        style={unlimited ? { backgroundColor: LIMIT_UNLIMITED_COLOR } : undefined}
      />
    </div>
  );
}

function AgentPanel({
  agent,
  /** 采集侧的话还算不算数，见 VibeCodingCard 里的 activityUnknown */
  activityUnknown,
}: {
  agent: VibeCodingAgent;
  activityUnknown: boolean;
}) {
  const samples = agent.activity.map((sample) => ({
    t: sample.t,
    w: sample.tokens,
  }));
  const max = Math.max(...samples.map((sample) => sample.w), 1) * 1.12;
  const promptTokens =
    agent.today.inputTokens +
    agent.today.cacheCreationTokens +
    agent.today.cacheReadTokens;
  // 命中只认 cache read；cache creation 是新写入，不能算作命中。
  // output 与 prompt cache 无关，也不应该进入分母。
  const cacheHitRate = promptTokens
    ? (agent.today.cacheReadTokens / promptTokens) * 100
    : 0;
  /**
   * `agent.active` 是推来的电平，不是会自己过期的时间戳：采集侧一停就冻在最后
   * 一次推送的值上。所以点灯前要和「这句话现在还算不算数」取与 —— 否则 Mac 睡
   * 着时那盏灯会一直亮，直到它醒来才灭。
   */
  const active = agent.active && !activityUnknown;
  // 正在使用时显示会话扫描给的「此刻在用哪个」；闲置时仍显示用量那份的历史主力。
  const displayModel =
    (active ? agent.currentModel : agent.topModel ?? agent.currentModel) ?? "暂无模型";
  const limits = orderedLimits(agent);
  const syntheticSession = syntheticSessionState(agent, limits);
  // 合成行也是限额，有它就该有 Limits 这个标题
  const hasLimitRows = agent.limits.length > 0 || syntheticSession != null;
  return (
    <div className="flex min-w-0 flex-col px-4 py-4 md:px-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {agent.id === "claude" ? (
            <ClaudeSpinner active={active} />
          ) : (
            <CodexActivityIndicator active={active} />
          )}
          <span className="text-sm font-medium">{agent.label}</span>
          {active && <span className="label-mono text-live">正在使用</span>}
        </div>
        <span
          className={cn(
            "label-mono truncate",
            active ? "text-live" : "text-muted-foreground",
          )}
          title={agent.models.join(" · ")}
        >
          {displayModel}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-5">
        <div className="min-w-0">
          <div className="label-mono text-muted-foreground">Today Tokens</div>
          <div className="mt-1 text-3xl font-medium tracking-tight tabular-nums md:text-5xl">
            <NumberFlow
              value={agent.today.totalTokens}
              locales="en-US"
              format={{ notation: "compact", maximumFractionDigits: 1 }}
            />
          </div>
        </div>
        <div className="grid gap-3 border-l border-line pl-4">
          <div title="按公开 API 价格折算">
            <div className="label-mono text-muted-foreground">Cost</div>
            <div className="mt-1 font-mono text-sm">
              ${agent.today.apiEquivalentCostUSD.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="label-mono text-muted-foreground">Hit</div>
            <div className="mt-1 font-mono text-sm">{cacheHitRate.toFixed(1)}%</div>
          </div>
        </div>
      </div>

      {/*
        限额：条数和窗口组合都由上游决定，一条都取不到、也没说取不到（就是没配）
        才整块不渲染。5 小时档是例外，缺位时补一行占着（见 syntheticSessionState）——
        不然那一行时有时无，一整列条会跟着上下跳。
        套餐等级跟着这一行走，但它不依赖限额 —— usage 接口挂了套餐照样读得到，
        所以整块的渲染条件是「两者有其一」，分隔点只在两者都在时才出现。
      */}
      {(agent.plan || hasLimitRows) && (
        <div className="mt-5 grid gap-3 border-t border-line pt-4">
          <div className="label-mono text-muted-foreground">
            {hasLimitRows && "Limits"}
            {agent.plan && (
              <span title={`套餐 ${agent.plan.tier}`}>
                {hasLimitRows && (
                  <span aria-hidden className="mx-1.5">
                    ·
                  </span>
                )}
                <span className="font-sans normal-case">{agent.plan.label}</span>
              </span>
            )}
          </div>
          {/* 合成行永远排在最前：真的 5 小时档（limitRank 0）也在那个位置 */}
          {syntheticSession && (
            <SyntheticLimitMeter
              state={syntheticSession}
              title={agent.limitsError ?? undefined}
            />
          )}
          {limits.map((limit) => (
            <LimitMeter key={limit.key} limit={limit} />
          ))}
        </div>
      )}

      <div className="mt-5 flex items-baseline justify-between gap-4">
        <div className="label-mono text-muted-foreground">30D Total</div>
        <div className="flex items-baseline gap-2">
          <span className="label-mono text-muted-foreground">Tokens</span>
          <span className="font-mono text-sm">
            <NumberFlow
              value={agent.last30DaysTokens}
              locales="en-US"
              format={{ notation: "compact", maximumFractionDigits: 1 }}
            />
          </span>
        </div>
      </div>
      <div className="mt-2 h-16">
        <Sparkline
          samples={samples}
          max={max}
          windowMs={null}
          variant="trend"
          className="h-full w-full"
        />
      </div>
    </div>
  );
}

function QuotaProviderRow({ provider }: { provider: VibeCodingQuotaProvider }) {
  const mountedAt = useMountedAt();
  const [ticked, setTicked] = useState(0);
  const now = ticked || mountedAt;
  useEffect(() => {
    if (!now || provider.resetsAt == null) return;
    const target = provider.resetsAt * 1000;
    if (now >= target) return;
    const timer = window.setTimeout(
      () => setTicked(Date.now()),
      nextQuotaTickDelay(target - Date.now()) + 500,
    );
    return () => window.clearTimeout(timer);
  }, [provider.resetsAt, now]);

  const expired = provider.resetsAt != null && provider.resetsAt * 1000 <= now;
  const usedPercent =
    provider.usedPercent == null ? null : expired ? 0 : provider.usedPercent;
  const color = usedPercent == null ? undefined : limitColor(usedPercent);
  const reset = now ? formatQuotaReset(provider.resetsAt, now) : null;

  return (
    <div className="min-w-0 py-3" title={provider.limitsError ?? undefined}>
      <div className="flex flex-col gap-1 md:h-5 md:flex-row md:items-center md:justify-between md:gap-2">
        <div className="flex h-5 min-w-0 items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
            <QuotaProviderMark
              icon={provider.icon}
              label={provider.label}
              className="size-5"
            />
          </span>
          <span className="truncate text-sm font-medium">{provider.label}</span>
        </div>
        <span className="flex h-5 min-w-0 items-baseline text-xs text-muted-foreground md:shrink-0">
          {provider.plan && (
            <span className="truncate" title={`套餐 ${provider.plan.tier}`}>
              {provider.plan.label}
            </span>
          )}
          {provider.plan && reset && (
            <span aria-hidden className="mx-1.5">
              /
            </span>
          )}
          {reset?.kind === "days" && (
            <NumberFlowGroup>
              <span className="tabular-nums">
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
              <span className="tabular-nums">
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
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        <div className="h-1.5 min-w-8 flex-1 overflow-hidden bg-muted">
          {usedPercent != null && (
            <div
              className="h-full transition-[width] duration-700"
              style={{ width: `${usedPercent}%`, backgroundColor: color }}
            />
          )}
        </div>
        {usedPercent == null ? (
          <span
            className="label-mono shrink-0 text-muted-foreground"
            title="Unavailable"
          >
            —
          </span>
        ) : (
          <span
            className="shrink-0 font-mono text-xs tabular-nums"
            style={{ color }}
          >
            <NumberFlow value={Math.round(usedPercent)} locales="en-US" />%
          </span>
        )}
      </div>
    </div>
  );
}

function QuotaProviders({ providers }: { providers: VibeCodingQuotaProvider[] }) {
  if (providers.length === 0) return null;
  const sortedProviders = [...providers].sort(
    (left, right) => (right.usedPercent ?? -1) - (left.usedPercent ?? -1),
  );
  /*
   * 竖向不留内边距：每行自己的 py-3 就是间距。容器再加一层的话，首尾到边框是
   * 16+12，行与行之间只有 12 —— 上边框和行间那几条分隔线是同一种线，眼睛会拿
   * 它们互相比，差出来的那截看着就是没对齐。
   */
  return (
    <div className="border-t border-line px-4 md:px-5">
      <div className="grid divide-y divide-line">
        {sortedProviders.map((provider) => (
          <QuotaProviderRow key={provider.id} provider={provider} />
        ))}
      </div>
    </div>
  );
}

export function VibeCodingCard({
  fallback,
  className,
}: {
  fallback: StatusResponse<VibeCodingPayload>;
  className?: string;
}) {
  // 会话状态（正在用 / 换模型）走推送；token 用量仍靠轮询。
  // 这张卡整体不当实时源：不因 Mac 掉线变灰 —— 用量、限额、曲线都是累计事实，
  // 采集停了它们只是不再增长，不会变得不可信。
  useLiveEvents();
  const { data } = useStatus<VibeCodingPayload>(VIBECODING_PATH, REFRESH_MS, {
    fallback,
    fetcher: fetchVibeCoding,
    seedFallback: seedVibeCodingActivity,
  });

  /**
   * 例外只有一处：两个 agent 的活动灯。整张卡就这一处说的是「此刻」，
   * 而它偏偏是全卡最不该冻住的东西 —— 剩下的冻住只是停在昨天，它冻住是在说谎。
   *
   * 两个判据取或，规矩见 lib/reporter-liveness 的模块注释：
   *
   * - **Mac 不在线**：整条上报链路断了，最后那个 active 再没人来改。
   * - **采集侧自己卡住**：Mac 在线，但用量那份十几分钟没推新的（健康时每个
   *   采集间隔必发一次），说明采集侧不转了 —— 此刻那份也就跟着不可信。
   *   `pushedAt` 盯的正是用量那份，见 VibeCodingPayload。
   *
   * 不学 live-desk-card 那样拿 `isValidating` 挡一手：那边挡的是「回源没完成时
   * 别把整块内容判没」，而这里判错的方向是安全的 —— 多说一句「没在用」只是少
   * 报，下一轮就纠正回来；反过来在 Mac 睡着时还点着灯是实打实的错。
   *
   * 两个 hook 都要无条件调用，别写成 `useReporterStale(...) || useStale(...)` ——
   * `||` 会短路掉后一个。
   */
  const { offline: reporterOffline } = useReporterStale(data);
  const collectorStale = useStale(data?.pushedAt, VIBECODING_STALE_MS);
  const activityUnknown = reporterOffline || collectorStale;

  return (
    <Card
      id="vibe-coding"
      label="Vibe Coding"
      action="MacBook Pro"
      className={cn("md:col-span-2", className)}
    >
      {data ? (
        <>
          <TotalUsage totals={data.totals} topModels={data.topModels} />
          <div className="grid grid-cols-1 divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
            {data.agents.map((agent) => (
              <AgentPanel
                key={agent.id}
                agent={agent}
                activityUnknown={activityUnknown}
              />
            ))}
          </div>
          <QuotaProviders providers={data.quotaProviders} />
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
            {["Claude Code", "Codex"].map((label) => (
              <div key={label} className="animate-pulse px-5 py-4">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-24 rounded bg-muted" />
                  {/* 套餐 badge 的位置 */}
                  <div className="h-4 w-14 bg-muted" />
                </div>
                <div className="mt-6 h-12 w-36 rounded bg-muted" />
                {/* 限额条：占位只放一条 —— 条数由上游决定，多占的话数据回来会塌一截 */}
                <div className="mt-6 h-1.5 bg-muted" />
                <div className="mt-6 h-16 rounded bg-muted" />
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
