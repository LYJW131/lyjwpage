"use client";

import { useId, useState } from "react";

import type { ChargerSample } from "@/lib/types";

/**
 * 手写 SVG 迷你图 —— 为这么小一块引 recharts 不值得。
 *
 * 两种形态，按「这张图要回答什么问题」选：
 *
 * - bars：充电器的瞬时功率。读者关心的是「此刻多少瓦、刚才有没有尖峰」，
 *   一根柱就是一次读数；连成折线等于声称采样之间也有连续取值，把跳变
 *   画成毛刺，看着比实际更抖。
 * - trend：Vibe Coding 的 30 天用量。读者关心的是走向，折线 + 面积能一眼
 *   看出趋势，而 60 根柱子只是 60 个孤立的数。
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
/** 连续这么多个空槽还没有新读数，就认为是断流而不是「值没变」 */
const HOLD_SLOTS = 2;

/**
 * 单调三次插值（Fritsch–Carlson），输出三次贝塞尔路径。
 *
 * 不用普通的 Catmull-Rom：它会在急剧起落处冲过头，在数据里根本没有的地方
 * 画出峰谷 —— token 用量不可能为负，冲出去的下摆是彻头彻尾的假信息。
 * 单调插值保证曲线不越过相邻两点的取值范围，只是把折角磨圆。
 */
function smoothPath(points: readonly (readonly [number, number])[]) {
  const n = points.length;
  const move = `M${points[0][0].toFixed(2)},${points[0][1].toFixed(2)}`;
  if (n === 2) {
    return `${move} L${points[1][0].toFixed(2)},${points[1][1].toFixed(2)}`;
  }

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const h = points[i + 1][0] - points[i][0];
    dx.push(h);
    slope.push(h === 0 ? 0 : (points[i + 1][1] - points[i][1]) / h);
  }

  // 端点取相邻斜率；内部取平均，但极值点（左右斜率异号）强制置零，
  // 这样曲线在峰谷处是平的，不会翘出去
  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }

  // Fritsch–Carlson 限幅：把切线拉回单调区间内
  for (let i = 0; i < n - 1; i += 1) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const magnitude = a * a + b * b;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      m[i] = scale * a * slope[i];
      m[i + 1] = scale * b * slope[i];
    }
  }

  let d = move;
  for (let i = 0; i < n - 1; i += 1) {
    const h = dx[i] / 3;
    const c1x = points[i][0] + h;
    const c1y = points[i][1] + m[i] * h;
    const c2x = points[i + 1][0] - h;
    const c2y = points[i + 1][1] - m[i + 1] * h;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${points[i + 1][0].toFixed(2)},${points[i + 1][1].toFixed(2)}`;
  }
  return d;
}

export function Sparkline({
  samples,
  max,
  windowMs = WINDOW_MS,
  step = STEP,
  variant = "bars",
  formatValue,
  className,
}: {
  samples: ChargerSample[];
  /** 固定纵轴上限；省略时按 step 向上量化。 */
  max?: number;
  /** 固定横轴窗口；传 null 时使用全部样本的实际时间跨度。 */
  windowMs?: number | null;
  step?: number;
  /** bars 适合瞬时读数，trend 适合看走向 —— 取舍见文件头 */
  variant?: "bars" | "trend";
  /** 传了就在 bars 上启用悬停读数；返回要显示的文本 */
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

  const span = Math.max(1, end - start);

  if (variant === "trend") {
    const peak = Math.max(...visible.map((sample) => sample.w));
    const ceiling =
      max == null
        ? Math.max(step, Math.ceil(peak / step) * step)
        : Math.max(max, 1);
    const points = visible.map((sample) => {
      const x = ((sample.t - start) / span) * width;
      const y = height - (Math.min(Math.max(sample.w, 0), ceiling) / ceiling) * height;
      return [x, y] as const;
    });
    const line = smoothPath(points);
    // 面积的左右底边要对齐折线的首尾，否则窗口没填满时底部会多出一块
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
          <linearGradient id={`trend-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--live)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--live)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#trend-${id})`} />
        <path
          d={line}
          fill="none"
          stroke="var(--live)"
          strokeWidth="1.5"
          strokeOpacity="0.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

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
   * 约 41 槽；Vibe Coding 30 天 / 12 小时正好得到 60 槽 —— 它本来就在规则网格
   * 上，这样不会被重新聚合而失真。
   */
  const slotCount = Math.min(72, Math.max(8, Math.round(span / medianGap) + 1));
  const slotSpan = span / slotCount;

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
  const values: (number | null)[] = [];
  // 窗口左边界外那个读数是槽 0 的沿用来源
  let held: number | null = visible[0].t < start ? visible[0].w : null;
  let idle = 0;
  for (const slot of bucketed) {
    if (slot != null) {
      held = slot;
      idle = 0;
    } else {
      idle += 1;
    }
    values.push(slot ?? (held != null && idle <= HOLD_SLOTS ? held : null));
  }

  const peak = Math.max(0, ...values.filter((v): v is number => v != null));
  const ceiling =
    max == null
      ? Math.max(step, Math.ceil(peak / step) * step)
      : Math.max(max, 1);

  const slotWidth = width / slotCount;
  const barWidth = Math.max(0.4, slotWidth * BAR_FILL);

  const active = hovered != null ? values[hovered] : null;

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
        {values.map((value, index) => {
          if (value == null) return null;
          const y = height - (Math.min(Math.max(value, 0), ceiling) / ceiling) * height;
          return (
            <rect
              key={index}
              x={(index * slotWidth + (slotWidth - barWidth) / 2).toFixed(2)}
              y={y.toFixed(2)}
              width={barWidth.toFixed(2)}
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
          values.map((value, index) => {
            if (value == null) return null;
            const y = height - (Math.min(Math.max(value, 0), ceiling) / ceiling) * height;
            return (
              <rect
                key={`hit-${index}`}
                x={(index * slotWidth).toFixed(2)}
                y={y.toFixed(2)}
                width={slotWidth.toFixed(2)}
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

      {formatValue && active != null && hovered != null && (
        <div
          className="pointer-events-none absolute z-10 -mt-1 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-sm border border-line bg-surface px-1.5 py-0.5 label-mono text-foreground"
          style={{
            // 贴那一列的中心；两端夹住，免得气泡被卡片边缘裁掉
            left: `${Math.min(92, Math.max(8, ((hovered + 0.5) / slotCount) * 100))}%`,
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
