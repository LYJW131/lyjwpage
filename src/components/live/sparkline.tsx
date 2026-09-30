"use client";

import { useId, useState } from "react";

import { LIVE_INTERVAL_MS, LIVE_WINDOW_MS } from "@/lib/limits";
import type { ChargerSample } from "@/lib/types";


const WINDOW_MS = 20 * 60 * 1000;
const STEP = 40;
const BAR_FILL = 0.62;
const HOLD_SLOTS = 2;

export function Sparkline({
  samples,
  bucket = true,
  formatValue,
  className,
}: {
  samples: ChargerSample[];
  bucket?: boolean;
  formatValue?: (value: number) => string;
  className?: string;
}) {
  const id = useId();
  const [hovered, setHovered] = useState<number | null>(null);

  if (samples.length < 2) {
    return <div className={className} aria-hidden />;
  }

  const width = 100;
  const height = 32;

  const end = samples[samples.length - 1].t;
  const start = end - WINDOW_MS;

  // 保留窗口左侧的跨界样本，否则首段会缺失且随新点抖动。
  const firstInside = samples.findIndex((sample) => sample.t >= start);
  if (firstInside < 0 || samples.length - firstInside < 2) {
    return <div className={className} aria-hidden />;
  }
  const visible = samples.slice(Math.max(0, firstInside - 1));

  const span = Math.max(1, end - start);

  const bars: { x: number; width: number; hitX: number; hitW: number; value: number }[] = [];

  if (!bucket) {
    const slotCount = Math.round(LIVE_WINDOW_MS / LIVE_INTERVAL_MS);
    const live = samples.slice(-slotCount);
    const slotWidth = width / slotCount;
    const barWidth = Math.max(0.4, slotWidth * BAR_FILL);
    const offset = slotCount - live.length;
    for (let i = 0; i < live.length; i += 1) {
      const index = offset + i;
      bars.push({
        x: index * slotWidth + (slotWidth - barWidth) / 2,
        width: barWidth,
        hitX: index * slotWidth,
        hitW: slotWidth,
        value: live[i].w,
      });
    }
  } else {
    const gaps = visible
      .slice(1)
      .map((sample, index) => sample.t - visible[index].t)
      .sort((a, b) => a - b);
    const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : span;

    const slotCount = Math.min(72, Math.max(8, Math.round(span / medianGap) + 1));
    const slotSpan = span / slotCount;
    const slotWidth = width / slotCount;
    const barWidth = Math.max(0.4, slotWidth * BAR_FILL);

    const bucketed: (number | null)[] = new Array(slotCount).fill(null);
    for (const sample of visible) {
      const index = Math.floor((sample.t - start) / slotSpan);
      if (index < 0 || index >= slotCount) continue;
      bucketed[index] = Math.max(bucketed[index] ?? 0, sample.w);
    }

    let held: number | null = visible[0].t < start ? visible[0].w : null;
    let idle = 0;
    for (let index = 0; index < bucketed.length; index += 1) {
      const slot = bucketed[index];
      if (slot != null) {
        held = slot;
        idle = 0;
      } else {
        idle += 1;
      }
      const value = slot ?? (held != null && idle <= HOLD_SLOTS ? held : null);
      if (value == null) continue;
      bars.push({
        x: index * slotWidth + (slotWidth - barWidth) / 2,
        width: barWidth,
        hitX: index * slotWidth,
        hitW: slotWidth,
        value,
      });
    }
  }

  const peak = Math.max(0, ...bars.map((bar) => bar.value));
  const ceiling = Math.max(STEP, Math.ceil(peak / STEP) * STEP);

  const active = hovered != null ? bars[hovered]?.value ?? null : null;

  return (
    <div
      className={`relative ${className ?? ""}`}
      onMouseLeave={formatValue ? () => setHovered(null) : undefined}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden
      >
        <defs>
          <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--live)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--live)" stopOpacity="0.35" />
          </linearGradient>
        </defs>
        {bars.map((bar, index) => {
          const y = height - (Math.min(Math.max(bar.value, 0), ceiling) / ceiling) * height;
          return (
            <rect
              key={index}
              x={bar.x.toFixed(2)}
              y={y.toFixed(2)}
              width={bar.width.toFixed(2)}
              height={(height - y).toFixed(2)}
              fill={`url(#fill-${id})`}
              opacity={hovered != null && hovered !== index ? 0.4 : 1}
            />
          );
        })}
        {formatValue &&
          bars.map((bar, index) => {
            const y = height - (Math.min(Math.max(bar.value, 0), ceiling) / ceiling) * height;
            return (
              <rect
                key={`hit-${index}`}
                x={bar.hitX.toFixed(2)}
                y={y.toFixed(2)}
                width={bar.hitW.toFixed(2)}
                height={(height - y).toFixed(2)}
                fill="transparent"
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
              />
            );
          })}
      </svg>

      {formatValue && active != null && hovered != null && bars[hovered] && (
        <div
          className="pointer-events-none absolute z-10 -mt-1 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-sm border border-line bg-surface px-1.5 py-0.5 label-mono text-foreground"
          style={{
            left: `${Math.min(92, Math.max(8, ((bars[hovered].hitX + bars[hovered].hitW / 2) / width) * 100))}%`,
            top: `${(1 - Math.min(Math.max(active, 0), ceiling) / ceiling) * 100}%`,
          }}
        >
          {formatValue(active)}
        </div>
      )}
    </div>
  );
}
