"use client";

import { useId } from "react";

import { Card } from "@/components/ui/card";
import { useStatus } from "@/hooks/use-status";
import { PULSE_SILENT_AFTER_MS } from "@/lib/limits";
import { PULSE_PATH } from "@/lib/paths";
import { pulseLanePath, pulseScoreWord } from "@/lib/pulse-lane";
import type { PulseDomain, PulsePayload, PulseTrend, StatusResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 五条泳道，一域一条：最近 24 小时的活动强度（阶跃，0–3 档），右边一枚活动分。
 *
 * 分由 Jev 评估模型对整段窗口给出（Worker 侧十分钟一次，见 workers/api/src/pulse-score.ts），
 * 档位仍是确定性规则算的 —— 图和分说的是两件事，所以两样都画。
 *
 * **卡片拿不到曲名、应用名、游戏名**：那些只在 Worker 内部参与评分，公开端点
 * 剥得干干净净（见 PulsePayload）。这里画的只有强度。
 *
 * 5 分钟一轮，不订阅推送：分最快十分钟才换一次，泳道也只到分钟尺度，
 * 广播它等于拿推送当轮询用。
 */
const REFRESH_MS = 5 * 60_000;

const LANES: ReadonlyArray<{ domain: PulseDomain; label: string }> = [
  { domain: "coding", label: "Coding" },
  { domain: "listening", label: "Listening" },
  { domain: "watching", label: "Watching" },
  { domain: "gaming", label: "Gaming" },
  { domain: "charging", label: "Charging" },
];

/** viewBox 的单位。preserveAspectRatio="none" 拉伸填满，笔宽靠 non-scaling-stroke 保住 */
const LANE_WIDTH = 240;
const LANE_HEIGHT = 24;

const TREND_GLYPH: Record<PulseTrend, string> = { rising: "↑", steady: "→", falling: "↓" };

function Lane({
  label,
  samples,
  range,
}: {
  label: string;
  samples: PulsePayload["domains"][PulseDomain]["samples"];
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
          const empty = !view || view.samples.length === 0;
          const word = score ? pulseScoreWord(score.value) : null;
          return (
            <div
              key={domain}
              className="grid grid-cols-[4.5rem_1fr_7rem] items-center gap-x-2 sm:grid-cols-[5.5rem_1fr_9rem] sm:gap-x-3"
              role="img"
              aria-label={
                empty
                  ? `${label}: no activity in the last 24 hours`
                  : `${label} over the last 24 hours: ${score && word ? `${word}, ${score.value.toFixed(1)} of 3, trending ${score.trend}` : "not scored yet"}`
              }
            >
              <span className="label-mono truncate text-muted-foreground">{label}</span>
              {empty ? (
                <span className="text-xs text-muted-foreground">No activity yet</span>
              ) : (
                <Lane label={label} samples={view.samples} range={range} />
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
