"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";

import data from "@/lib/ghostty-frames.json";
import { decodeGhosttyFrames, ghosttyFrameIndex } from "@/lib/ghostty-frames";

const GLOW_COLOR = "#3551f3";
const STATIC_FRAME = 0;

const viewBoxWidth = data.columns * data.cellAspect;

let decoded: ReturnType<typeof decodeGhosttyFrames> | null = null;
function ghosttyFrames() {
  return (decoded ??= decodeGhosttyFrames(data));
}

export function GhosttyMascot({
  className,
  size = 24,
}: {
  className?: string;
  size?: number;
}) {
  const reducedMotion = useReducedMotion();
  const [frameIndex, setFrameIndex] = useState(STATIC_FRAME);
  const frames = useMemo(() => ghosttyFrames(), []);

  useEffect(() => {
    if (reducedMotion) return;

    let handle = 0;
    let current = STATIC_FRAME;
    /* rAF 时间戳可能早于同帧 effect 的 performance.now()，必须用首个回调建立基准。 */
    let startedAt: number | null = null;

    const tick = (now: number) => {
      startedAt ??= now;
      const next = ghosttyFrameIndex(now - startedAt, data.frameMs, frames.length);
      if (next !== current) {
        current = next;
        setFrameIndex(next);
      }
      handle = window.requestAnimationFrame(tick);
    };

    handle = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(handle);
  }, [frames.length, reducedMotion]);

  const shownFrame = reducedMotion ? STATIC_FRAME : frameIndex;
  const layers = frames[shownFrame] ?? frames[STATIC_FRAME] ?? [];

  return (
    <svg
      aria-hidden
      className={className}
      data-frame={shownFrame}
      height={size}
      role="presentation"
      style={{ flex: "none", lineHeight: 1 }}
      viewBox={`0 0 ${viewBoxWidth} ${data.rows}`}
      width={(size * viewBoxWidth) / data.rows}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform={`scale(${data.cellAspect} 1)`}>
        {layers.map((layer, index) => (
          <path
            d={layer.d}
            fill={layer.fill === "glow" ? GLOW_COLOR : "currentColor"}
            fillOpacity={layer.opacity}
            key={`${layer.fill}-${index}`}
          />
        ))}
      </g>
    </svg>
  );
}
