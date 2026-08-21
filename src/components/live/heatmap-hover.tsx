"use client";

import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { formatDayHeading } from "@/lib/github-chart-compact";

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
    const place = above >= pad ? "above" : "below";
    const top = place === "above" ? above : anchor.top + anchor.height + gap;
    const diamond = Math.min(Math.max(10, center - left), width - 10);
    setPos({ left, top, diamond, place });
  }, [anchor.height, anchor.left, anchor.top, anchor.width, children, date, unit, value]);

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
