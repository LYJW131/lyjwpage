"use client";

import NumberFlow from "@number-flow/react";

import { ClaudeSpinner } from "@/components/live/claude-spinner";
import { CodexActivityIndicator } from "@/components/live/codex-activity-indicator";
import { Sparkline } from "@/components/live/sparkline";
import { Card } from "@/components/ui/card";
import { useStatus } from "@/hooks/use-status";
import type {
  VibeCodingAgent,
  VibeCodingPayload,
  VibeCodingTotals,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const REFRESH_MS = 60_000;
const ACTIVE_WINDOW_MS = 5 * 60_000;

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
        <div title="按公开 API 价格计算；订阅用户不会被收取这笔费用">
          <div className="label-mono text-muted-foreground">API Equivalent</div>
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
          <div className="label-mono text-muted-foreground">Active Days</div>
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
          <div title="按公开 API 价格计算；订阅用户不会被收取这笔费用">
            <div className="label-mono text-muted-foreground">API Eq.</div>
            <div className="mt-1 font-mono text-sm">
              ${agent.today.apiEquivalentCostUSD.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="label-mono text-muted-foreground">Cache Hit</div>
            <div className="mt-1 font-mono text-sm">{cacheHitRate.toFixed(1)}%</div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-baseline justify-between gap-4">
        <div className="label-mono text-muted-foreground">30-Day Trend · 12H</div>
        <div className="flex items-baseline gap-2">
          <span className="label-mono text-muted-foreground">30D Total</span>
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
        <Sparkline samples={samples} max={max} className="h-full w-full" />
      </div>
    </div>
  );
}

export function VibeCodingCard({ className }: { className?: string }) {
  const { data, error, isLoading } = useStatus<VibeCodingPayload>(
    "/api/status/vibecoding",
    REFRESH_MS,
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
                <div className="h-4 w-24 rounded bg-muted" />
                <div className="mt-6 h-12 w-36 rounded bg-muted" />
                <div className="mt-6 h-16 rounded bg-muted" />
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
