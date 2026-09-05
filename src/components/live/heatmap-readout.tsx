import type { ReactNode } from "react";

/** Details belong to the page flow, so they stay readable while scrolling. */
export function HeatmapReadout({
  date,
  value,
  unit,
  children,
}: {
  date?: string;
  value?: string;
  unit: string;
  children?: ReactNode;
}) {
  return (
    <section
      className="heatmap-readout"
      aria-label="每日明细"
      aria-live="polite"
    >
      {date ? (
        <>
          <div className="heatmap-readout-heading">
            <time dateTime={date}>{date.replaceAll("-", " / ")}</time>
            <span>
              <strong>{value}</strong>
              <small>{unit}</small>
            </span>
          </div>
          {children}
        </>
      ) : (
        <p className="heatmap-readout-hint">
          选择一天，查看当日明细。支持方向键浏览。
        </p>
      )}
    </section>
  );
}
