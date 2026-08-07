"use client";

import NumberFlow from "@number-flow/react";
import { useCallback, useRef } from "react";

import { ClaudeSpinner } from "@/components/live/claude-spinner";
import { CodexActivityIndicator } from "@/components/live/codex-activity-indicator";
import { Sparkline } from "@/components/live/sparkline";
import { Card } from "@/components/ui/card";
import { useStatus } from "@/hooks/use-status";
import type {
  StatusResponse,
  VibeCodingAgent,
  VibeCodingLimit,
  VibeCodingPayload,
  VibeCodingTotals,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const VIBECODING_PATH = "/api/status/vibecoding";
/** 上游给 30 天 × 12 小时一桶，别让并出来的序列无限长 */
const ACTIVITY_LIMIT = 60;
const REFRESH_MS = 60_000;
const ACTIVE_WINDOW_MS = 5 * 60_000;

/** 用到这个百分比就算「快用完」。条和数字共用一个阈值，别在两处各写一遍。 */
const LIMIT_ALERT_PERCENT = 90;
/**
 * 跟同文件的 TOKEN_SEGMENTS 一样直接写 oklch 字面量、不进主题变量：
 * 这是数据编码色，不该被亮暗主题改掉 —— 尤其告警那支，红就得是红。
 * 常态色沿用 TOKEN_SEGMENTS 里 Input 那支蓝，同一张卡里不再多引入一种色相。
 */
const LIMIT_BAR_COLOR = "oklch(0.63 0.18 250)";
const LIMIT_ALERT_COLOR = "oklch(0.62 0.21 25)";

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
 * 只有整天数才说「天」：1440 分钟按「24 小时」读着更顺，而且它跟 5 小时窗口
 * 是同一类（当日额度），说成「1 天」反而像周额度。
 */
function formatWindow(minutes: number | null) {
  if (minutes == null || minutes <= 0) return null;
  if (minutes % 1440 === 0 && minutes > 1440) return `${minutes / 1440} 天`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${minutes} 分钟`;
}

/** 只认识这两个分组，其余原样回显 —— 上游加新分组时不至于显示成空白 */
const LIMIT_GROUP_NAMES: Record<string, string> = {
  session: "会话窗口",
  weekly: "周窗口",
};

/**
 * 窗口名：有时长就按时长说，没有才退回分组。两者不会同时缺，
 * 但真缺了也得渲染这一条 —— 用量数字本身仍然有意义。
 */
function formatLimitTitle(limit: VibeCodingLimit) {
  const window =
    formatWindow(limit.windowMinutes) ??
    (limit.group ? (LIMIT_GROUP_NAMES[limit.group] ?? limit.group) : null);
  // label 非 null 就是子额度桶，附在窗口名后面把它和主额度区分开
  const parts = [window, limit.label].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "主额度";
}

/** resetsAt 是 Unix 秒，不是毫秒 */
function formatReset(resetsAt: number | null, referenceTime: number) {
  if (resetsAt == null) return null;
  const remain = resetsAt * 1000 - referenceTime;
  // 已经过点了就不显示：这份快照只是还没刷新，倒计时写成负数更容易让人误会
  if (remain <= 0) return null;
  const totalMinutes = Math.floor(remain / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  // 只保留最粗的两级，且跳过为零的那级
  const parts = days > 0 ? [`${days} 天`, `${hours} 小时`] : [`${hours} 小时`, `${minutes} 分钟`];
  const text = parts.filter((part) => !part.startsWith("0 ")).join(" ");
  return `${text || "不到 1 分钟"}后重置`;
}

function LimitMeter({
  limit,
  referenceTime,
}: {
  limit: VibeCodingLimit;
  /** 与面板其它部分同源，避免渲染期间读取不稳定的系统时钟 */
  referenceTime: number;
}) {
  const alert = limit.usedPercent >= LIMIT_ALERT_PERCENT;
  const color = alert ? LIMIT_ALERT_COLOR : LIMIT_BAR_COLOR;
  const title = formatLimitTitle(limit);
  const reset = formatReset(limit.resetsAt, referenceTime);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground" title={title}>
          {title}
        </span>
        <span className="shrink-0 font-mono text-xs tabular-nums" style={{ color }}>
          {Math.round(limit.usedPercent)}%
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{ width: `${limit.usedPercent}%`, backgroundColor: color }}
        />
      </div>
      {reset && (
        <div className="label-mono mt-1.5 text-muted-foreground">{reset}</div>
      )}
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
          {/* 套餐等级：取不到就整个不渲染，不留占位 */}
          {agent.plan && (
            <span
              className="label-mono shrink-0 rounded-full border border-line-strong bg-muted px-1.5 py-1 text-muted-foreground"
              title={`套餐 ${agent.plan.tier}`}
            >
              {agent.plan.label}
            </span>
          )}
          {active && <span className="label-mono text-live">正在使用</span>}
        </div>
        <span className="label-mono truncate text-muted-foreground" title={agent.models.join(" · ")}>
          {agent.currentModel ?? "暂无模型"}
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

      {/* 限额：条数和窗口组合都由上游决定，取不到就整块不渲染，不留占位 */}
      {agent.limits.length > 0 && (
        <div className="mt-5 grid gap-3 border-t border-line pt-4">
          <div className="label-mono text-muted-foreground">Limits</div>
          {agent.limits.map((limit) => (
            <LimitMeter key={limit.key} limit={limit} referenceTime={referenceTime} />
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
  /**
   * 各 agent 的活动曲线自己攒着，每轮只问服务端要边界之后的桶。
   * 放 ref 不放 state：返回的 payload 里已经带着并好的完整序列，
   * 再存一份 state 只会多一次渲染。
   */
  const activityRef = useRef<Map<string, VibeCodingAgent["activity"]>>(new Map());

  const fetchVibeCoding = useCallback(async (): Promise<
    StatusResponse<VibeCodingPayload>
  > => {
    // 各 agent 的桶边界是对齐的，取其中最新的那个当水位线就够
    let since: number | null = null;
    for (const points of activityRef.current.values()) {
      const newest = points[points.length - 1]?.t;
      if (newest != null && (since == null || newest > since)) since = newest;
    }
    const url = since == null ? VIBECODING_PATH : `${VIBECODING_PATH}?since=${since}`;

    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`请求 ${url} 失败：${response.status}`);
    const envelope = (await response.json()) as StatusResponse<VibeCodingPayload>;
    if (!envelope.ok) return envelope;

    const agents = envelope.data.agents.map((agent) => {
      if (!envelope.data.activityPartial) {
        activityRef.current.set(agent.id, agent.activity);
        return agent;
      }
      // 按 t 合并：边界那个桶还在累加，新值要覆盖旧值而不是追加
      const merged = new Map(
        (activityRef.current.get(agent.id) ?? []).map((point) => [point.t, point]),
      );
      for (const point of agent.activity) merged.set(point.t, point);
      const activity = [...merged.values()]
        .sort((a, b) => a.t - b.t)
        .slice(-ACTIVITY_LIMIT);
      activityRef.current.set(agent.id, activity);
      return { ...agent, activity };
    });

    return { ...envelope, data: { ...envelope.data, agents } };
  }, []);

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
