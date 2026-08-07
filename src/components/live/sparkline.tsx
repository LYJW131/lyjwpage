"use client";

import { useId } from "react";

import type { ChargerSample } from "@/lib/types";

/**
 * 手写 SVG 面积图 —— 为一条 40px 高的曲线引 recharts 不值得。
 *
 * 两条坐标轴都刻意做成「不随数据变」：
 *
 * - 横轴是固定时间窗（最近 WINDOW_MS），不是「首点到末点铺满」。后者的跨度
 *   每来一个点就变一次，所有点的 x 会跟着变，整条曲线就在原地蠕动；充电头
 *   断线重连留下断档时跳得尤其明显（实测断档能到 63 秒）。固定窗口下曲线只是
 *   匀速左移，断档就老老实实是一段空白。
 * - 纵轴向上取整到 STEP 的倍数，而不是直接用峰值。否则峰值一变整条曲线的
 *   高度就跟着跳。
 *
 * preserveAspectRatio="none" 让 viewBox 拉伸填满容器，不用测 DOM 宽度。
 */

/**
 * 横轴时间窗：显示最近这段时间。
 * 必须短于「环形缓冲能覆盖的时长」，否则数据不够铺满，曲线左边会空一截。
 * charger-store 的 HISTORY_LIMIT(400) × 最密采样间隔(5s) = 33 分钟，留足余量。
 */
const WINDOW_MS = 20 * 60 * 1000;
/**
 * 纵轴量化步长（瓦）。
 * 步长越粗，峰值跨越台阶、整条曲线高度跳变的次数越少；
 * 但太粗日常几十瓦会被压扁。40W 一档 → 40/80/120/160，正好贴着这个充电头的量程。
 */
const STEP = 40;

export function Sparkline({
  samples,
  max,
  windowMs = WINDOW_MS,
  step = STEP,
  className,
}: {
  samples: ChargerSample[];
  /** 固定纵轴上限；省略时按 step 向上量化。 */
  max?: number;
  /** 固定横轴窗口；传 null 时使用全部样本的实际时间跨度。 */
  windowMs?: number | null;
  step?: number;
  className?: string;
}) {
  const id = useId();

  if (samples.length < 2) {
    return <div className={className} aria-hidden />;
  }

  const width = 100;
  const height = 32;

  // 以最后一个采样点为窗口右边界，而不是 Date.now()：
  // 断流时曲线就停在原地，不会被慢慢推出视野变成一片空白
  const end = samples[samples.length - 1].t;
  const start = windowMs == null ? samples[0].t : end - windowMs;

  /**
   * 画的是一段时间窗内的连续信号，所以喂进来的必须是「跨过窗口边界」的样本，
   * 而不是「落在窗口内」的样本 —— 被左边界切断的那一段线，需要边界外的那个
   * 点才画得出来。少了它，曲线就从窗口内侧的第一个采样点开始，左边空出
   * 0~一个采样间隔的距离（实测约 0~12px），而且每来一个新点就变一次。
   *
   * 越界的部分由 SVG 视口裁掉，不用自己去算边界上的值。
   */
  const firstInside = samples.findIndex((sample) => sample.t >= start);
  if (firstInside < 0 || samples.length - firstInside < 2) {
    return <div className={className} aria-hidden />;
  }
  // 历史比窗口还短时没有跨界的样本，左边如实空着
  const visible = samples.slice(Math.max(0, firstInside - 1));

  const peak = Math.max(...visible.map((sample) => sample.w));
  const ceiling =
    max == null
      ? Math.max(step, Math.ceil(peak / step) * step)
      : Math.max(max, 1);
  const span = Math.max(1, end - start);

  const points = visible.map((sample) => {
    const x = ((sample.t - start) / span) * width;
    const y = height - (Math.min(Math.max(sample.w, 0), ceiling) / ceiling) * height;
    return [x, y] as const;
  });

  const line = points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  // 面积图的左右底边要对齐曲线的首尾，否则窗口没填满时底部会多出一块
  const first = points[0][0];
  const last = points[points.length - 1][0];
  const area = `${line} L${last.toFixed(2)},${height} L${first.toFixed(2)},${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--live)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--live)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#fill-${id})`} />
      <path
        d={line}
        fill="none"
        stroke="var(--live)"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
