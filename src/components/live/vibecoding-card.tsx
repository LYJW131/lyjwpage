"use client";

import { useMemo } from "react";

import { AgentPanel } from "@/components/live/vibecoding/agent-panel";
import { CompactAgents } from "@/components/live/vibecoding/compact-agents";
import { useWeeklyForecast } from "@/components/live/vibecoding/limit-forecast-panel";
import { weeklyLimit } from "@/components/live/vibecoding/limits";
import { TotalUsage } from "@/components/live/vibecoding/total-usage";
import type { FirstFrameClocks } from "@/components/live/vibecoding/use-agent-active";
import { Card } from "@/components/ui/card";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useSiteDay } from "@/hooks/use-site-day";
import { useStale } from "@/hooks/use-stale";
import { useStatus } from "@/hooks/use-status";
import { codingAgentRows, codingSourceHealth } from "@/lib/coding-agents";
import { zonedDay } from "@shared/heatmap-window";
import { CODING_NOW_PATH, CODING_PATH, LIMITS_HISTORY_PATH, LIMITS_PATH } from "@/lib/paths";
import { AGENT_LIMITS_STALE_MS } from "@shared/freshness";
import type { LimitHistoryPayload } from "@shared/limit-history";
import { site } from "@shared/site";
import type { CodingNowPayload, CodingUsagePayload, StatusResponse } from "@shared/types";
import { cn } from "@/lib/utils";
import type { AgentLimitsPayload } from "@shared/vibecoding-limits";

const REFRESH_MS = 2 * 60_000;
// 历史按小时归档、每小时只多一个点，半小时一问足够；当前读数走 limits，不靠它。
const HISTORY_REFRESH_MS = 30 * 60_000;

export function VibeCodingCard({
  fallback,
  nowFallback,
  limitsFallback,
  historyFallback,
  className,
}: {
  fallback: StatusResponse<CodingUsagePayload>;
  nowFallback: StatusResponse<CodingNowPayload>;
  limitsFallback: StatusResponse<AgentLimitsPayload>;
  historyFallback: StatusResponse<LimitHistoryPayload>;
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
  const { data: history } = useStatus<LimitHistoryPayload>(LIMITS_HISTORY_PATH, HISTORY_REFRESH_MS, {
    fallback: historyFallback,
  });
  const clocks = useMemo<FirstFrameClocks>(
    () => ({ usage: usageServedAt, now: nowServedAt, nowValidating, limits: limitsServedAt }),
    [usageServedAt, nowServedAt, nowValidating, limitsServedAt],
  );
  const siteDay = useSiteDay();
  const today = siteDay ?? (usageServedAt != null ? zonedDay(usageServedAt, site.timezone) : null);
  const macDeclaredOffline = Boolean(now?.declaredOffline);
  const rows = usage || now || limits ? codingAgentRows(usage ?? null, now ?? null, limits ?? null) : null;
  const claude = rows?.find((row) => row.id === "claude") ?? null;
  const claudeLimitsStale = useStale(claude?.limitsAt ?? null, AGENT_LIMITS_STALE_MS, limitsServedAt);
  const weekly = useWeeklyForecast({
    limit: claude && !claudeLimitsStale ? weeklyLimit(claude) : null,
    limitAt: claude?.limitsAt ?? null,
    history: history ?? null,
    servedAt: limitsServedAt ?? null,
  });
  const totalFailing = (rows ?? []).flatMap((row) =>
    codingSourceHealth(row.usage).failing.map((note) => ({ ...note, label: `${row.label} · ${note.label}` })),
  );

  return (
    <Card
      id="vibe-coding"
      label="Vibe Coding"
      action="All sources"
      className={cn("md:col-span-2 scroll-mt-28", className)}
    >
      {rows ? (
        <>
          {usage?.totals ? (
            <TotalUsage totals={usage.totals} topModels={usage.topModels} failing={totalFailing} />
          ) : (
            <div className="border-b border-line px-4 py-5 text-sm text-muted-foreground lg:px-5">
              Waiting for usage reports
            </div>
          )}
          {rows.filter((row) => row.row === "featured").map((row) => (
            <AgentPanel
              key={row.id}
              row={row}
              macDeclaredOffline={macDeclaredOffline}
              clocks={clocks}
              today={today}
              forecast={row.id === "claude" ? weekly.forecast : null}
              timeZone={weekly.timeZone}
              now={weekly.now}
            />
          ))}
          <CompactAgents
            rows={rows.filter((row) => row.row === "compact")}
            macDeclaredOffline={macDeclaredOffline}
            clocks={clocks}
          />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-5 border-b border-line px-4 py-5 md:grid-cols-3 lg:px-5">
            {[0, 1, 2].map((index) => (
              <div key={index} className="animate-pulse">
                <div className="h-3 w-20 rounded bg-muted" />
                <div className="mt-3 h-9 w-24 rounded bg-muted" />
              </div>
            ))}
          </div>
          <div className="grid min-h-64 grid-cols-1 divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
            {["Claude Code", "Weekly forecast"].map((label) => (
              <div key={label} className="animate-pulse p-4 lg:p-5">
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
