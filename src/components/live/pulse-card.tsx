"use client";

import { type RefObject, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { LaneView } from "@/components/live/pulse/lane-view";
import type { LaneModel, Range, TraceStyle } from "@/components/live/pulse/lane-geometry";
import { powerModel, stepsModel, tokensModel } from "@/components/live/pulse/quantity-lanes";
import { codingModel, stateModel } from "@/components/live/pulse/state-lanes";
import { DevToggle, DevToggleSlot, isDev } from "@/components/dev-toggles";
import { Card } from "@/components/ui/card";
import { useStatus } from "@/hooks/use-status";
import { PULSE_PATH } from "@/lib/paths";
import type { PulseDomain, PulseLanes, PulsePayload, StatusResponse } from "@shared/types";
import { cn } from "@/lib/utils";

export { pulseDuration } from "@/components/live/pulse/lane-geometry";

export const PULSE_REFRESH_MS = 5 * 60_000;

const LANES: ReadonlyArray<{ domain: PulseDomain; label: string }> = [
  { domain: "coding", label: "Coding" },
  { domain: "tokens", label: "Tokens" },
  { domain: "listening", label: "Listening" },
  { domain: "watching", label: "Watching" },
  { domain: "gaming", label: "Gaming" },
  { domain: "charging", label: "Charging" },
  { domain: "activity", label: "Activity" },
];
// Worker 与站点独立部署，缓存载荷可能不符合当前形状，必须逐道校验。
function laneModel(
  lanes: PulseLanes | undefined,
  domain: PulseDomain,
  range: Range,
  traceStyle: TraceStyle,
  activityWidth: number,
): LaneModel | null {
  const lane = lanes && typeof lanes === "object" ? lanes[domain] : undefined;
  if (!lane || typeof lane !== "object") return null;
  try {
    switch (domain) {
      case "coding": return lane.kind === "coding" ? codingModel(lane, range) : null;
      case "tokens": return lane.kind === "tokens" ? tokensModel(lane, range) : null;
      case "listening": case "watching": case "gaming": return lane.kind === "state" ? stateModel(domain, lane, range, traceStyle) : null;
      case "charging": return lane.kind === "power" ? powerModel(lane, range) : null;
      case "activity": return lane.kind === "steps" ? stepsModel(lane, range, activityWidth) : null;
    }
  } catch {
    return null;
  }
}

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
const TRACE_STYLE_KEY = "pulse:trace-style";
const traceStyleListeners = new Set<() => void>();
function readTraceStyle(): TraceStyle {
  if (!isDev) return "hatched";
  try { return localStorage.getItem(TRACE_STYLE_KEY) === "faint" ? "faint" : "hatched"; } catch { return "hatched"; }
}
function subscribeTraceStyle(onChange: () => void) {
  traceStyleListeners.add(onChange);
  return () => { traceStyleListeners.delete(onChange); };
}
function toggleTraceStyle() {
  try { localStorage.setItem(TRACE_STYLE_KEY, readTraceStyle() === "hatched" ? "faint" : "hatched"); } catch { return; }
  for (const listener of traceStyleListeners) listener();
}

export function PulseCard({
  fallback,
  className,
}: {
  fallback: StatusResponse<PulsePayload>;
  className?: string;
}) {
  const { data } = useStatus<PulsePayload>(PULSE_PATH, PULSE_REFRESH_MS, { fallback });
  const range = data?.window ?? { from: 0, to: 0 };
  const lanes = data?.lanes;
  const traceStyle = useSyncExternalStore(subscribeTraceStyle, readTraceStyle, () => "hatched" as const);
  const activityRef = useRef<HTMLDivElement>(null);
  const activityWidth = useWidth(activityRef);

  return (
    <Card label="Pulse" action="Last 24 hours" className={cn("h-full", className)}>
      <div className="flex flex-col gap-3 p-4 sm:gap-2 lg:p-5">
        {LANES.map(({ domain, label }) => {
          const model = laneModel(lanes, domain, range, traceStyle, activityWidth);
          const empty = !model || !model.items.length;
          return (
            <div
              key={domain}
              className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 sm:grid-cols-[5.5rem_1fr_8rem] sm:gap-y-0"
              role="group"
              aria-label={`${label} over the last 24 hours`}
            >
              <span
                className="label-mono truncate text-muted-foreground"
                title={domain === "activity"
                  ? "Steps from closed HealthKit five-minute buckets; gaps are unknown, not still."
                  : domain === "tokens" ? "Tokens per minute across all coding agents and sources, including cache reads." : undefined}
              >
                {label}
              </span>
              <div ref={domain === "activity" ? activityRef : undefined} className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:row-start-auto">
                {empty ? (
                  <span className="text-xs text-muted-foreground">No data</span>
                ) : (
                  <LaneView label={label} model={model} range={range} />
                )}
              </div>
              <div className="flex min-w-0 items-baseline justify-end gap-x-1.5 text-right leading-tight sm:flex-col sm:items-end">
                {model?.summary ? (
                  <>
                    <span className="max-w-full truncate font-mono text-xs font-medium tabular-nums">{model.summary.value}</span>
                    <span className="max-w-full truncate text-2xs text-muted-foreground">{model.summary.detail}</span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
            </div>
          );
        })}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground" aria-hidden>
          <span className="flex items-center gap-1"><span className="size-2 bg-(--pulse-human)" />Coding app</span>
          <span className="flex items-center gap-1"><span className="size-2 bg-(--pulse-agent)" />Agent</span>
          <span className="flex items-center gap-1"><span className="size-2 bg-(--pulse-both)" />Both</span>
          <span className="flex items-center gap-1"><span className="h-2 w-3 border-t border-(--pulse-agent) bg-(--pulse-agent)/30" />Tokens/min</span>
          <span className="flex items-center gap-1" title="Played elsewhere (estimated)">
            <span className={cn("pulse-trace relative inline-block h-2 w-3", traceStyle === "hatched" ? "pulse-trace-hatched" : "pulse-trace-faint")} />
            Elsewhere (est.)
          </span>
          <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-current opacity-45" />Idle</span>
        </div>
      </div>
      {isDev && (
        <DevToggleSlot>
          <DevToggle
            label="Traces"
            on={traceStyle === "hatched"}
            states={["Hatched", "Faint"]}
            title="开发环境调试：切换 Pulse 听歌道「不确定区间」的画法（斜线 / 淡色填充）"
            onClick={toggleTraceStyle}
          />
        </DevToggleSlot>
      )}
    </Card>
  );
}
