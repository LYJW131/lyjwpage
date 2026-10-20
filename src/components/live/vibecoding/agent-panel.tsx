"use client";

import NumberFlow from "@number-flow/react";

import { LimitMeter, LimitUnavailable } from "@/components/live/vibecoding/limit-meter";
import { LIMITS_SILENT, featuredLimitRows } from "@/components/live/vibecoding/limits";
import { ActiveBadge, FeaturedMark } from "@/components/live/vibecoding/marks";
import { SourceIssue } from "@/components/live/vibecoding/total-usage";
import { useAgentActive, type FirstFrameClocks } from "@/components/live/vibecoding/use-agent-active";
import { FlowDash } from "@/components/ui/flow-dash";
import { useStale } from "@/hooks/use-stale";
import { agentUsageLabel, agentUsageUrl } from "@/lib/agent-usage-url";
import { codingSourceHealth, describeCodingSources, type CodingAgentRow } from "@/lib/coding-agents";
import { AGENT_LIMITS_STALE_MS } from "@shared/freshness";
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
function kiloMega(value: number) {
  if (value >= 1e6) return { value: value / 1e6, suffix: "M" };
  if (value >= 1e3) return { value: value / 1e3, suffix: "K" };
  return { value };
}

export function AgentPanel({
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
    <div className="flex min-w-0 flex-col p-4 lg:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FeaturedMark row={row} active={active} />
          <span className="text-sm font-medium">{row.label}</span>
          {active && <ActiveBadge sources={sources} />}
        </div>
        <span
          className={cn(
            "label-mono truncate",
            active ? "text-live-ink" : "text-muted-foreground",
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
                {...kiloMega(lastDay.totalTokens)}
                locales="en-US"
                format={{ maximumFractionDigits: 1, useGrouping: false }}
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
