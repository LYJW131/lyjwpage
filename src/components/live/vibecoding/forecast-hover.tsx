"use client";

import { type ReactNode, useCallback, useRef, useState } from "react";

import { AnchoredTooltip, cellAnchor, type CellAnchor, useHoverDismiss } from "@/components/live/heatmap-hover";
import { sampleForecast, type LimitForecast } from "@/lib/limit-forecast";
import { cn } from "@/lib/utils";

const HOUR_MS = 3_600_000;
const STEP_MS = 15 * 60_000;
const KEY_STEP_MS = 3 * HOUR_MS;
// 指针离「现在」或用完点不到这么远（占整周宽度）就吸过去，两处是最常想看的读数。
const SNAP_FRACTION = 0.015;

function formatHours(ms: number) {
  const hours = Math.max(0, Math.round(ms / HOUR_MS));
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  if (!days) return `${rest}h`;
  return rest ? `${days}d\u00a0${rest}h` : `${days}d`;
}

function Swatch({ className, dotted }: { className: string; dotted?: boolean }) {
  return <span aria-hidden className={cn("inline-block w-3 shrink-0 border-t-2", dotted ? "border-dotted" : "border-dashed", className)} />;
}

function Row({ swatch, label, value }: { swatch: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      {swatch}
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto tabular-nums">{value}</span>
    </div>
  );
}

const percent = (value: number) => `${Math.round(value)}%`;

export function ForecastHover({
  forecast,
  timeZone,
  x,
  y,
}: {
  forecast: LimitForecast;
  timeZone: string | undefined;
  x: (at: number) => number;
  y: (percent: number) => number;
}) {
  const [at, setAt] = useState<number | null>(null);
  const [bounds, setBounds] = useState<CellAnchor | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setAt(null), []);
  useHoverDismiss(buttonRef, at != null, close);
  const span = forecast.resetAt - forecast.startAt;
  const inWindow = (value: number | null): value is number => value != null && value >= forecast.startAt && value <= forecast.resetAt;
  const clamp = (value: number) => Math.min(forecast.resetAt, Math.max(forecast.startAt, value));

  const selectAt = (clientX: number, target: HTMLButtonElement) => {
    const rect = cellAnchor(target);
    setBounds(rect);
    const raw = forecast.startAt + ((clientX - rect.left) / rect.width) * span;
    const snap = [forecast.now, forecast.runOutAt]
      .filter((mark): mark is number => mark != null && Math.abs(mark - raw) < span * SNAP_FRACTION)
      .sort((left, right) => Math.abs(left - raw) - Math.abs(right - raw))[0];
    setAt(snap ?? clamp(forecast.startAt + Math.round((raw - forecast.startAt) / STEP_MS) * STEP_MS));
  };

  const sample = inWindow(at) ? sampleForecast(forecast, at) : null;
  const value = sample == null ? null : sample.phase === "locked" ? 100 : sample.percent ?? sample.target ?? sample.even;
  const clock = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone });

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="absolute inset-0 cursor-crosshair touch-pan-y focus-visible:outline-1 focus-visible:outline-live"
        aria-label="Weekly limit forecast. Use arrow keys to inspect the week."
        onPointerMove={(event) => selectAt(event.clientX, event.currentTarget)}
        onPointerLeave={(event) => { if (event.pointerType === "mouse") setAt(null); }}
        onFocus={(event) => { setBounds(cellAnchor(event.currentTarget)); setAt((current) => (inWindow(current) ? current : forecast.now)); }}
        onBlur={() => setAt(null)}
        onClick={(event) => {
          if (event.detail === 0) {
            setBounds(cellAnchor(event.currentTarget));
            setAt((current) => (inWindow(current) ? current : forecast.now));
          } else selectAt(event.clientX, event.currentTarget);
        }}
        onKeyDown={(event) => {
          setBounds(cellAnchor(event.currentTarget));
          if (event.key === "Escape") setAt(null);
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            const step = event.key === "ArrowLeft" ? -KEY_STEP_MS : KEY_STEP_MS;
            setAt((current) => clamp((inWindow(current) ? current : forecast.now) + step));
          }
        }}
      />
      {sample && value != null && (
        <>
          <span aria-hidden className="pointer-events-none absolute inset-y-0 border-l border-line-strong" style={{ left: `${x(sample.at)}%` }} />
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface",
              sample.phase === "locked" ? "bg-signal-red" : sample.phase === "projected" && sample.percent == null ? "bg-signal-green" : "bg-foreground",
            )}
            style={{ left: `${x(sample.at)}%`, top: `${y(value)}%` }}
          />
        </>
      )}
      {sample && value != null && bounds && (
        <AnchoredTooltip
          contentKey={`${sample.at}`}
          anchor={{
            left: bounds.left + (x(sample.at) / 100) * bounds.width - 1,
            top: bounds.top + (y(value) / 100) * bounds.height - 4,
            width: 2,
            height: 8,
          }}
        >
          <div className="grid gap-1 text-xs">
            <div className="font-mono text-muted-foreground">
              {sample.at === forecast.now ? "Now · " : ""}{clock.format(sample.at)}
            </div>
            {sample.phase === "locked" ? (
              <div className="grid gap-0.5">
                <div className="font-medium text-signal-red">Locked</div>
                <Row swatch={<Swatch className="border-signal-red" />} label="Since" value={clock.format(forecast.runOutAt!)} />
                <Row swatch={<Swatch className="border-transparent" />} label="Resets in" value={formatHours(forecast.resetAt - sample.at)} />
              </div>
            ) : (
              <div className="grid gap-0.5">
                <div className="font-medium">
                  {sample.percent == null ? "No forecast yet" : `${percent(sample.percent)} ${sample.phase === "used" ? "used" : "projected"}`}
                </div>
                {sample.target != null && <Row swatch={<Swatch className="border-signal-green" />} label="Lasts the week" value={percent(sample.target)} />}
                <Row swatch={<Swatch dotted className="border-muted-foreground" />} label="Even pace" value={percent(sample.even)} />
              </div>
            )}
          </div>
        </AnchoredTooltip>
      )}
    </>
  );
}
