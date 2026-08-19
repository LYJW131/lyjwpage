"use client";

import { useState } from "react";

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
  /**
   * 留住上一份画得出来的日历，轮询在飞的时候别让图表闪空。
   *
   * 降级信封（ok:false）是一次成功的请求，SWR 照样把它写进缓存 ——
   * keepPreviousData 只在换键时兜底，兜不住这条；useStatus 再把它翻成
   * data: undefined，于是图表整块消失，要等下一轮才回来。
   *
   * 渲染期直接调整 state，不用 ref 也不放 useEffect：ref 在渲染期读写是
   * React 明令禁止的（写了也不保证重渲染），effect 要多渲染一轮、中间那帧
   * 照样是空的。
   */
  const [lastDrawn, setLastDrawn] = useState(fallback.ok ? fallback.data : null);
  if (data?.weeks.length && data !== lastDrawn) setLastDrawn(data);
  const weeks = data?.weeks ?? lastDrawn?.weeks;

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
