"use client";

import NumberFlow, { NumberFlowGroup } from "@number-flow/react";
import { useEffect, useState } from "react";

import { CodexActivityIndicator } from "@/components/live/codex-activity-indicator";
import { LimitMeter, LimitUnavailable, PaceMarker, UsageMeter } from "@/components/live/vibecoding/limit-meter";
import { LIMITS_SILENT, compactLimit, featuredLimitRows, hasFeaturedLimits, formatCompactReset, limitColor, limitPace, nextCompactTickDelay, paceTickInterval } from "@/components/live/vibecoding/limits";
import { ActiveBadge, BrandMark } from "@/components/live/vibecoding/marks";
import { useAgentActive, type FirstFrameClocks } from "@/components/live/vibecoding/use-agent-active";
import { useMountedAt } from "@/hooks/use-mounted-at";
import { useStale } from "@/hooks/use-stale";
import { agentUsageLabel, agentUsageUrl } from "@/lib/agent-usage-url";
import type { CodingAgentRow } from "@/lib/coding-agents";
import { AGENT_LIMITS_STALE_MS } from "@shared/freshness";

const EXPAND_BEFORE_LINK = new Set(["cursor"]);

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
  const [expanded, setExpanded] = useState(false);
  const expandable =
    (!usageUrl || EXPAND_BEFORE_LINK.has(row.id)) && !limitsStale && row.limits.length > 1;
  const open = expandable && expanded;
  const detailRows = hasFeaturedLimits(row.id)
    ? featuredLimitRows(row)
    : row.limits.map((item) => ({ kind: "limit" as const, key: item.key, title: item.label ?? item.key, limit: item }));

  return (
    <div
      className="min-w-0 py-3"
      title={limitsStale ? LIMITS_SILENT : (row.limitsError ?? undefined)}
    >
      <span className="flex flex-col gap-1 md:h-5 md:flex-row md:items-center md:justify-between md:gap-2">
        <span className="flex h-5 min-w-0 items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
            {row.id === "codex" ? (
              <CodexActivityIndicator active={active} />
            ) : (
              <BrandMark icon={row.icon} label={row.label} className="size-5" />
            )}
          </span>
          <span className="truncate text-sm font-medium">{row.label}</span>
          {active && <ActiveBadge sources={sources} />}
        </span>
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
      </span>
      <UsageMeter
        href={usageUrl}
        label={agentUsageLabel(row.label)}
        expanded={open}
        onToggle={expandable ? () => setExpanded((value) => !value) : undefined}
      >
        {usedPercent != null && (
          <span
            className="block h-full transition-[width] duration-700"
            style={{ width: `${usedPercent}%`, backgroundColor: color }}
          />
        )}
        {pace != null && <PaceMarker pace={pace} overPace={overPace} />}
      </UsageMeter>
      {open && (
        <div className="mt-3 grid gap-3 border-l border-line pl-3">
          {detailRows.map((item) =>
            item.kind === "limit" ? (
              <LimitMeter
                key={item.key}
                limit={item.limit}
                title={item.title}
                href={usageUrl}
                label={agentUsageLabel(row.label, item.title)}
              />
            ) : (
              <LimitUnavailable
                key={item.key}
                title={item.title}
                reason={item.reason}
                href={usageUrl}
                label={agentUsageLabel(row.label, item.title)}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function CompactAgents({
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
    <div className="border-t border-line px-4 lg:px-5">
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
