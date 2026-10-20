"use client";

import NumberFlow, { NumberFlowGroup } from "@number-flow/react";
import { useEffect, useState } from "react";

import { CodexActivityIndicator } from "@/components/live/codex-activity-indicator";
import { kiloMega } from "@/components/live/vibecoding/agent-panel";
import { PaceMarker } from "@/components/live/vibecoding/limit-meter";
import { LimitTable } from "@/components/live/vibecoding/limit-table";
import { LIMITS_SILENT, compactLimit, featuredLimitRows, hasFeaturedLimits, formatCompactReset, limitColor, limitPace, nextCompactTickDelay, paceTickInterval } from "@/components/live/vibecoding/limits";
import { ActiveBadge, BrandMark } from "@/components/live/vibecoding/marks";
import { useAgentActive, type FirstFrameClocks } from "@/components/live/vibecoding/use-agent-active";
import { useMountedAt } from "@/hooks/use-mounted-at";
import { useStale } from "@/hooks/use-stale";
import { agentUsageLabel, agentUsageUrl } from "@/lib/agent-usage-url";
import type { CodingAgentRow } from "@/lib/coding-agents";
import { AGENT_LIMITS_STALE_MS } from "@shared/freshness";
import { cn } from "@/lib/utils";

function CompactAgentRow({
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
  const [expanded, setExpanded] = useState(false);
  const featured = hasFeaturedLimits(row.id);
  const expandable = !limitsStale && (featured ? row.limits.length > 0 : !usageUrl && row.limits.length > 1);
  const open = expandable && expanded;

  const lastDay = row.usage?.lastDay ?? null;
  const todayTokens = row.usage == null || today == null ? null : lastDay?.date === today ? lastDay.totalTokens : 0;
  const fill = (
    <>
      {usedPercent != null && (
        <span
          className="block h-full transition-[width] duration-700"
          style={{ width: `${usedPercent}%`, backgroundColor: color }}
        />
      )}
      {pace != null && <PaceMarker pace={pace} overPace={overPace} />}
    </>
  );
  const bar = <span className="relative block h-1.5 w-full overflow-hidden bg-muted">{fill}</span>;
  const trackClass = "flex h-6 min-w-0 items-center focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-live";

  return (
    <div className="grid min-w-0 gap-2 py-3" title={limitsStale ? LIMITS_SILENT : (row.limitsError ?? undefined)}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 md:grid-cols-[12rem_minmax(0,1fr)_8rem_5rem]">
        <span className="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 gap-y-0.5">
          <span className="flex size-5 items-center justify-center" aria-hidden>
            {row.id === "codex" ? (
              <CodexActivityIndicator active={active} />
            ) : (
              <BrandMark icon={row.icon} label={row.label} className="size-5" />
            )}
          </span>
          <span className="flex h-5 min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{row.label}</span>
            {active && <ActiveBadge sources={sources} />}
          </span>
          <span className="col-start-2 truncate text-xs text-muted-foreground" title={row.plan ? `Plan ${row.plan.tier}` : undefined}>
            {row.plan?.label ?? "No plan reported"}
          </span>
        </span>
        <span className="grid justify-items-end gap-0.5 md:order-last">
          <span className="font-mono text-sm tabular-nums">
            {todayTokens == null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <NumberFlow {...kiloMega(todayTokens)} locales="en-US" format={{ maximumFractionDigits: 1, useGrouping: false }} />
            )}
          </span>
          <span className="text-xs text-muted-foreground">today</span>
        </span>
        {expandable ? (
          <button
            type="button"
            aria-label={`${row.label} limits`}
            aria-expanded={open}
            onClick={() => setExpanded((value) => !value)}
            className={cn(trackClass, "cursor-pointer")}
          >
            {bar}
          </button>
        ) : usageUrl ? (
          <a href={usageUrl} target="_blank" rel="noreferrer noopener" aria-label={agentUsageLabel(row.label)} className={trackClass}>
            {bar}
          </a>
        ) : (
          <span className={trackClass}>{bar}</span>
        )}
        <span className="flex flex-row-reverse items-baseline gap-2 md:grid md:justify-items-end md:gap-0.5">
          {usedPercent == null ? (
            <span className="font-mono text-sm text-muted-foreground" title="Unavailable">—</span>
          ) : (
            <span className="font-mono text-sm tabular-nums" style={{ color }}>
              <NumberFlow value={Math.round(usedPercent)} locales="en-US" />%
            </span>
          )}
          <span className="text-xs whitespace-nowrap text-muted-foreground">
            {reset == null && "No reset time"}
            {reset?.kind === "days" && (
              <NumberFlowGroup>
                <span className="tabular-nums">
                  Resets in <NumberFlow value={reset.days} locales="en-US" />
                  {reset.days === 1 ? " day" : " days"}
                </span>
              </NumberFlowGroup>
            )}
            {reset?.kind === "relative" && (
              <NumberFlowGroup>
                <span className="tabular-nums">
                  Resets in{" "}
                  {reset.hours > 0 ? (
                    <>
                      <NumberFlow value={reset.hours} locales="en-US" /> hr
                    </>
                  ) : (
                    <>
                      <NumberFlow value={reset.minutes} locales="en-US" /> min
                    </>
                  )}
                </span>
              </NumberFlowGroup>
            )}
          </span>
        </span>
        {open && (
          <LimitTable
            className="col-span-full border-l border-line py-1 pl-3 md:order-last md:col-span-3 md:col-start-2"
            items={
              featured
                ? featuredLimitRows(row).map((item) =>
                    item.kind === "limit"
                      ? { key: item.key, title: item.title, limit: item.limit }
                      : { key: item.key, title: item.title, limit: null, reason: item.reason },
                  )
                : row.limits.map((item) => ({ key: item.key, title: item.label ?? item.key, limit: item }))
            }
            href={featured ? usageUrl : null}
            agentLabel={row.label}
          />
        )}
      </div>
    </div>
  );
}

export function CompactAgents({
  rows,
  macDeclaredOffline,
  clocks,
  today,
}: {
  rows: CodingAgentRow[];
  macDeclaredOffline: boolean;
  clocks: FirstFrameClocks;
  today: string | null;
}) {
  if (rows.length === 0) return null;
  const sortedRows = [...rows].sort((left, right) => {
    const leftUsed = compactLimit(left, 0)?.usedPercent ?? -1;
    const rightUsed = compactLimit(right, 0)?.usedPercent ?? -1;
    return rightUsed - leftUsed;
  });
  return (
    <div className="border-t border-line px-4 lg:px-5">
      <div className="grid divide-y divide-line">
        {sortedRows.map((row) => (
          <CompactAgentRow
            key={row.id}
            row={row}
            macDeclaredOffline={macDeclaredOffline}
            clocks={clocks}
            today={today}
          />
        ))}
      </div>
    </div>
  );
}
