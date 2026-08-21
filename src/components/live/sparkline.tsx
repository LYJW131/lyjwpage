"use client";

import { useId, useState } from "react";

import { LIVE_INTERVAL_MS, LIVE_WINDOW_MS } from "@/lib/limits";
import type { ChargerSample } from "@/lib/types";

/**
 * 手写 SVG 柱状迷你图 —— 为这么小一块引 recharts 不值得。
 *
 * 画的是充电器的瞬时功率。读者关心的是「此刻多少瓦、刚才有没有尖峰」，
 * 一根柱就是一次读数；连成折线等于声称采样之间也有连续取值，把跳变
 * 画成毛刺，看着比实际更抖。（从前还有一个 trend 折线形态给 Vibe Coding
 * 的 30 日曲线用，年历热力图上线后随调用方一起删了。）
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
 * lib/limits 的 CHARGER_HISTORY_LIMIT(400) × 最密采样间隔(5s) = 33 分钟，留足余量。
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
/** 连续这么多个空槽还没有新读数，就认为是断流而不是「值没变」 */
const HOLD_SLOTS = 2;

export function Sparkline({
  samples,
  bucket = true,
  formatValue,
  className,
}: {
  samples: ChargerSample[];
  /**
   * 远端不规则采样才按中位间隔收成槽。本机 SSE 1 Hz，一帧一根柱，
   * 不要再峰值进桶 —— 否则几十个读数挤在最后一格，柱子看起来不跟着跳。
   */
  bucket?: boolean;
  /** 传了就启用悬停读数；返回要显示的文本 */
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

  // 以最后一个采样点为窗口右边界，而不是 Date.now()：
  // 断流时曲线就停在原地，不会被慢慢推出视野变成一片空白
  const end = samples[samples.length - 1].t;
  const start = end - WINDOW_MS;

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

  const span = Math.max(1, end - start);

  /**
   * 本机 SSE：一帧一根柱，按采样时刻落点。远端不规则采样才按中位间隔收成槽。
   */
  const bars: { x: number; width: number; hitX: number; hitW: number; value: number }[] = [];

  if (!bucket) {
    /**
     * 本机 1 Hz：槽数写死，柱宽和间距从头到尾不变。
     * 按墙钟落点的话，帧间隔一抖柱距就一宽一窄；按序号排，空槽留在左边。
     */
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

    /**
     * 把窗口切成等宽时间槽，再一槽一柱。
     *
     * 采样是不规则的：实测间隔 5.1~37.2 秒、中位 29.9 秒。一个采样一根柱、
     * 柱宽取中位间隔的话，密集处会互相压住 —— 最近的一对只差 5.1 秒，按中位数
     * 画会重叠 83%，看起来就是一片乱。柱状图隐含「等宽的离散区间」，那就真的
     * 按等宽区间来分，而不是反过来去凑柱宽。
     *
     * 槽数由数据自己的节奏决定（跨度 ÷ 中位间隔）：充电器 20 分钟 / 30 秒得到
     * 约 41 槽；Vibe Coding 30 天 / 1 天正好得到 30 槽 —— 它本来就在规则网格
     * 上，这样不会被重新聚合而失真。
     */
    const slotCount = Math.min(72, Math.max(8, Math.round(span / medianGap) + 1));
    const slotSpan = span / slotCount;
    const slotWidth = width / slotCount;
    const barWidth = Math.max(0.4, slotWidth * BAR_FILL);

    const bucketed: (number | null)[] = new Array(slotCount).fill(null);
    for (const sample of visible) {
      const index = Math.floor((sample.t - start) / slotSpan);
      if (index < 0 || index >= slotCount) continue;
      // 同槽多个读数取峰值：功率图上尖峰比均值更有意义
      bucketed[index] = Math.max(bucketed[index] ?? 0, sample.w);
    }

    /**
     * 空槽沿用上一个读数 —— 功率在下次上报前就是维持不变的，不是零。
     * 但连续 HOLD_SLOTS 槽都没有新读数就当断流，如实空着，不拿旧值糊过去。
     */
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
    // 相对定位是给读数气泡用的：viewBox 被 preserveAspectRatio="none" 拉伸，
    // SVG 里的文字会跟着变形，所以气泡只能是 HTML
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
        {/*
          命中区：横向覆盖整列（柱子只有几像素宽，光标很难精确落上去），
          纵向只从柱顶往下 —— 全高的话，柱子矮时光标飘在上方老远就触发了。
        */}
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
                // 也要自己负责解除：外层容器的 onMouseLeave 只在光标离开整块
                // 图表时才触发，从柱子挪到它上方的空白仍然在容器内
                onMouseLeave={() => setHovered(null)}
              />
            );
          })}
      </svg>

      {formatValue && active != null && hovered != null && bars[hovered] && (
        <div
          className="pointer-events-none absolute z-10 -mt-1 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-sm border border-line bg-surface px-1.5 py-0.5 label-mono text-foreground"
          style={{
            // 贴那一列的中心；两端夹住，免得气泡被卡片边缘裁掉
            left: `${Math.min(92, Math.max(8, ((bars[hovered].hitX + bars[hovered].hitW / 2) / width) * 100))}%`,
            // 贴柱子顶端而不是容器顶端 —— 柱子矮的时候上面空一大片，
            // 气泡飘在那儿看不出跟谁有关系
            top: `${(1 - Math.min(Math.max(active, 0), ceiling) / ceiling) * 100}%`,
          }}
        >
          {formatValue(active)}
        </div>
      )}
    </div>
  );
}
