"use client";

import NumberFlow, { NumberFlowGroup } from "@number-flow/react";
import { useEffect, useState } from "react";

import { ClaudeSpinner } from "@/components/live/claude-spinner";
import { CodexActivityIndicator } from "@/components/live/codex-activity-indicator";
import { Sparkline } from "@/components/live/sparkline";
import { Card } from "@/components/ui/card";
import { incrementalFetcher, useStatus } from "@/hooks/use-status";
import { VIBECODING_PATH } from "@/lib/paths";
import { activityCursor, mergeVibeCodingActivity } from "@/lib/vibecoding-activity";
import type {
  VibeCodingAgent,
  VibeCodingLimit,
  VibeCodingPayload,
  VibeCodingTotals,
} from "@/lib/types";
import { cn } from "@/lib/utils";

import styles from "./vibecoding-card.module.css";

const REFRESH_MS = 60_000;
const ACTIVE_WINDOW_MS = 5 * 60_000;

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
  { key: "inputTokens", label: "Input", color: "oklch(0.63 0.18 250)" },
  { key: "regularOutputTokens", label: "Output", color: "oklch(0.68 0.15 175)" },
  { key: "cacheReadTokens", label: "Cache read", color: "oklch(0.72 0.16 75)" },
  { key: "cacheCreationTokens", label: "Cache write", color: "oklch(0.65 0.18 315)" },
  { key: "reasoningTokens", label: "Reasoning", color: "oklch(0.65 0.17 145)" },
] as const;

function TotalUsage({
  totals,
  topModels,
}: {
  totals: VibeCodingTotals;
  topModels: VibeCodingPayload["topModels"];
}) {
  // reasoning 是 output 的子集；拆出来单独着色时，普通 output 要扣掉它。
  const values = {
    inputTokens: totals.inputTokens,
    regularOutputTokens: Math.max(0, totals.outputTokens - totals.reasoningTokens),
    cacheReadTokens: totals.cacheReadTokens,
    cacheCreationTokens: totals.cacheCreationTokens,
    reasoningTokens: totals.reasoningTokens,
  };
  const stackTotal = Object.values(values).reduce((sum, value) => sum + value, 0);

  return (
    <div className="border-b border-line px-4 pb-5 pt-5 md:px-5">
      <div className="grid grid-cols-2 gap-x-5 gap-y-5 md:grid-cols-4">
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
            <NumberFlow value={totals.sessions} locales="en-US" />
          </div>
        </div>
      </div>

      <div className="mt-6 flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
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

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {TOKEN_SEGMENTS.map((segment) => (
          <div key={segment.key} className="flex items-center gap-2 text-xs">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: segment.color }}
              aria-hidden
            />
            <span className="text-muted-foreground">{segment.label}</span>
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
        <div className="mt-4 border-t border-line pt-4">
          <div className="label-mono text-muted-foreground">Model Usage · All Time</div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {topModels.map((item, index) => (
              <div
                key={item.model}
                className="flex min-w-0 items-center gap-3 rounded-md border border-line-strong bg-muted/60 px-3 py-2.5"
              >
                <span className="label-mono flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                  {index + 1}
                </span>
                <div className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
                  <div className="truncate text-sm font-medium" title={item.model}>
                    {item.model}
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

/** 判定「当日档」的上限。跨过一天的窗口按周额度那类算，不该顶替 5 小时档 */
const SESSION_WINDOW_MAX_MINUTES = 1440;

/**
 * 是不是 5 小时那一档。
 *
 * 两种来源的判据不一样：Claude 给 group，Codex 给时长，所以两个都认。
 */
function isSessionWindow(limit: VibeCodingLimit) {
  return (
    limit.group === "session" ||
    (limit.windowMinutes != null && limit.windowMinutes < SESSION_WINDOW_MAX_MINUTES)
  );
}

function hasSessionWindow(limits: VibeCodingLimit[]) {
  return limits.some(isSessionWindow);
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

function LimitMeter({ limit }: { limit: VibeCodingLimit }) {
  /**
   * 自己盯着重置时刻，不跟面板其它部分共用快照时间。
   *
   * 快照时间是采集那一刻，用它当基准的话「重置到点了」这件事前端永远感知不到 ——
   * 倒计时是冻住的，只在新数据到达时跳一下。而上报器五分钟才重取一次限额、
   * 再搭 ccusage 的包发出、站点再轮询一轮，最坏六分多钟里这根条一直显示上一个
   * 周期的百分比。那个数是确定错的：周期已经翻篇了。
   *
   * 到点归零不是编数据 —— 重置那一刻用量就是零。之后至多低估这几分钟新用掉的
   * 量，比挂着一个上个周期的旧值准得多。
   *
   * 用一次性 setTimeout 而不是轮询式计时器：数据没变时轮询不会触发重渲染
   * （响应体已经不带时间戳了），光靠重渲染永远跨不过那个时刻；而定时器只在
   * 边界醒这一次，中间一点开销都没有。
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (limit.resetsAt == null) return;
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
      () => setNow(Date.now()),
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
  const reset = formatReset(limit.resetsAt, now);

  return (
    <div>
      {/*
        行高钉死，不让内容决定。

        NumberFlow 是个 inline-block 的 web component，会把 text-xs 的行盒从
        16px 撑到 20px。而「Unlimited」那种行一个 NumberFlow 都没有，于是两侧
        面板的行高不一样，Codex 和 Claude Code 的进度条整列对不齐。

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
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{ width: `${usedPercent}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function AgentPanel({
  agent,
  stale,
  referenceTime,
}: {
  agent: VibeCodingAgent;
  stale: boolean;
  /** 采集时间由数据携带，避免渲染期间读取不稳定的系统时钟。 */
  referenceTime: number;
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
  const lastActivity = agent.lastActivityAt ? Date.parse(agent.lastActivityAt) : 0;
  const active =
    !stale &&
    lastActivity > 0 &&
    referenceTime - lastActivity >= 0 &&
    referenceTime - lastActivity <= ACTIVE_WINDOW_MS;
  // 正在使用时关心「此刻在跑什么」，闲着时这个瞬时值没有代表性，改看历史主力模型。
  // topModel 取不到（旧版 Mac app 不上报）就退回原来的取法，不留空。
  const displayModel =
    (active ? agent.currentModel : agent.topModel ?? agent.currentModel) ?? "暂无模型";
  return (
    <div className="flex min-w-0 flex-col px-4 py-4 md:px-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {agent.id === "claude" ? (
            <ClaudeSpinner active={active} stale={stale} />
          ) : (
            <CodexActivityIndicator active={active} stale={stale} />
          )}
          <span className="text-sm font-medium">{agent.label}</span>
          {active && <span className="label-mono text-live">正在使用</span>}
        </div>
        {/*
          正在使用时点亮。这一格在两种状态下含义不一样 —— 用着的时候是「此刻在
          跑什么」，闲着的时候是「历史上用得最多的是什么」。同一个位置同一种灰，
          容易被当成同一件事读。
        */}
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
            <span className={styles.todayTokenValue}>
              <span
                aria-hidden
                className={cn(
                  styles.todayTokenGlowShell,
                  active && styles.todayTokenGlowShellActive,
                )}
              >
                <NumberFlow
                  className={styles.todayTokenGlow}
                  value={agent.today.totalTokens}
                  locales="en-US"
                  format={{ notation: "compact", maximumFractionDigits: 1 }}
                />
              </span>
              <NumberFlow
                className={styles.todayTokenForeground}
                value={agent.today.totalTokens}
                locales="en-US"
                format={{ notation: "compact", maximumFractionDigits: 1 }}
              />
            </span>
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
        限额：条数和窗口组合都由上游决定，取不到就整块不渲染，不留占位。
        套餐等级跟着这一行走，但它不依赖限额 —— usage 接口挂了套餐照样读得到，
        所以整块的渲染条件是「两者有其一」，分隔点只在两者都在时才出现。
      */}
      {(agent.plan || agent.limits.length > 0) && (
        <div className="mt-5 grid gap-3 border-t border-line pt-4">
          <div className="label-mono text-muted-foreground">
            {agent.limits.length > 0 && "Limits"}
            {agent.plan && (
              <span title={`套餐 ${agent.plan.tier}`}>
                {agent.limits.length > 0 && (
                  <span aria-hidden className="mx-1.5">
                    ·
                  </span>
                )}
                <span className="font-sans normal-case">{agent.plan.label}</span>
              </span>
            )}
          </div>
          {/*
            缺 5 小时档时补一条「不限」。OpenAI 眼下临时撤掉了 Codex 的这个窗口，
            接口里就没有这一条 —— 但「接口没给」和「这一档不受限」在页面上是两回事，
            整条不显示会让人以为漏了。窗口回来那天上游自然会带上它，这里也就不再触发。

            只在已经拿到限额时补：limits 整个为空说明这次压根没取到（接口挂了 /
            没配路径），那是「不知道」，不是「不限」，不能替用户下这个结论。
          */}
          {agent.limits.length > 0 && !hasSessionWindow(agent.limits) && (
            <div>
              {/* 行高和 LimitMeter 那边一致，否则两个 agent 并排时下面几行错开 */}
              <div className="flex h-5 items-center justify-between gap-2">
                <span className="truncate text-xs">{LIMIT_GROUP_NAMES.session}</span>
                <span className="flex shrink-0 items-baseline gap-2">
                  {/* 占重置时刻那个位置：这一档不会重置，写它不受限 */}
                  <span className="text-xs text-muted-foreground">Unlimited</span>
                  <span
                    className="font-mono text-xs tabular-nums"
                    style={{ color: LIMIT_UNLIMITED_COLOR }}
                  >
                    {/*
                      ∞ 在等宽字体里画得又扁又小，和隔壁那些两位数放一起完全不成比例。
                      放大要同时躲开两个坑：调字号会把这一行从 16px 顶到 18px，两个
                      agent 并排时下面几行就跟隔壁错开（钉行高也没用，大字号的
                      ascent/descent 照样把行盒撑开）；而 transform 缩放不占布局宽度，
                      默认从中心放大就会顶出右边缘。所以缩放 + 把原点挪到右边：
                      向左长进本来就有的间距里，右边缘和上面那些百分数天然齐平。
                    */}
                    <span className="inline-block origin-right scale-[1.6]">∞</span>
                  </span>
                </span>
              </div>
              {/*
                整条铺满绿：这一档没有可填的量，铺满不是「用了 100%」而是「随便用」。
                同时占住位置 —— 两个 agent 并排，这一条少了轨道下面几行就跟隔壁错开。
              */}
              <div
                className="mt-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: LIMIT_UNLIMITED_COLOR }}
              />
            </div>
          )}
          {agent.limits.map((limit) => (
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

export function VibeCodingCard({ className }: { className?: string }) {
  // 不订阅 SSE：token 用量是累计的历史事实，Mac 掉线它不会变得不可信，
  // 只是不再增长，没有理由跟着变灰
  const { data, error, isLoading } = useStatus<VibeCodingPayload>(
    VIBECODING_PATH,
    REFRESH_MS,
    fetchVibeCoding,
  );
  const stale = Boolean(data?.stale || error);

  return (
    <Card
      label="Vibe Coding"
      tone={stale ? "off" : data ? "live" : "idle"}
      action={
        error
          ? "ccusage 离线"
          : isLoading && !data
            ? "读取中"
            : data
              ? `ccusage · ${data.source === "local" ? "本机" : "推送"}`
              : "ccusage"
      }
      className={cn("md:col-span-2", stale && "opacity-70", className)}
    >
      {data ? (
        <>
          <TotalUsage totals={data.totals} topModels={data.topModels} />
          <div className="grid grid-cols-1 divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
            {data.agents.map((agent) => (
              <AgentPanel
                key={agent.id}
                agent={agent}
                stale={stale}
                referenceTime={Date.parse(data.collectedAt)}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-5 border-b border-line px-5 py-5 md:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
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
                  <div className="h-4 w-14 rounded-full bg-muted" />
                </div>
                <div className="mt-6 h-12 w-36 rounded bg-muted" />
                {/* 限额条：占位只放一条 —— 条数由上游决定，多占的话数据回来会塌一截 */}
                <div className="mt-6 h-1.5 rounded-full bg-muted" />
                <div className="mt-6 h-16 rounded bg-muted" />
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
