"use client";

import ClaudeCodeText from "@lobehub/icons/es/ClaudeCode/components/Text";
import NumberFlow from "@/components/ui/number-flow";
import type { ReactNode } from "react";

import { ForecastBlock, ForecastSummary, forecastStats, formatDuration } from "@/components/live/vibecoding/limit-forecast-panel";
import { LimitTable } from "@/components/live/vibecoding/limit-table";
import { LIMITS_SILENT, featuredLimitRows } from "@/components/live/vibecoding/limits";
import { ActiveBadge, FeaturedMark } from "@/components/live/vibecoding/marks";
import { SourceIssue } from "@/components/live/vibecoding/total-usage";
import { useAgentActive, type FirstFrameClocks } from "@/components/live/vibecoding/use-agent-active";
import { FlowDash } from "@/components/ui/flow-dash";
import { useStale } from "@/hooks/use-stale";
import { agentUsageUrl } from "@/lib/agent-usage-url";
import { codingSourceHealth, describeCodingSources, type CodingAgentRow } from "@/lib/coding-agents";
import { AGENT_LIMITS_STALE_MS } from "@shared/freshness";
import type { LimitForecast } from "@/lib/limit-forecast";
import { cn } from "@/lib/utils";

function displayModelName(model: string) {
  if (model === "github_bugbot") return "Bugbot";
  if (model.startsWith("grok-bot-")) return "Grok Bot";
  if (model === "agent_review") return "Agent Review";
  return model;
}

function formatSiteDay(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// 今日用量有意只换算到 M（lyjw 定的），超过 10 亿也写 2195.6M，不改成 B。
export function kiloMega(value: number) {
  if (value >= 1e6) return { value: value / 1e6, suffix: "M" };
  if (value >= 1e3) return { value: value / 1e3, suffix: "K" };
  return { value };
}

function Stat({ label, title, children }: { label: ReactNode; title?: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1" title={title}>
      <div className="label-mono truncate text-muted-foreground">{label}</div>
      <div className="truncate text-3xl font-medium tracking-tight tabular-nums md:text-4xl">{children}</div>
    </div>
  );
}

export function AgentPanel({
  row,
  macDeclaredOffline,
  clocks,
  today,
  forecast,
  newWeek,
  timeZone,
  now,
}: {
  row: CodingAgentRow;
  macDeclaredOffline: boolean;
  clocks: FirstFrameClocks;
  today: string | null;
  forecast: LimitForecast | null;
  newWeek: boolean;
  timeZone: string | undefined;
  now: number;
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
  const limitRows = featuredLimitRows(limitsStale ? { ...row, limits: [], limitsError: LIMITS_SILENT } : row);
  return (
    <div className="grid min-w-0 gap-5 p-4 lg:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <FeaturedMark row={row} active={active} />
          {row.id === "claude" ? (
            <ClaudeCodeText size={20} className="h-5 w-auto shrink-0" aria-label={row.label} />
          ) : (
            <span className="shrink-0 text-sm font-medium whitespace-nowrap">{row.label}</span>
          )}
        </div>
        <span className="flex min-w-0 flex-col items-end gap-1">
          {active ? <ActiveBadge sources={sources} /> : <span className="label-mono text-muted-foreground">Inactive</span>}
          <span
            className={cn("label-mono truncate", active ? "text-live-ink" : "text-muted-foreground")}
            title={row.usage?.models.join(" · ") || undefined}
          >
            {displayModel}
          </span>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-4 md:grid-cols-4 md:gap-x-4">
        <Stat
          label={
            <span title={describeCodingSources(notes) || undefined}>
              {lastDay && !isToday ? `Tokens · ${formatSiteDay(lastDay.date)}` : "Today tokens"}
              <SourceIssue failing={failing} hasValue={lastDay != null} />
            </span>
          }
        >
          {lastDay ? (
            <NumberFlow
              {...kiloMega(lastDay.totalTokens)}
              locales="en-US"
              format={{ maximumFractionDigits: 1, useGrouping: false }}
            />
          ) : <FlowDash />}
        </Stat>
        <Stat label="API cost" title="At public API prices">
          {lastDay && (lastDay.costComplete || lastDay.apiEquivalentCostUSD > 0)
            ? `$${lastDay.apiEquivalentCostUSD.toFixed(2)}`
            : "—"}
        </Stat>
        <Stat label="Cache hit">{lastDay ? `${cacheHitRate.toFixed(1)}%` : "—"}</Stat>
        <Stat label="Plan" title={row.plan ? `Plan ${row.plan.tier}` : undefined}>{row.plan?.label ?? "—"}</Stat>
        {forecastStats(forecast).map((stat) => (
          <Stat key={stat.label} label={stat.label} title={stat.title}>{stat.value}</Stat>
        ))}
        <Stat label="Resets in">
          {forecast ? formatDuration(Math.max(0, forecast.resetAt - (now || forecast.now))) : "—"}
        </Stat>
      </div>

      <div className="grid gap-6 border-t border-line pt-4 md:grid-cols-2 md:gap-8 lg:pt-5">
        <div className="flex min-w-0 flex-col gap-3">
          <ForecastSummary forecast={forecast} newWeek={newWeek} timeZone={timeZone} />
          <LimitTable
            tall
            className="flex-1 content-between"
            items={limitRows.map((item) =>
              item.kind === "limit"
                ? { key: item.key, title: item.title, limit: item.limit, cap: item.cap }
                : { key: item.key, title: item.title, limit: null, reason: item.reason },
            )}
            href={agentUsageUrl(row.id)}
            agentLabel={row.label}
          />
        </div>
        <ForecastBlock forecast={forecast} newWeek={newWeek} timeZone={timeZone} />
      </div>
    </div>
  );
}
