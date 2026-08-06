"use client";

import { useId } from "react";

import type { ChargerSample } from "@/lib/types";

/**
 * 手写 SVG 面积图 —— 为一条 40px 高的曲线引 recharts 不值得。
 *
 * 横坐标按时间戳映射，而不是按点的序号等距铺开：推送模式下 30 秒一个点，
 * 漏推一次就会出现空档，等距铺开会把那段时间画得和正常间隔一样宽。
 *
 * 用 preserveAspectRatio="none" 让 viewBox 拉伸填满容器，
 * 这样不用测量 DOM 宽度就能自适应。
 */
export function Sparkline({
  samples,
  max,
  className,
}: {
  samples: ChargerSample[];
  /** 纵轴上限，传固定值可以让曲线高度在多次采样间保持可比 */
  max: number;
  className?: string;
}) {
  const id = useId();

  if (samples.length < 2) {
    return <div className={className} aria-hidden />;
  }

  const width = 100;
  const height = 32;
  const ceiling = Math.max(max, 1);

  const t0 = samples[0].t;
  const span = samples[samples.length - 1].t - t0;
  // 所有点时间戳相同（理论上不会）时退化成等距，避免除以 0
  const xOf = (sample: ChargerSample, index: number) =>
    span > 0 ? ((sample.t - t0) / span) * width : (index / (samples.length - 1)) * width;

  const points = samples.map((sample, index) => {
    const y = height - (Math.min(Math.max(sample.w, 0), ceiling) / ceiling) * height;
    return [xOf(sample, index), y] as const;
  });

  const line = points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;

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
