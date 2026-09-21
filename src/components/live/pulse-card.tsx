"use client";

import { useCallback, useId, useRef, useState } from "react";

import { AnchoredTooltip, cellAnchor, type CellAnchor, useHoverDismiss } from "./heatmap-hover";

import { Card } from "@/components/ui/card";
import { useStatus } from "@/hooks/use-status";
import { PULSE_SILENT_AFTER_MS } from "@/lib/limits";
import { PULSE_PATH } from "@/lib/paths";
import { pulseLanePath, pulseScoreWord, type PulseLanePoint } from "@/lib/pulse-lane";
import type { PulseDomain, PulsePayload, PulseTrend, StatusResponse } from "@/lib/types";
import { CODING_INTENSITY, CODING_CONTINUITY } from "@shared/pulse-coding";
import type { PulseAssessment } from "@shared/pulse-assessment";
import { cn } from "@/lib/utils";

/** Every lane and its summary consume the same five-minute Jev assessments. */
const REFRESH_MS = 5 * 60_000;

const LANES: ReadonlyArray<{ domain: PulseDomain; label: string }> = [
  { domain: "coding", label: "Coding" },
  { domain: "listening", label: "Listening" },
  { domain: "watching", label: "Watching" },
  { domain: "gaming", label: "Gaming" },
  { domain: "charging", label: "Charging" },
  { domain: "activity", label: "Activity" },
];

/** viewBox 的单位。preserveAspectRatio="none" 拉伸填满，笔宽靠 non-scaling-stroke 保住 */
const LANE_WIDTH = 240;
const LANE_HEIGHT = 24;

const TREND_GLYPH: Record<PulseTrend, string> = { rising: "↑", steady: "→", falling: "↓", unknown: "—" };

function Lane({
  label,
  samples,
  range,
}: {
  label: string;
  samples: PulseLanePoint[];
  range: { from: number; to: number };
}) {
  const id = useId();
  const shape = pulseLanePath(samples, range, {
    width: LANE_WIDTH,
    height: LANE_HEIGHT,
    silentAfterMs: PULSE_SILENT_AFTER_MS,
  });
  return (
    <svg
      viewBox={`0 0 ${LANE_WIDTH} ${LANE_HEIGHT}`}
      preserveAspectRatio="none"
      className="h-6 w-full"
      aria-hidden
    >
      <defs>
        <linearGradient id={`pulse-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--live)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--live)" stopOpacity="0.3" />
        </linearGradient>
      </defs>
      {/* 底线恒在：泳道空着的时候也要看得出这里有一条轨道，而不是漏画了 */}
      <line
        x1="0"
        y1={LANE_HEIGHT - 0.5}
        x2={LANE_WIDTH}
        y2={LANE_HEIGHT - 0.5}
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      {shape.area && <path d={shape.area} fill={`url(#pulse-${id})`} />}
      {shape.line && (
        <path
          d={shape.line}
          fill="none"
          stroke="var(--live)"
          strokeWidth="1.25"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <title>{label}</title>
    </svg>
  );
}

const MODE_LABELS = { idle: "Idle", brief: "Brief bursts", interactive: "Coding apps", agent: "Agent work", mixed: "Apps + agents" };

function AssessmentLane({ assessments, range, label }: { assessments: PulseAssessment[]; label: string; range: { from: number; to: number } }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [bounds, setBounds] = useState<CellAnchor | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setSelected(null), []);
  useHoverDismiss(buttonRef, selected != null, close);
  const active = selected == null ? null : assessments[selected];
  const points = assessments.flatMap((assessment) => assessment.coverage.map((part) => ({
    t: part.from, until: part.to, level: assessment.intensity.value / (CODING_INTENSITY.length - 1) * 3,
  })));
  const time = (at: number) => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const selectAt = (clientX: number, target: HTMLButtonElement) => {
    const rect = cellAnchor(target);
    setBounds(rect);
    const at = range.from + (clientX - rect.left) / rect.width * (range.to - range.from);
    const index = assessments.findIndex((assessment) => assessment.coverage.some((part) => at >= part.from && at < part.to));
    setSelected(index >= 0 ? index : null);
  };
  return (
    <div className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        className="block w-full cursor-crosshair rounded-sm focus-visible:outline-1 focus-visible:outline-live"
        aria-label={`${label} intensity, scored by Jev every 5 minutes. Use arrow keys to inspect intervals.`}
        onPointerMove={(event) => selectAt(event.clientX, event.currentTarget)}
        onPointerLeave={(event) => { if (event.pointerType === "mouse") setSelected(null); }}
        onFocus={(event) => { setBounds(cellAnchor(event.currentTarget)); setSelected((value) => value ?? assessments.length - 1); }}
        onBlur={() => setSelected(null)}
        onClick={(event) => {
          setBounds(cellAnchor(event.currentTarget));
          if (event.detail === 0) setSelected((value) => value ?? assessments.length - 1);
          else selectAt(event.clientX, event.currentTarget);
        }}
        onKeyDown={(event) => {
          setBounds(cellAnchor(event.currentTarget));
          if (event.key === "Escape") setSelected(null);
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            setSelected((value) => Math.max(0, Math.min(assessments.length - 1, (value ?? assessments.length - 1) + (event.key === "ArrowLeft" ? -1 : 1))));
          }
        }}
      >
        <Lane label={`Jev ${label} intensity`} samples={points} range={range} />
      </button>
      {active && bounds && (
        <AnchoredTooltip
          contentKey={JSON.stringify(active)}
          anchor={(() => {
            const rect = bounds;
            const from = Math.max(range.from, active.from);
            const to = Math.min(range.to, active.to);
            return { left: rect.left + (from - range.from) / (range.to - range.from) * rect.width,
              width: (to - from) / (range.to - range.from) * rect.width, top: rect.top, height: rect.height };
          })()}
        >
          <div className="text-xs">
          <div className="font-mono text-muted-foreground">{time(active.from)}–{time(active.to)}</div>
          {active.mode && <div className="mt-1 font-medium">{MODE_LABELS[active.mode.value]}</div>}
          <div>Intensity {Math.round(active.intensity.value / (CODING_INTENSITY.length - 1) * 100)} / 100</div>
          <div>Continuity {Math.round(active.continuity.value / (CODING_CONTINUITY.length - 1) * 100)} / 100</div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            {Math.round(active.intensity.confidence * 100)}% confidence · {Math.round(active.coverage.reduce((sum, part) => sum + part.to - part.from, 0) / (active.to - active.from) * 100)}% observed
          </div>
          </div>
        </AnchoredTooltip>
      )}
    </div>
  );
}

export function PulseCard({
  fallback,
  className,
}: {
  fallback: StatusResponse<PulsePayload>;
  className?: string;
}) {
  const { data } = useStatus<PulsePayload>(PULSE_PATH, REFRESH_MS, { fallback });
  const range = data?.window ?? { from: 0, to: 0 };

  return (
    <Card label="Pulse" action="Last 24 hours" className={cn("h-full", className)}>
      <div className="flex flex-col gap-2 p-4 lg:p-5">
        {LANES.map(({ domain, label }) => {
          const view = data?.domains[domain];
          const score = view?.score ?? null;
          const assessments = view?.assessments ?? [];
          const empty = assessments.length === 0;
          const word = score ? pulseScoreWord(Number(score.value.toFixed(1))) : null;
          return (
            <div
              key={domain}
              className="grid grid-cols-[4.5rem_1fr_7rem] items-center gap-x-2 sm:grid-cols-[5.5rem_1fr_9rem] sm:gap-x-3"
              role="group"
              aria-label={
                empty
                  ? `${label}: awaiting five-minute Jev scores`
                  : `${domain === "activity" ? "Estimated physical activity" : label} over the last 24 hours: ${score && word ? `${word}, ${score.value.toFixed(1)} of 3, trending ${score.trend}` : "not scored yet"}`
              }
            >
              <span
                className="label-mono truncate text-muted-foreground"
                title={domain === "activity" ? "Estimated physical activity between Apple Watch reports; gaps mean no data." : undefined}
              >
                {label}
              </span>
              {empty ? (
                <span className="text-xs text-muted-foreground">Awaiting scores</span>
              ) : (
                <AssessmentLane label={label} assessments={assessments} range={range} />
              )}
              <div className="flex min-w-0 items-baseline justify-end gap-1.5 text-right">
                {score ? (
                  <>
                    <span className="text-xs font-medium">{word}</span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {score.value.toFixed(1)}
                    </span>
                    <span aria-hidden className="text-xs text-muted-foreground">
                      {TREND_GLYPH[score.trend]}
                    </span>
                    {score.confidence != null && (
                      <span className="hidden font-mono text-[10px] tabular-nums text-muted-foreground sm:inline">
                        {Math.round(score.confidence * 100)}%
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">No scores yet</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
