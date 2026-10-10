"use client";

import NumberFlow from "@number-flow/react";
import { useId, type ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { useStale } from "@/hooks/use-stale";
import { useStatus } from "@/hooks/use-status";
import { ACTIVITY_STALE_MS } from "@/lib/freshness";
import { ACTIVITY_PATH } from "@/lib/paths";
import type { ActivityPayload, StatusResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

type RingId = "move" | "exercise" | "stand";

const RINGS: ReadonlyArray<{
  id: RingId;
  label: string;
  unit: string;
  radius: number;
}> = [
  { id: "move", label: "Move", unit: "kcal", radius: 44.65 },
  { id: "exercise", label: "Exercise", unit: "min", radius: 32.72 },
  { id: "stand", label: "Stand", unit: "hrs", radius: 20.54 },
];

const STROKE = 10.7;

const GLYPH_STROKE = 0.74;

export type RingValue = { id: RingId; label: string; unit: string; radius: number; value: number; goal: number };

export function ringValues(data: ActivityPayload | undefined, current: boolean): RingValue[] {
  return RINGS.map((ring) => ({
    ...ring,
    value: !current
      ? 0
      : ring.id === "move"
        ? (data?.moveKcal ?? 0)
        : ring.id === "exercise"
          ? (data?.exerciseMinutes ?? 0)
          : (data?.standHours ?? 0),
    goal:
      ring.id === "move"
        ? (data?.moveGoalKcal ?? 0)
        : ring.id === "exercise"
          ? (data?.exerciseGoalMinutes ?? 0)
          : (data?.standGoalHours ?? 0),
  }));
}

function ratio(ring: RingValue) {
  return ring.goal > 0 ? ring.value / ring.goal : 0;
}

const CAP_SHADOW: ReadonlyArray<[number, number]> = [
  [0, 0.6],
  [1, 0.45],
  [2, 0.28],
  [3, 0.14],
  [4, 0],
];

const CAP_SHADOW_REACH = CAP_SHADOW[CAP_SHADOW.length - 1][0];

// 圆环也画在首页对话的卡片里，同页会有两份：渐变与遮罩的 id 按实例区分，不然 url(#…) 都指向第一份。
export function Rings({
  rings,
  className,
  unavailable = false,
}: {
  rings: RingValue[];
  className?: string;
  unavailable?: boolean;
}) {
  const uid = useId();
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label={
        unavailable
          ? "Activity unavailable"
          : rings
              .map((ring) => `${ring.label} ${Math.round(ring.value)} / ${ring.goal} ${ring.unit}`)
              .join(", ")
      }
    >
      <defs>
        {RINGS.map((ring) => (
          <mask key={`${ring.id}-band`} id={`${uid}-${ring.id}-band`}>
            <circle
              cx="50"
              cy="50"
              r={ring.radius}
              fill="none"
              stroke="#fff"
              strokeWidth={STROKE}
            />
          </mask>
        ))}
        {RINGS.map((ring) => (
          <linearGradient
            key={ring.id}
            id={`${uid}-${ring.id}-arc`}
            x1="0"
            y1="1"
            x2="1"
            y2="0"
          >
            <stop offset="0%" stopColor={`var(--activity-${ring.id})`} />
            <stop offset="100%" stopColor={`var(--activity-${ring.id}-lit)`} />
          </linearGradient>
        ))}
      </defs>

      {rings.map((ring) => {
        const circumference = 2 * Math.PI * ring.radius;
        const done = ratio(ring);
        const filled = Math.min(done, 1);
        const overflow = done > 1 ? done % 1 : 0;
        const capAngle = overflow * 2 * Math.PI - Math.PI / 2;
        const capX = 50 + ring.radius * Math.cos(capAngle);
        const capY = 50 + ring.radius * Math.sin(capAngle);
        return (
          <g key={ring.id} style={{ color: `var(--activity-${ring.id})` }}>
            <circle
              cx="50"
              cy="50"
              r={ring.radius}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.16}
              strokeWidth={STROKE}
            />
            <circle cx="50" cy={50 - ring.radius} r={STROKE / 2} fill="currentColor" />
            {/* 零值也保留弧元素，否则第一次非零更新没有可过渡的起始状态。 */}
            <circle
              cx="50"
              cy="50"
              r={ring.radius}
              fill="none"
              stroke={`url(#${uid}-${ring.id}-arc)`}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={circumference}
              /* stroke-dashoffset 必须经 style 更新；SVG 表现属性更新不会触发这里的 CSS 过渡。 */
              style={{ strokeDashoffset: circumference * (1 - filled) }}
              transform="rotate(-90 50 50)"
              className="transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none"
            />
            {overflow > 0 && (
              <>
                <g mask={`url(#${uid}-${ring.id}-band)`}>
                  <radialGradient
                    id={`${uid}-${ring.id}-cap-shadow`}
                    gradientUnits="userSpaceOnUse"
                    cx={capX}
                    cy={capY}
                    r={STROKE / 2 + CAP_SHADOW_REACH}
                  >
                    {CAP_SHADOW.map(([at, alpha]) => (
                      <stop
                        key={at}
                        offset={(STROKE / 2 + at) / (STROKE / 2 + CAP_SHADOW_REACH)}
                        stopColor="#000"
                        style={{ stopOpacity: `calc(${alpha} * var(--activity-shadow))` }}
                      />
                    ))}
                  </radialGradient>
                  <circle
                    cx={capX}
                    cy={capY}
                    r={STROKE / 2 + CAP_SHADOW_REACH}
                    fill={`url(#${uid}-${ring.id}-cap-shadow)`}
                  />
                </g>
                <circle
                  cx="50"
                  cy="50"
                  r={ring.radius}
                  fill="none"
                  stroke={`url(#${uid}-${ring.id}-arc)`}
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  style={{ strokeDashoffset: circumference * (1 - overflow) }}
                  transform="rotate(-90 50 50)"
                  className="transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none"
                />
              </>
            )}
          </g>
        );
      })}

      {rings.map((ring) => (
        <g
          key={`${ring.id}-glyph`}
          transform={`translate(50 ${50 - ring.radius})`}
          fill="none"
          stroke="var(--activity-ink)"
          strokeWidth={GLYPH_STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {ring.id === "move" && <path d="M-2.65 0 H2.3 M-0.42 -3.07 L2.65 0 L-0.42 3.07" />}
          {ring.id === "exercise" && (
            <path d="M-3.43 0 H0.65 M-1.51 -2.58 L1.11 0 L-1.51 2.58 M0.65 -2.58 L3.26 0 L0.65 2.58" />
          )}
          {ring.id === "stand" && <path d="M0 2.65 V-2.3 M-3.07 0.42 L0 -2.65 L3.07 0.42" />}
        </g>
      ))}
    </svg>
  );
}


type Extra = { label: string; value: ReactNode | null };

export function ActivityCard({
  fallback,
  children,
  className,
}: {
  fallback: StatusResponse<ActivityPayload>;
  children?: ReactNode;
  className?: string;
}) {
  const { data: latest, updatedAt, servedAt, error, isLoading, awaiting } = useStatus<ActivityPayload>(ACTIVITY_PATH, {
    fallback,
  });
  const stale = useStale(updatedAt ?? latest?.pushedAt, ACTIVITY_STALE_MS, servedAt);
  const unavailable = !latest || stale;
  const showMeasured = Boolean(latest) && (stale || Boolean(latest?.currentAtSource));

  // useMountedAt 是定格时刻，用它判日期会在跨夜后把新上报误判为昨天。
  const rings = ringValues(latest, showMeasured);
  const measured = (value: number | null | undefined) => (showMeasured ? (value ?? 0) : 0);

  const extras: Extra[] = !latest
    ? [
        { label: "Steps", value: null },
        { label: "Distance", value: null },
        { label: "Flights", value: null },
      ]
    : [
        { label: "Steps", value: <NumberFlow value={measured(latest.steps)} /> },
        {
          label: "Distance",
          value: `${(measured(latest.distanceMeters) / 1000).toFixed(2)} km`,
        },
        { label: "Flights", value: <NumberFlow value={measured(latest.flightsClimbed)} /> },
      ];
  const action =
    latest && !stale
      ? "Apple Watch"
      : !latest && isLoading && !error && !awaiting
        ? "Loading…"
        : !latest && awaiting
          ? "No report"
          : "Unavailable";

  return (
    <Card label="Activity" action={action} className={cn("h-full", className)}>
      <div className="grid min-w-0 md:grid-cols-2">
      <div className={cn("grid min-h-44 md:h-[207px] lg:h-[215px] grid-cols-[auto_1fr] items-center justify-items-center gap-3 p-4 lg:grid-cols-[auto_1fr_1fr] lg:gap-4 lg:p-5", unavailable && "opacity-40")}>
        <Rings rings={rings} unavailable={unavailable} className="size-32 shrink-0 md:size-36 lg:size-40" />

        <div className="min-w-0">
          <div className="grid gap-1.5">
            {rings.map((ring) => (
              <div key={ring.id} className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: `var(--activity-${ring.id})` }}
                  />
                  <span className="label-mono text-muted-foreground">{ring.label}</span>
                </div>
                <div className="truncate font-mono text-lg tabular-nums">
                  {latest ? (
                    stale ? (
                      <span>{Math.round(ring.value)}</span>
                    ) : (
                      <NumberFlow value={Math.round(ring.value)} />
                    )
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                  <span className="text-sm text-muted-foreground">
                    {` / ${latest ? ring.goal : "—"} ${ring.unit}`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="hidden min-w-0 gap-1.5 lg:grid">
          {extras.map((item) => (
            <div key={item.label} className="min-w-0">
              <div className="label-mono text-muted-foreground">{item.label}</div>
              <div className="truncate font-mono text-lg tabular-nums">
                {item.value ?? <span className="text-muted-foreground">—</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
      {children}
      </div>
    </Card>
  );
}
