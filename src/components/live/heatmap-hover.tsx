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

/** 扫过格子时不闪浮层；停稳这一下再展开。 */
const HOVER_DELAY_MS = 120;

/**
 * 悬停短暂停留后临时展开；点一下钉住，再点同一格取消。
 * 钉住时描边仍跟光标，浮层不换格。点格子外、滚动或改窗口尺寸都收起来。
 */
export function useHeatmapOpen<T extends { date: string }>() {
  const svgRef = useRef<SVGSVGElement>(null);
  const delayRef = useRef<number | null>(null);
  const [hover, setHover] = useState<T | null>(null);
  const [preview, setPreview] = useState<T | null>(null);
  const [pinned, setPinned] = useState<T | null>(null);
  const shown = pinned ?? preview;
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
      // 钉住时描边跟着光标走，但浮层不换格
      if (pinned) return;
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
  svgRef: RefObject<SVGSVGElement | null>,
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

/** 方向键在格子间怎么走：一列是连续七天，所以上下 ±1 天、左右 ±7 天（同一星期几） */
const KEY_STEP: Record<string, number> = {
  ArrowUp: -1,
  ArrowDown: 1,
  ArrowLeft: -7,
  ArrowRight: 7,
};

/**
 * 两张热力图（GitHub 贡献、年度 token）共用的 SVG 骨架。
 *
 * 从前这段在两个组件里逐字重复，键盘可达性得改两遍才生效 —— 抽到这里之后
 * 格子的 role / aria-label / 方向键漫游只有一份实现。
 *
 * 焦点用 roving tabindex：整年 365 个格子若各占一个 Tab 站，键盘用户要按
 * 三百多下才能走出图表。只有「当前格」进 Tab 序列，格子之间用方向键移动
 * （Home / End 跳到年头年尾），Enter / Space 等价于点一下（钉住浮层）。
 * 每个格子仍各自带 aria-label，读屏的虚拟光标才能逐格读到数据。
 */
export function HeatmapGrid({
  svgRef,
  weeks,
  fills,
  hotDate,
  label,
  onCellPreview,
  onCellClear,
  onCellToggle,
}: {
  svgRef: RefObject<SVGSVGElement | null>;
  weeks: GithubChartDay[][];
  /** 五档填充色。两张图色系不同，几何完全一致 */
  fills: readonly string[];
  hotDate: string | null;
  /** 整张图的可访问名 */
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
  // 数据每 6 小时换一份，记住的那天可能已经滚出窗口 —— 落回最后一天（今天）
  const marked = activeDate ? cells.findIndex((cell) => cell.day.date === activeDate) : -1;
  const activeIndex = marked >= 0 ? marked : cells.length - 1;
  const { width, height } = chartSize(weeks.length);

  const focusAt = (index: number) => {
    const cell = cells[Math.min(Math.max(index, 0), cells.length - 1)];
    if (!cell) return;
    setActiveDate(cell.day.date);
    svgRef.current
      ?.querySelector<SVGRectElement>(`[data-date="${cell.day.date}"]`)
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
    // 方向键 / Home / End 默认会滚页面，接手了就别让它再滚一次
    if (target === null) return;
    event.preventDefault();
    focusAt(target);
  };

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      shapeRendering="geometricPrecision"
      className="block h-auto w-full"
      role="group"
      aria-label={label}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse" && hoverCapable()) onCellClear();
      }}
    >
      {/* 月份和星期只是给眼睛的刻度，数据本身在每个格子的 aria-label 里 */}
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
          width={CELL}
          height={CELL}
          data-date={day.date}
          data-score={day.score}
          data-hot={hotDate === day.date ? "" : undefined}
          fill={fills[day.score]}
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

/**
 * 卡片 overflow-hidden 会裁掉格子上的浮层，所以挂到 document.body。
 */
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
    // 位置没动就保住引用，别为一次空跑多渲染一轮
    setPos((prev) =>
      prev &&
      prev.left === left &&
      prev.top === top &&
      prev.diamond === diamond &&
      prev.place === place
        ? prev
        : { left, top, diamond, place },
    );
    /*
     * 依赖里不放 children：它每次父渲染都是新对象，放进来等于没有依赖数组。
     * 内容变化带来的尺寸变化由 date / unit / value 兜住 —— children 是按同一个
     * date 派生的模型明细，date 不变内容就不变。
     */
  }, [anchor.height, anchor.left, anchor.top, anchor.width, date, unit, value]);

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
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-lg font-medium tracking-tight tabular-nums leading-none">
            {value}
          </div>
          <div className="mt-1 font-mono text-[10px] leading-none text-muted-foreground">
            {formatDayHeading(date)}
          </div>
        </div>
        <span className="label-mono text-muted-foreground">{unit}</span>
      </div>
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
