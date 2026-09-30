"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  LEFT,
  STEP,
  TOP,
  chartSize,
  dayLabels,
  formatDayHeading,
  monthLabels,
} from "@/lib/github-chart-compact";
import type { GithubChartDay } from "@/lib/types";

export type CellAnchor = { left: number; top: number; width: number; height: number };

export function cellAnchor(target: Element): CellAnchor {
  const rect = target.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

export function hoverCapable() {
  return window.matchMedia("(hover: hover)").matches;
}

const HOVER_DELAY_MS = 120;

export function useHeatmapOpen<T extends { date: string }>() {
  const svgRef = useRef<SVGSVGElement>(null);
  const delayRef = useRef<number | null>(null);
  const [hover, setHover] = useState<T | null>(null);
  const [preview, setPreview] = useState<T | null>(null);
  const previewRef = useRef<T | null>(null);
  const [pinned, setPinned] = useState<T | null>(null);
  const shown = pinned ?? preview;
  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);
  const hotDate = hover?.date ?? pinned?.date ?? null;

  const clearDelay = useCallback(() => {
    if (delayRef.current == null) return;
    window.clearTimeout(delayRef.current);
    delayRef.current = null;
  }, []);

  const close = useCallback(() => {
    clearDelay();
    setHover(null);
    setPreview(null);
    setPinned(null);
  }, [clearDelay]);

  useHoverDismiss(svgRef, shown != null || hover != null, close);

  useEffect(() => () => clearDelay(), [clearDelay]);

  const previewCell = useCallback(
    (cell: T) => {
      setHover(cell);
      if (pinned) return;
      // 点击先触发 focus 再触发 click；同格不能先收起，否则浮层会闪一下。
      if (previewRef.current?.date === cell.date) return;
      clearDelay();
      setPreview(null);
      delayRef.current = window.setTimeout(() => {
        setPreview(cell);
        delayRef.current = null;
      }, HOVER_DELAY_MS);
    },
    [clearDelay, pinned],
  );

  const clearPreview = useCallback(() => {
    clearDelay();
    setHover(null);
    setPreview(null);
  }, [clearDelay]);

  const togglePin = useCallback(
    (cell: T) => {
      clearDelay();
      setHover(cell);
      setPreview(cell);
      setPinned((current) => (current?.date === cell.date ? null : cell));
    },
    [clearDelay],
  );

  return { svgRef, shown, hotDate, pinned, previewCell, clearPreview, togglePin };
}

export function useHoverDismiss(
  svgRef: RefObject<Element | null>,
  active: boolean,
  hide: () => void,
) {
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      if (svgRef.current?.contains(event.target as Node)) return;
      hide();
    };
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [active, hide, svgRef]);
}

const KEY_STEP: Record<string, number> = {
  ArrowUp: -1,
  ArrowDown: 1,
  ArrowLeft: -7,
  ArrowRight: 7,
};

export function HeatmapGrid({
  svgRef,
  weeks,
  hotDate,
  label,
  onCellPreview,
  onCellClear,
  onCellToggle,
}: {
  svgRef: RefObject<SVGSVGElement | null>;
  weeks: GithubChartDay[][];
  hotDate: string | null;
  label: string;
  onCellPreview: (day: GithubChartDay, target: Element) => void;
  onCellClear: () => void;
  onCellToggle: (day: GithubChartDay, target: Element) => void;
}) {
  const cells = useMemo(
    () => weeks.flatMap((week, weekIndex) => week.map((day) => ({ day, weekIndex }))),
    [weeks],
  );
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const marked = activeDate ? cells.findIndex((cell) => cell.day.date === activeDate) : -1;
  const activeIndex = marked >= 0 ? marked : cells.length - 1;
  const { width, height } = chartSize(weeks.length);

  const focusAt = (index: number) => {
    const cell = cells[Math.min(Math.max(index, 0), cells.length - 1)];
    if (!cell) return;
    setActiveDate(cell.day.date);
    svgRef.current
      ?.querySelectorAll<SVGRectElement>("rect[data-score]")
      .item(index)
      ?.focus();
  };

  const onCellKeyDown = (event: ReactKeyboardEvent<SVGRectElement>, index: number) => {
    const day = cells[index]?.day;
    if (!day) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onCellToggle(day, event.currentTarget);
      return;
    }
    const step = KEY_STEP[event.key];
    let target: number | null = null;
    if (event.key === "Home") target = 0;
    else if (event.key === "End") target = cells.length - 1;
    else if (step !== undefined) target = index + step;
    if (target === null) return;
    event.preventDefault();
    focusAt(target);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      shapeRendering="geometricPrecision"
      className="block h-auto w-full"
      role="group"
      aria-label={label}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse" && hoverCapable()) onCellClear();
      }}
    >
      {monthLabels(weeks).map((item) => (
        <text
          key={`m-${item.text}-${item.x}`}
          x={item.x}
          y={item.y}
          fontSize={item.fontSize}
          display={item.hidden ? "none" : undefined}
          aria-hidden
        >
          {item.text}
        </text>
      ))}
      {dayLabels().map((item) => (
        <text
          key={`d-${item.text}`}
          x={item.x}
          y={item.y}
          fontSize={item.fontSize}
          display={item.hidden ? "none" : undefined}
          aria-hidden
        >
          {item.text}
        </text>
      ))}
      {cells.map(({ day, weekIndex }, index) => (
        <rect
          key={day.date}
          x={LEFT + weekIndex * STEP}
          y={TOP + day.weekday * STEP}
          data-score={day.score}
          data-hot={hotDate === day.date ? "" : undefined}
          role="button"
          aria-label={day.label}
          tabIndex={index === activeIndex ? 0 : -1}
          onFocus={(event) => {
            onCellPreview(day, event.currentTarget);
          }}
          onBlur={() => {
            onCellClear();
          }}
          onKeyDown={(event) => {
            onCellKeyDown(event, index);
          }}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse" && hoverCapable()) {
              onCellPreview(day, event.currentTarget);
            }
          }}
          onClick={(event) => {
            onCellToggle(day, event.currentTarget);
          }}
        />
      ))}
    </svg>
  );
}

export function HeatmapTooltip({
  date,
  value,
  unit,
  anchor,
  children,
}: {
  date: string;
  value: string;
  unit: string;
  anchor: CellAnchor;
  children?: ReactNode;
}) {
  return (
    <AnchoredTooltip anchor={anchor} contentKey={`${date}:${unit}:${value}`}>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-lg font-medium tracking-tight tabular-nums leading-none">{value}</div>
          <div className="mt-1 font-mono text-[10px] leading-none text-muted-foreground">{formatDayHeading(date)}</div>
        </div>
        <span className="label-mono text-muted-foreground">{unit}</span>
      </div>
      {children}
    </AnchoredTooltip>
  );
}

export function AnchoredTooltip({ anchor, contentKey, children }: {
  anchor: CellAnchor;
  contentKey: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    diamond: number;
    place: "above" | "below";
  } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const gap = 8;
    const pad = 8;
    const center = anchor.left + anchor.width / 2;
    const left = Math.min(
      Math.max(pad, center - width / 2),
      window.innerWidth - width - pad,
    );
    const above = anchor.top - height - gap;
    const place: "above" | "below" = above >= pad ? "above" : "below";
    const top = place === "above" ? above : anchor.top + anchor.height + gap;
    const diamond = Math.min(Math.max(10, center - left), width - 10);
    setPos((prev) =>
      prev &&
      prev.left === left &&
      prev.top === top &&
      prev.diamond === diamond &&
      prev.place === place
        ? prev
        : { left, top, diamond, place },
    );
  }, [anchor.height, anchor.left, anchor.top, anchor.width, contentKey]);

  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className="paper-card pointer-events-none fixed z-[60] w-44 overflow-hidden border border-line-strong bg-surface px-2 py-1.5"
      style={
        pos
          ? { left: pos.left, top: pos.top }
          : { left: 0, top: 0, visibility: "hidden" }
      }
    >
      {children}
      {pos && (
        <span
          aria-hidden
          className={
            pos.place === "above"
              ? "absolute size-1.5 rotate-45 border-r border-b border-line-strong bg-surface"
              : "absolute size-1.5 rotate-45 border-l border-t border-line-strong bg-surface"
          }
          style={{
            left: pos.diamond - 3,
            ...(pos.place === "above" ? { bottom: -3 } : { top: -3 }),
          }}
        />
      )}
    </div>,
    document.body,
  );
}
