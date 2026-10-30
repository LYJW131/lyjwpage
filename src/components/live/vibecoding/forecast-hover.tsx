"use client";

import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";

import { AnchoredTooltip, cellAnchor, type CellAnchor, useHoverDismiss } from "@/components/live/heatmap-hover";
import { sampleForecast, type LimitForecast } from "@/lib/limit-forecast";
import { cn } from "@/lib/utils";

const HOUR_MS = 3_600_000;
const STEP_MS = 15 * 60_000;
const KEY_STEP_MS = 3 * HOUR_MS;
// 指针离起点、现在、用完点或重置点不到这么远（占整周宽度）就吸过去，这几处是最常想看的读数。
const SNAP_FRACTION = 0.015;

function formatHours(ms: number) {
  const hours = Math.max(0, Math.round(ms / HOUR_MS));
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  if (!days) return `${rest}h`;
  return rest ? `${days}d\u00a0${rest}h` : `${days}d`;
}

const LINE = { solid: "border-solid", dashed: "border-dashed", dotted: "border-dotted" } as const;

function Swatch({ className, line }: { className: string; line: keyof typeof LINE }) {
  return <span aria-hidden className={cn("inline-block w-3 shrink-0 border-t-2", LINE[line], className)} />;
}

function Row({ swatch, label, value, strong }: { swatch: ReactNode; label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      {swatch}
      <span className={strong ? "font-medium" : "text-muted-foreground"}>{label}</span>
      <span className={cn("ml-auto tabular-nums", strong && "font-medium")}>{value}</span>
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
  const [pinned, setPinned] = useState(false);
  const [bounds, setBounds] = useState<CellAnchor | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // 触屏点按前手指的微小移动也会改写 at，「再点同一处取消固定」要跟按下前的固定点比。
  const pinnedAtDown = useRef<number | null>(null);
  const close = useCallback(() => {
    setAt(null);
    setPinned(false);
  }, []);
  useHoverDismiss(buttonRef, at != null, close);
  const span = forecast.resetAt - forecast.startAt;
  const inWindow = (value: number | null): value is number => value != null && value >= forecast.startAt && value <= forecast.resetAt;
  const clamp = (value: number) => Math.min(forecast.resetAt, Math.max(forecast.startAt, value));

  const timeAt = (clientX: number, target: HTMLButtonElement) => {
    const rect = cellAnchor(target);
    setBounds(rect);
    const raw = forecast.startAt + ((clientX - rect.left) / rect.width) * span;
    const snap = [forecast.startAt, forecast.now, forecast.runOutAt, forecast.resetAt]
      .filter((mark): mark is number => mark != null && Math.abs(mark - raw) < span * SNAP_FRACTION)
      .sort((left, right) => Math.abs(left - raw) - Math.abs(right - raw))[0];
    return snap ?? clamp(forecast.startAt + Math.round((raw - forecast.startAt) / STEP_MS) * STEP_MS);
  };

  const sample = inWindow(at) ? sampleForecast(forecast, at) : null;
  const clock = useMemo(() => new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone }), [timeZone]);
  const runsOut = forecast.runOutAt != null;
  const dots = sample == null
    ? []
    : [
        sample.even != null && { key: "even", percent: sample.even, className: "bg-muted-foreground" },
        sample.target != null && { key: "target", percent: sample.target, className: "bg-signal-green" },
        sample.phase === "locked"
          ? { key: "value", percent: 100, className: "bg-signal-red" }
          : sample.percent != null && {
              key: "value",
              percent: sample.percent,
              className: sample.phase === "used" ? "bg-foreground" : runsOut ? "bg-signal-red" : "bg-muted-foreground",
            },
      ].filter((dot): dot is { key: string; percent: number; className: string } => Boolean(dot));
  const top = dots.length ? Math.max(...dots.map((dot) => dot.percent)) : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="absolute inset-0 cursor-crosshair touch-pan-y focus-visible:outline-1 focus-visible:outline-live"
        aria-label="Weekly limit forecast. Use arrow keys to inspect the week, Enter to pin."
        aria-pressed={pinned}
        onPointerMove={(event) => {
          if (pinned && event.pointerType === "mouse") return;
          setAt(timeAt(event.clientX, event.currentTarget));
        }}
        onPointerDown={() => { pinnedAtDown.current = pinned ? at : null; }}
        onPointerLeave={(event) => { if (event.pointerType === "mouse" && !pinned) setAt(null); }}
        onFocus={(event) => { setBounds(cellAnchor(event.currentTarget)); setAt((current) => (inWindow(current) ? current : forecast.now)); }}
        onBlur={close}
        onClick={(event) => {
          if (event.detail === 0) {
            setBounds(cellAnchor(event.currentTarget));
            setAt((current) => (inWindow(current) ? current : forecast.now));
            setPinned((value) => !value);
            return;
          }
          const next = timeAt(event.clientX, event.currentTarget);
          setPinned(next !== pinnedAtDown.current);
          setAt(next);
        }}
        onKeyDown={(event) => {
          setBounds(cellAnchor(event.currentTarget));
          if (event.key === "Escape") close();
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            const step = event.key === "ArrowLeft" ? -KEY_STEP_MS : KEY_STEP_MS;
            setAt((current) => clamp((inWindow(current) ? current : forecast.now) + step));
          }
        }}
      />
      {sample && (
        <>
          <span
            aria-hidden
            className={cn("pointer-events-none absolute inset-y-0 border-l", pinned ? "border-foreground" : "border-line-strong")}
            style={{ left: `${x(sample.at)}%` }}
          />
          {dots.map((dot) => (
            <span
              key={dot.key}
              aria-hidden
              className={cn("pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface", dot.className)}
              style={{ left: `${x(sample.at)}%`, top: `${y(dot.percent)}%` }}
            />
          ))}
        </>
      )}
      {sample && top != null && bounds && (
        <AnchoredTooltip
          contentKey={`${sample.at}:${pinned}`}
          anchor={{
            left: bounds.left + (x(sample.at) / 100) * bounds.width - 1,
            top: bounds.top + (y(top) / 100) * bounds.height - 4,
            width: 2,
            height: 8,
          }}
        >
          <div className="grid gap-1 text-xs">
            <div className="flex justify-between gap-2 font-mono text-muted-foreground">
              <span>{sample.at === forecast.now ? "Now · " : ""}{clock.format(sample.at)}</span>
              {pinned && <span>Pinned</span>}
            </div>
            <div className="grid gap-0.5">
              {sample.phase === "locked" ? (
                <>
                  <Row strong swatch={<Swatch line="dashed" className="border-signal-red" />} label="Locked" value={clock.format(forecast.runOutAt!)} />
                  <Row swatch={<Swatch line="solid" className="border-transparent" />} label="Resets in" value={formatHours(forecast.resetAt - sample.at)} />
                </>
              ) : sample.phase === "used" ? (
                <Row strong swatch={<Swatch line="solid" className="border-foreground" />} label="Used" value={percent(sample.percent!)} />
              ) : (
                <Row
                  strong
                  swatch={<Swatch line="dashed" className={runsOut ? "border-signal-red" : "border-muted-foreground"} />}
                  label="Projected"
                  value={sample.percent == null ? "—" : percent(sample.percent)}
                />
              )}
              {sample.target != null && <Row swatch={<Swatch line="dashed" className="border-signal-green" />} label="Lasts the week" value={percent(sample.target)} />}
              {sample.even != null && <Row swatch={<Swatch line="dotted" className="border-muted-foreground" />} label="Even pace" value={percent(sample.even)} />}
            </div>
          </div>
        </AnchoredTooltip>
      )}
    </>
  );
}
