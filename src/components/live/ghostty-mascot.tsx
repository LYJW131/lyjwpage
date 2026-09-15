"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import data from "@/lib/ghostty-frames.json";
import { decodeGhosttyFrames } from "@/lib/ghostty-frames";

/** 官网光环用的蓝 */
const GLOW_COLOR = "#3551f3";
/** 静止（减少动态效果）时停在第一帧：正脸、双眼平视 */
const STATIC_FRAME = 0;

const frames = decodeGhosttyFrames(data);
const viewBoxWidth = data.columns * data.cellAspect;

/**
 * ghostty.org 首页那只 ASCII 幽灵，压成 24px 图标的粗网格后原速循环
 * （数据与压制方式见 scripts/ghostty-frames.mjs）。
 *
 * 本体用 currentColor 跟随页面文字色，光环固定官网蓝。按经过的时间取帧，
 * 而不是每次回调进一帧：标签页切到后台 rAF 停摆，回来时直接跳到该在的那帧。
 * SVG 上的 data-frame 是当前帧号，scripts/desktop-marks-gif.py 录 README 动图时靠它逐帧对齐。
 */
export function GhosttyMascot({
  className,
  size = 24,
}: {
  className?: string;
  size?: number;
}) {
  const reducedMotion = useReducedMotion();
  const [frameIndex, setFrameIndex] = useState(STATIC_FRAME);

  useEffect(() => {
    if (reducedMotion) return;

    let handle = 0;
    let current = STATIC_FRAME;
    const startedAt = performance.now();

    const tick = (now: number) => {
      const next = Math.floor((now - startedAt) / data.frameMs) % frames.length;
      if (next !== current) {
        current = next;
        setFrameIndex(next);
      }
      handle = window.requestAnimationFrame(tick);
    };

    handle = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(handle);
  }, [reducedMotion]);

  const shownFrame = reducedMotion ? STATIC_FRAME : frameIndex;
  const layers = frames[shownFrame];

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
