import { Fragment, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";

import { Heading } from "@/components/chat-visual/ink";
import { formatVisualNumber, niceTicks } from "@/lib/chat-visuals";
import { cn } from "@/lib/utils";
import type { ChartVisual } from "@shared/god-chat";

// 顺序经 dataviz 校验器在亮暗两种底色上验过（相邻两色在色弱下仍可分、对底色对比度 ≥3:1）；重排或换色要重新跑校验。
const SERIES_COLORS = ["var(--signal-blue)", "var(--signal-orange)", "var(--signal-violet)", "var(--signal-green)"];
function Legend({ visual }: { visual: ChartVisual }) {
  if (visual.series.length < 2) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {visual.series.map((series, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <span className={visual.type === "line" ? "h-0.5 w-3" : "size-2"} style={{ background: SERIES_COLORS[i] }} />
          {series.name}
        </span>
      ))}
    </div>
  );
}

function DataTable({ visual }: { visual: ChartVisual }) {
  return (
    <table className="sr-only">
      {visual.title && <caption>{visual.title}</caption>}
      <thead>
        <tr>
          <th scope="col">Label</th>
          {visual.series.map((series, i) => (
            <th key={i} scope="col">{series.name}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {visual.labels.map((label, i) => (
          <tr key={i}>
            <th scope="row">{label}</th>
            {visual.series.map((series, j) => (
              <td key={j}>{series.values[i] === undefined ? "—" : formatVisualNumber(series.values[i], visual.unit)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Chart({ visual }: { visual: ChartVisual }) {
  return (
    <figure>
      <Heading title={visual.title} subtitle={visual.subtitle} />
      <Legend visual={visual} />
      {visual.type === "bar" ? <Bars visual={visual} /> : <Plot visual={visual} />}
      <DataTable visual={visual} />
    </figure>
  );
}

function Bars({ visual }: { visual: ChartVisual }) {
  const max = Math.max(0, ...visual.series.flatMap((series) => series.values)) || 1;
  const thick = visual.series.length === 1 ? "h-3" : "h-2";
  return (
    <div aria-hidden className="grid grid-cols-[minmax(0,max-content)_1fr] items-center gap-x-3 gap-y-2 text-xs">
      {visual.labels.map((label, i) => (
        <Fragment key={i}>
          <div className="max-w-[12rem] truncate" title={label}>{label}</div>
          <div className="space-y-0.5">
            {visual.series.map((series, j) => series.values[i] !== undefined && (
              <div key={j} className="flex items-center gap-2">
                <div className={cn("shrink-0", thick)} style={{ width: `max(2px, calc((100% - 4.5rem) * ${series.values[i] / max}))`, background: SERIES_COLORS[j] }} />
                <span className="shrink-0 text-muted-foreground tabular-nums">{formatVisualNumber(series.values[i], visual.unit, true)}</span>
              </div>
            ))}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

const PLOT_HEIGHT = 180;
const PLOT_TOP = 8;
const AXIS_HEIGHT = 20;
const TICK_CHAR_PX = 6.2;
const textWidth = (text: string) => [...text].reduce((sum, char) => sum + (char.charCodeAt(0) > 0x2e7f ? 2 : 1), 0) * TICK_CHAR_PX;
const MIN_LABEL_GAP_PX = 52;
const BAR_MAX_PX = 24;
const BAR_GAP_PX = 2;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const clip = (label: string, max: number) => (label.length > max ? `${label.slice(0, Math.max(1, max - 1))}…` : label);

function Plot({ visual }: { visual: ChartVisual }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const { labels, series, unit } = visual;
  const values = series.flatMap((s) => s.values);
  const ticks = values.length ? niceTicks(Math.min(...values), Math.max(...values)) : niceTicks(0, 0);
  const low = ticks[0];
  const high = ticks[ticks.length - 1];
  const tickText = ticks.map((tick) => formatVisualNumber(tick, unit, true));
  const left = Math.ceil(Math.max(...tickText.map(textWidth))) + 8;
  const right = width - 8;
  const bottom = PLOT_HEIGHT - AXIS_HEIGHT;
  const plotWidth = Math.max(1, right - left);
  const y = (v: number) => bottom - ((v - low) / (high - low)) * (bottom - PLOT_TOP);
  const line = visual.type === "line";
  const slot = plotWidth / labels.length;
  const x = (i: number) => (line ? left + 4 + (i * (plotWidth - 8)) / Math.max(1, labels.length - 1) : left + slot * (i + 0.5));
  const every = Math.max(1, Math.ceil(labels.length / Math.max(1, Math.floor(plotWidth / MIN_LABEL_GAP_PX))));
  const labelChars = Math.max(3, Math.floor((every * (line ? plotWidth / Math.max(1, labels.length - 1) : slot)) / TICK_CHAR_PX) - 1);
  const group = Math.min(slot * 0.7, series.length * BAR_MAX_PX + (series.length - 1) * BAR_GAP_PX);
  const bar = (group - (series.length - 1) * BAR_GAP_PX) / series.length;

  const pick = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - box.left + left;
    const index = line ? Math.round(((px - left - 4) / (plotWidth - 8)) * (labels.length - 1)) : Math.floor((px - left) / slot);
    setActive(Math.min(labels.length - 1, Math.max(0, index)));
  };

  const tipX = active === null ? 0 : x(active);
  const tipStyle: CSSProperties = {
    left: tipX,
    transform: tipX < width * 0.3 ? "translateX(-12px)" : tipX > width * 0.7 ? "translateX(calc(-100% + 12px))" : "translateX(-50%)",
  };

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={PLOT_HEIGHT} role="img" aria-label={visual.title ?? "Chart"} className="block overflow-visible font-mono text-[10px]">
          {ticks.map((tick, i) => (
            <g key={tick}>
              <line x1={left} x2={right} y1={y(tick)} y2={y(tick)} stroke="var(--line)" shapeRendering="crispEdges" />
              <text x={left - 6} y={y(tick)} dy="0.32em" textAnchor="end" fill="var(--muted-foreground)">{tickText[i]}</text>
            </g>
          ))}
          {labels.map((label, i) =>
            i % every === 0 ? (
              <text key={i} x={x(i)} y={PLOT_HEIGHT - 4} textAnchor={line && i === 0 ? "start" : line && i === labels.length - 1 ? "end" : "middle"} fill="var(--muted-foreground)">
                {clip(label, labelChars)}
              </text>
            ) : null,
          )}
          {!line && active !== null && <rect x={left + slot * active} y={PLOT_TOP} width={slot} height={bottom - PLOT_TOP} fill="var(--foreground)" opacity={0.05} />}
          {!line &&
            series.map((s, j) =>
              s.values.map((v, i) => (
                <rect key={`${j}-${i}`} x={x(i) - group / 2 + j * (bar + BAR_GAP_PX)} y={y(v)} width={bar} height={Math.max(v > 0 ? 1 : 0, y(0) - y(v))} fill={SERIES_COLORS[j]} />
              )),
            )}
          {line && active !== null && <line x1={x(active)} x2={x(active)} y1={PLOT_TOP} y2={bottom} stroke="var(--line-strong)" shapeRendering="crispEdges" />}
          {line &&
            series.map((s, j) => (
              <g key={j}>
                <polyline points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={SERIES_COLORS[j]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {(active === null ? [s.values.length - 1] : [active]).filter((i) => s.values[i] !== undefined).map((i) => (
                  <circle key={i} cx={x(i)} cy={y(s.values[i])} r={4} fill={SERIES_COLORS[j]} stroke="var(--background)" strokeWidth={2} />
                ))}
              </g>
            ))}
          <rect
            x={left}
            y={0}
            width={plotWidth}
            height={PLOT_HEIGHT}
            fill="transparent"
            className="touch-pan-y"
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
      )}
      {!width && <div style={{ height: PLOT_HEIGHT }} />}
      {active !== null && (
        <div aria-hidden className="pointer-events-none absolute top-0 z-10 w-max max-w-full border border-line-strong bg-surface px-2.5 py-1.5 text-xs shadow-lg" style={tipStyle}>
          <div className="mb-1 font-semibold">{labels[active]}</div>
          {series.map((s, j) => (
            <div key={j} className="flex items-center gap-2">
              <span className="h-0.5 w-3 shrink-0" style={{ background: SERIES_COLORS[j] }} />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.name}</span>
              <span className="pl-2 font-semibold tabular-nums">{s.values[active] === undefined ? "—" : formatVisualNumber(s.values[active], unit)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
