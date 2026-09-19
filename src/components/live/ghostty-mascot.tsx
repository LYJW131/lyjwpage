"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";

import data from "@/lib/ghostty-frames.json";
import { decodeGhosttyFrames, ghosttyFrameIndex } from "@/lib/ghostty-frames";

/** 官网光环用的蓝 */
const GLOW_COLOR = "#3551f3";
/** 静止（减少动态效果）时停在第一帧：正脸、双眼平视 */
const STATIC_FRAME = 0;

const viewBoxWidth = data.columns * data.cellAspect;

/**
 * 79 帧解成 path 要十几毫秒（节流的手机上是这个的好几倍），所以不在模块顶层解。
 *
 * 这个模块被页头的应用图标表静态引着，每个访客都会加载它 —— 但幽灵只在前台
 * 应用真是 Ghostty 时才画。放在模块顶层等于人人都替这十几毫秒买单，还正好落在
 * 首屏最忙的那段里。解完的结果整个进程共用一份，换应用来回切也不重解。
 */
let decoded: ReturnType<typeof decodeGhosttyFrames> | null = null;
function ghosttyFrames() {
  return (decoded ??= decodeGhosttyFrames(data));
}

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
  const frames = useMemo(() => ghosttyFrames(), []);

  useEffect(() => {
    if (reducedMotion) return;

    let handle = 0;
    let current = STATIC_FRAME;
    /*
     * 基准取第一次 rAF 的时间戳，不取 effect 里的 performance.now()：rAF 给的是
     * 这一帧开始渲染的时刻，同一帧里 effect 先跑、回调后跑时它会早几毫秒，
     * 两边不同源就会算出负的帧号。
     */
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
