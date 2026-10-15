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
  CELL,
  LEFT,
  STEP,
  TOP,
  chartSize,
  dayLabels,
  formatDayHeading,
  monthLabels,
} from "@shared/github-chart-compact";
import type { GithubChartDay } from "@shared/types";

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

  const pinCell = useCallback(
    (cell: T) => {
      clearDelay();
      setHover(cell);
      setPreview(cell);
      setPinned(cell);
    },
    [clearDelay],
  );

  return { svgRef, shown, hotDate, pinned, previewCell, clearPreview, togglePin, pinCell };
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

// 触屏点按之后浏览器还会补发 focus 与 click，落在手指下那一格而非吸附到的格子，需在此窗口内忽略。
const TOUCH_GHOST_MS = 800;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function HeatmapGrid({
  svgRef,
  weeks,
  hotDate,
  label,
  onCellPreview,
  onCellClear,
  onCellToggle,
  onCellPin,
}: {
  svgRef: RefObject<SVGSVGElement | null>;
  weeks: GithubChartDay[][];
  hotDate: string | null;
  label: string;
  onCellPreview: (day: GithubChartDay, anchor: CellAnchor) => void;
  onCellClear: () => void;
  onCellToggle: (day: GithubChartDay, anchor: CellAnchor) => void;
  onCellPin: (day: GithubChartDay, anchor: CellAnchor) => void;
}) {
  const cells = useMemo(
    () =>
      weeks.flatMap((week, weekIndex) =>
        week.map((day) => ({ day, x: LEFT + weekIndex * STEP, y: TOP + day.weekday * STEP })),
      ),
    [weeks],
  );
  // 逐格一个 <rect> 会让首页 DOM 膨胀；同档的格子并成一条 path，
  // 可交互的只剩键盘游标与高亮两个 <rect>，鼠标与触屏按坐标反算格子。
  const paths = useMemo(() => {
    const byScore = new Map<number, string>();
    for (const { day, x, y } of cells) {
      byScore.set(day.score, `${byScore.get(day.score) ?? ""}M${x} ${y}h${CELL}v${CELL}h-${CELL}z`);
    }
    return [...byScore].sort(([a], [b]) => a - b);
  }, [cells]);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const marked = activeDate ? cells.findIndex((cell) => cell.day.date === activeDate) : -1;
  const activeIndex = marked >= 0 ? marked : cells.length - 1;
  const active = cells[activeIndex];
  const hot = hotDate ? cells.find((cell) => cell.day.date === hotDate) : undefined;
  const { width, height } = chartSize(weeks.length);
  const cursorRef = useRef<SVGRectElement>(null);
  const refocusRef = useRef(false);
  const hoverRef = useRef(-1);
  const scrubRef = useRef<{ pointerId: number; date: string | null } | null>(null);
  const touchAtRef = useRef(0);

  useLayoutEffect(() => {
    if (!refocusRef.current) return;
    refocusRef.current = false;
    cursorRef.current?.focus();
  }, [activeDate]);

  const touchGhost = (event: { timeStamp: number }) =>
    event.timeStamp - touchAtRef.current < TOUCH_GHOST_MS;

  const anchorAt = (index: number): CellAnchor | null => {
    const cell = cells[index];
    const box = svgRef.current?.getBoundingClientRect();
    if (!cell || !box || box.width <= 0) return null;
    const scale = box.width / width;
    return {
      left: box.left + cell.x * scale,
      top: box.top + cell.y * scale,
      width: CELL * scale,
      height: CELL * scale,
    };
  };

  const cellAt = (clientX: number, clientY: number, exact: boolean) => {
    const svg = svgRef.current;
    if (!svg || weeks.length === 0) return -1;
    const box = svg.getBoundingClientRect();
    if (box.width <= 0) return -1;
    const scale = width / box.width;
    const x = (clientX - box.left) * scale - LEFT;
    const y = (clientY - box.top) * scale - TOP;
    if (exact) {
      const weekIndex = Math.floor(x / STEP);
      const weekday = Math.floor(y / STEP);
      if (x - weekIndex * STEP >= CELL || y - weekday * STEP >= CELL) return -1;
      const date = weeks[weekIndex]?.find((day) => day.weekday === weekday)?.date;
      return date ? cells.findIndex((cell) => cell.day.date === date) : -1;
    }
    const gutter = (STEP - CELL) / 2;
    const weekIndex = clamp(Math.floor((x + gutter) / STEP), 0, weeks.length - 1);
    const weekday = clamp(Math.floor((y + gutter) / STEP), 0, 6);
    const week = weeks[weekIndex] ?? [];
    let best: GithubChartDay | null = null;
    for (const day of week) {
      if (!best || Math.abs(day.weekday - weekday) < Math.abs(best.weekday - weekday)) best = day;
    }
    return best ? cells.findIndex((cell) => cell.day.date === best.date) : -1;
  };

  const scrubTo = (clientX: number, clientY: number) => {
    const scrub = scrubRef.current;
    const index = cellAt(clientX, clientY, false);
    const day = cells[index]?.day;
    const anchor = anchorAt(index);
    if (!scrub || !day || !anchor || scrub.date === day.date) return;
    scrub.date = day.date;
    setActiveDate(day.date);
    onCellPin(day, anchor);
  };

  const onKeyDown = (event: ReactKeyboardEvent<SVGRectElement>) => {
    const day = active?.day;
    const anchor = anchorAt(activeIndex);
    if (!day || !anchor) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onCellToggle(day, anchor);
      return;
    }
    const step = KEY_STEP[event.key];
    let target: number | null = null;
    if (event.key === "Home") target = 0;
    else if (event.key === "End") target = cells.length - 1;
    else if (step !== undefined) target = activeIndex + step;
    if (target === null) return;
    event.preventDefault();
    const next = cells[clamp(target, 0, cells.length - 1)];
    if (!next || next.day.date === day.date) return;
    refocusRef.current = true;
    setActiveDate(next.day.date);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      shapeRendering="geometricPrecision"
      className="block h-auto w-full"
      role="group"
      aria-label={label}
      onPointerMove={(event) => {
        if (scrubRef.current?.pointerId === event.pointerId) {
          touchAtRef.current = event.timeStamp;
          scrubTo(event.clientX, event.clientY);
          return;
        }
        if (event.pointerType !== "mouse" || !hoverCapable()) return;
        const index = cellAt(event.clientX, event.clientY, true);
        const day = cells[index]?.day;
        const anchor = anchorAt(index);
        if (!day || !anchor || index === hoverRef.current) return;
        hoverRef.current = index;
        onCellPreview(day, anchor);
      }}
      onPointerLeave={(event) => {
        hoverRef.current = -1;
        if (event.pointerType === "mouse" && hoverCapable()) onCellClear();
      }}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse") return;
        touchAtRef.current = event.timeStamp;
        scrubRef.current = { pointerId: event.pointerId, date: null };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUp={(event) => {
        if (scrubRef.current?.pointerId !== event.pointerId) return;
        touchAtRef.current = event.timeStamp;
        scrubTo(event.clientX, event.clientY);
        scrubRef.current = null;
      }}
      onPointerCancel={() => {
        scrubRef.current = null;
      }}
      onClick={(event) => {
        if (touchGhost(event)) return;
        // 辅助技术激活游标时发出的 click 没有指针坐标（detail 为 0），按游标所在格处理。
        const index =
          event.detail === 0 && event.target === cursorRef.current
            ? activeIndex
            : cellAt(event.clientX, event.clientY, true);
        const day = cells[index]?.day;
        const anchor = anchorAt(index);
        if (!day || !anchor) return;
        onCellToggle(day, anchor);
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
      {paths.map(([score, d]) => (
        <path key={score} data-score={score} d={d} aria-hidden />
      ))}
      {active && (
        <rect
          key={active.day.date}
          ref={cursorRef}
          x={active.x}
          y={active.y}
          data-hot={hot === active ? "" : undefined}
          role="button"
          aria-label={active.day.label}
          tabIndex={0}
          onFocus={(event) => {
            const anchor = anchorAt(activeIndex);
            if (touchGhost(event) || !anchor) return;
            onCellPreview(active.day, anchor);
          }}
          onBlur={() => {
            onCellClear();
          }}
          onKeyDown={onKeyDown}
        />
      )}
      {hot && hot !== active && (
        <rect x={hot.x} y={hot.y} data-hot="" pointerEvents="none" aria-hidden />
      )}
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
          <div className="mt-1 font-mono text-2xs leading-none text-muted-foreground">{formatDayHeading(date)}</div>
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
