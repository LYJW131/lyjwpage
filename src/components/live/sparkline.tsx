"use client";

import { useId } from "react";

import type { ChargerSample } from "@/lib/types";

/**
 * 手写 SVG 柱状图 —— 为这么小一块引 recharts 不值得。
 *
 * 用柱不用折线：两处的数据都是离散的（充电器是瞬时读数，Vibe Coding 是
 * 12 小时聚合桶），连成折线会把采样间的跳变画成毛刺，看着比实际更抖。
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
/** 柱子占一个采样间隔的比例，留出的缝隙让相邻柱子分得开 */
const BAR_FILL = 0.62;

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

  /**
   * 柱宽按「采样间隔」算，不按「柱子个数」算。
   *
   * 横轴是时间，柱子也按时间定位 —— 断线留下的空档才会如实空着，而不是被
   * 均分挤没。取中位间隔而不是平均，免得个别长空档把所有柱子压成细线。
   */
  const gaps = points
    .slice(1)
    .map(([x], index) => x - points[index][0])
    .sort((a, b) => a - b);
  const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : width;
  const barWidth = Math.max(0.4, medianGap * BAR_FILL);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--live)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--live)" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      {points.map(([x, y], index) => (
        <rect
          key={index}
          x={(x - barWidth / 2).toFixed(2)}
          y={y.toFixed(2)}
          width={barWidth.toFixed(2)}
          height={(height - y).toFixed(2)}
          fill={`url(#fill-${id})`}
        />
      ))}
    </svg>
  );
}
