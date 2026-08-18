"use client";

import { useRef } from "react";

import { useStatus } from "@/hooks/use-status";
import {
  chartSize,
  dayLabels,
  monthLabels,
  scorePaths,
} from "@/lib/github-chart-compact";
import { GITHUB_CHART_PATH } from "@/lib/paths";
import type { GithubChartPayload, StatusResponse } from "@/lib/types";

/** 和续播列表同一档：内容不会按秒变质，十分钟来问一次就够 */
const REFRESH_MS = 10 * 60_000;

export function GithubChart({ fallback }: { fallback: StatusResponse<GithubChartPayload> }) {
  const { data } = useStatus<GithubChartPayload>(GITHUB_CHART_PATH, REFRESH_MS, {
    fallback,
    // 日历不会自己过期，首屏那份就能先画；十分钟后的轮询再追上新提交
    revalidateOnMount: false,
  });
  const last = useRef(fallback.ok ? fallback.data : null);
  if (data?.weeks.length) last.current = data;
  const weeks = data?.weeks ?? last.current?.weeks;

  if (!weeks?.length) return null;

  const { width, height } = chartSize(weeks.length);

  return (
    <div className="github-chart w-full">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${width} ${height}`}
        shapeRendering="geometricPrecision"
        className="block h-auto w-full"
      >
        {monthLabels(weeks).map((label) => (
          <text
            key={`m-${label.text}-${label.x}`}
            x={label.x}
            y={label.y}
            fontSize={label.fontSize}
            display={label.hidden ? "none" : undefined}
          >
            {label.text}
          </text>
        ))}
        {dayLabels().map((label) => (
          <text
            key={`d-${label.text}`}
            x={label.x}
            y={label.y}
            fontSize={label.fontSize}
            display={label.hidden ? "none" : undefined}
          >
            {label.text}
          </text>
        ))}
        {scorePaths(weeks).map((path) => (
          <path key={path.score} d={path.d} data-score={path.score} fill={path.fill} />
        ))}
      </svg>
    </div>
  );
}
