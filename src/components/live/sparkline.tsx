"use client";

import { useId } from "react";

/**
 * 手写 SVG 面积图 —— 为一条 40px 高的曲线引 recharts 不值得。
 *
 * 用 preserveAspectRatio="none" 让 viewBox 拉伸填满容器，
 * 这样不用测量 DOM 宽度就能自适应。
 */
export function Sparkline({
  values,
  max,
  className,
}: {
  values: number[];
  /** 纵轴上限，传固定值可以让曲线高度在多次采样间保持可比 */
  max: number;
  className?: string;
}) {
  const id = useId();

  if (values.length < 2) {
    return <div className={className} aria-hidden />;
  }

  const width = 100;
  const height = 32;
  const ceiling = Math.max(max, 1);
  const step = width / (values.length - 1);

  const points = values.map((value, index) => {
    const x = index * step;
    const y = height - (Math.min(Math.max(value, 0), ceiling) / ceiling) * height;
    return [x, y] as const;
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
