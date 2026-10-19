"use client";

import { useCallback, useRef, useState } from "react";

import { AnchoredTooltip, cellAnchor, type CellAnchor, useHoverDismiss } from "@/components/live/heatmap-hover";
import { LANE_HEIGHT, LANE_WIDTH, type LaneModel, type Range } from "@/components/live/pulse/lane-geometry";

export function LaneView({ label, model, range }: { label: string; model: LaneModel; range: Range }) {
  const { items } = model;
  const [selected, setSelected] = useState<number | null>(null);
  const [bounds, setBounds] = useState<CellAnchor | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setSelected(null), []);
  useHoverDismiss(buttonRef, selected != null, close);
  const active = selected == null ? null : items[selected];
  const selectAt = (clientX: number, target: HTMLButtonElement) => {
    const rect = cellAnchor(target);
    setBounds(rect);
    const at = range.from + (clientX - rect.left) / rect.width * (range.to - range.from);
    let best = -1;
    items.forEach((item, index) => {
      if (at >= item.from && at < item.to && (best < 0 || item.rank < items[best].rank)) best = index;
    });
    setSelected(best >= 0 ? best : null);
  };
  return (
    <div className="relative min-w-0">
      {model.under && <div className="pointer-events-none absolute inset-0 overflow-hidden">{model.under}</div>}
      <button
        ref={buttonRef}
        type="button"
        className="relative block w-full cursor-crosshair rounded-sm focus-visible:outline-1 focus-visible:outline-live"
        aria-label={`${label}: ${model.aria}. Use arrow keys to inspect intervals.`}
        onPointerMove={(event) => selectAt(event.clientX, event.currentTarget)}
        onPointerLeave={(event) => { if (event.pointerType === "mouse") setSelected(null); }}
        onFocus={(event) => { setBounds(cellAnchor(event.currentTarget)); setSelected((value) => value ?? (items.length ? items.length - 1 : null)); }}
        onBlur={() => setSelected(null)}
        onClick={(event) => {
          setBounds(cellAnchor(event.currentTarget));
          if (event.detail === 0) setSelected((value) => value ?? (items.length ? items.length - 1 : null));
          else selectAt(event.clientX, event.currentTarget);
        }}
        onKeyDown={(event) => {
          setBounds(cellAnchor(event.currentTarget));
          if (event.key === "Escape") setSelected(null);
          if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && items.length) {
            event.preventDefault();
            setSelected((value) => Math.max(0, Math.min(items.length - 1, (value ?? items.length - 1) + (event.key === "ArrowLeft" ? -1 : 1))));
          }
        }}
      >
        <svg viewBox={`0 0 ${LANE_WIDTH} ${LANE_HEIGHT}`} preserveAspectRatio="none" className="h-8 w-full sm:h-6" aria-hidden>
          <line x1="0" y1={LANE_HEIGHT - 0.5} x2={LANE_WIDTH} y2={LANE_HEIGHT - 0.5} stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          {model.svg}
        </svg>
      </button>
      {model.over && <div className="pointer-events-none absolute inset-0 overflow-hidden">{model.over}</div>}
      {active && bounds && (
        <AnchoredTooltip
          contentKey={`${active.from}:${active.to}:${active.rank}`}
          anchor={(() => {
            const from = Math.max(range.from, active.from);
            const to = Math.min(range.to, active.to);
            return { left: bounds.left + (from - range.from) / (range.to - range.from) * bounds.width,
              width: Math.max(2, (to - from) / (range.to - range.from) * bounds.width), top: bounds.top, height: bounds.height };
          })()}
        >
          {active.content}
        </AnchoredTooltip>
      )}
    </div>
  );
}
