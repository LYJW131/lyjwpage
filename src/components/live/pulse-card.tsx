"use client";

import CursorIcon from "@lobehub/icons/es/Cursor/components/Mono";
import { Cloud } from "lucide-react";
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { AnchoredTooltip, cellAnchor, type CellAnchor, useHoverDismiss } from "./heatmap-hover";

import { DevToggle, DevToggleSlot, isDev } from "@/components/dev-toggles";
import { Card } from "@/components/ui/card";
import { MacBookProIcon } from "@/components/ui/device-icons";
import { useStatus } from "@/hooks/use-status";
import { PULSE_PATH } from "@/lib/paths";
import { CODING_AGENT_CLOUD, CODING_AGENT_CURSOR, CODING_AGENT_MAC } from "@shared/pulse-coding";
import { columnRows } from "@/lib/pulse-columns";
import type {
  PulseCodingLane,
  PulseDomain,
  PulsePayload,
  PulsePowerLane,
  PulseStateLane,
  PulseStepsLane,
  PulseTokensLane,
  StatusResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const REFRESH_MS = 5 * 60_000;

const LANES: ReadonlyArray<{ domain: PulseDomain; label: string }> = [
  { domain: "coding", label: "Coding" },
  { domain: "tokens", label: "Tokens" },
  { domain: "listening", label: "Listening" },
  { domain: "watching", label: "Watching" },
  { domain: "gaming", label: "Gaming" },
  { domain: "charging", label: "Charging" },
  { domain: "activity", label: "Activity" },
];

const LANE_WIDTH = 240;
const LANE_HEIGHT = 24;
const BAND_TOP = 4;
const IDLE_HEIGHT = 2;

type Range = { from: number; to: number };
type TraceStyle = "hatched" | "faint";

type LaneItem = {
  from: number;
  to: number;
  rank: number;
  content: ReactNode;
};

type LaneModel = {
  items: LaneItem[];
  svg: ReactNode;
  // SVG 横向拉伸会扭曲图案和文字，二者须放在 HTML 叠层。
  under?: ReactNode;
  over?: ReactNode;
  summary: { value: ReactNode; detail: ReactNode } | null;
  aria: string;
};

const time = (at: number) => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export function pulseDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function x(range: Range, at: number): number {
  return ((at - range.from) / Math.max(1, range.to - range.from)) * LANE_WIDTH;
}
function percent(range: Range, at: number): string {
  return `${((at - range.from) / Math.max(1, range.to - range.from)) * 100}%`;
}
function absolute(range: Range, row: { startSec: number; endSec: number }) {
  return { from: range.from + row.startSec * 1000, to: range.from + row.endSec * 1000 };
}

function Rect({ range, from, to, top, fill, opacity = 1 }: { range: Range; from: number; to: number; top: number; fill: string; opacity?: number }) {
  const left = x(range, from);
  return <rect x={left} y={top} width={Math.max(0.2, x(range, to) - left)} height={LANE_HEIGHT - top} fill={fill} fillOpacity={opacity} />;
}

function IdleLine({ range, from, to }: { range: Range; from: number; to: number }) {
  return <Rect range={range} from={from} to={to} top={LANE_HEIGHT - IDLE_HEIGHT} fill="currentColor" opacity={0.42} />;
}

function Tooltip({ from, to, head, lines }: { from: number; to: number; head: string; lines: (ReactNode | null | false)[] }) {
  return (
    <div className="text-xs">
      <div className="font-mono text-muted-foreground">{time(from)}–{time(to)}</div>
      <div className="mt-1 font-medium">{head}</div>
      {lines.filter(Boolean).map((line, index) => <div key={index} className="mt-0.5 break-words">{line}</div>)}
    </div>
  );
}

const CODING_WORDS = ["No coding", "Coding app", "Agent", "Coding app + agent"] as const;
const CODING_FILLS = ["", "var(--pulse-human)", "var(--pulse-agent)", "var(--pulse-both)"] as const;
const MODE_LABELS: Record<string, string> = {
  idle: "Idle", brief: "Brief bursts", interactive: "In coding apps", agent: "Agent work", mixed: "Apps + agents",
};

const AGENT_SOURCES = [
  { bit: CODING_AGENT_MAC, label: "Mac", icon: <MacBookProIcon className="size-3.5" aria-hidden /> },
  { bit: CODING_AGENT_CLOUD, label: "Cloud", icon: <Cloud className="size-3.5" aria-hidden /> },
  { bit: CODING_AGENT_CURSOR, label: "Cursor", icon: <CursorIcon size={14} aria-hidden /> },
] as const;

function AgentSources({ mask }: { mask: number }) {
  const active = AGENT_SOURCES.filter((source) => mask & source.bit);
  if (!active.length) return null;
  return (
    <span className="flex items-center gap-1">
      {active.map((source) => <span key={source.label} className="flex shrink-0">{source.icon}</span>)}
      <span>{active.map((source) => source.label).join(" + ")}</span>
    </span>
  );
}

function codingModel(lane: PulseCodingLane, range: Range): LaneModel | null {
  const segments = columnRows(lane.segments, ["value"]);
  const assessments = columnRows(lane.assessments, ["intensity", "confidence", "mode"]);
  if (!segments || !assessments || !lane.summary) return null;
  const scored = assessments.map((row) => ({ ...row, ...absolute(range, row) }));
  const items = segments.map((row, index): LaneItem => {
    const { from, to } = absolute(range, row);
    const middle = (from + to) / 2;
    const assessment = scored.find((score) => score.from <= middle && middle < score.to)
      ?? scored.find((score) => score.from < to && score.to > from);
    return {
      from, to, rank: row.value ? 0 : 1,
      content: (
        <Tooltip key={index} from={from} to={to} head={CODING_WORDS[row.value] ?? "Coding"} lines={[
          <AgentSources key="a" mask={lane.segments.agentSources?.[index] ?? 0} />,
          assessment && <span key="i">Jev intensity {Math.round(assessment.intensity / 4 * 100)}/100</span>,
          assessment?.mode && <span key="m" className="text-muted-foreground">{MODE_LABELS[assessment.mode] ?? assessment.mode}</span>,
        ]} />
      ),
    };
  });
  const { humanSeconds, agentSeconds, bothSeconds } = lane.summary;
  const total = humanSeconds + agentSeconds + bothSeconds;
  return {
    items,
    svg: segments.map((row, index) => {
      const { from, to } = absolute(range, row);
      return row.value ? <Rect key={index} range={range} from={from} to={to} top={BAND_TOP} fill={CODING_FILLS[row.value] ?? "var(--pulse-both)"} /> : <IdleLine key={index} range={range} from={from} to={to} />;
    }),
    summary: segments.length ? { value: pulseDuration(total), detail: `agent ${pulseDuration(agentSeconds + bothSeconds)}` } : null,
    aria: "coding timeline: coding app in front, agent running, or both",
  };
}

function runs(rows: { from: number; to: number; state: number }[]) {
  const merged: { from: number; to: number; state: number }[] = [];
  for (const row of rows) {
    const last = merged.at(-1);
    if (last && last.to === row.from && last.state === row.state) last.to = row.to;
    else merged.push({ ...row });
  }
  return merged;
}

// 斜纹从每个元素的左缘起算，相接的 trace 分开画会在接缝处错位。
function spans(rows: { from: number; to: number }[]) {
  const merged: { from: number; to: number }[] = [];
  for (const row of [...rows].sort((a, b) => a.from - b.from)) {
    const last = merged.at(-1);
    if (last && row.from <= last.to) last.to = Math.max(last.to, row.to);
    else merged.push({ ...row });
  }
  return merged;
}

const STATE_WORDS: Record<"listening" | "watching" | "gaming", readonly string[]> = {
  listening: ["Idle", "Paused", "Playing"],
  watching: ["Idle", "Paused", "Playing"],
  gaming: ["Offline", "Online", "In game"],
};
const ACTIVE_WORDS = { listening: "playing", watching: "watching", gaming: "in game" } as const;

function stateModel(domain: "listening" | "watching" | "gaming", lane: PulseStateLane, range: Range, traceStyle: TraceStyle): LaneModel | null {
  const segments = columnRows(lane.segments, ["state", "title", "subtitle"]);
  const traces = lane.uncertain ? columnRows(lane.uncertain, ["title", "subtitle"]) : [];
  const margins = lane.uncertain ? columnRows(lane.uncertain, ["marginSec"]) : null;
  if (!segments || !traces || !lane.summary) return null;
  const words = STATE_WORDS[domain];
  const items: LaneItem[] = [
    ...segments.map((row, index): LaneItem => {
      const { from, to } = absolute(range, row);
      return {
        from, to, rank: row.state >= 2 ? 0 : 2,
        content: <Tooltip key={`s${index}`} from={from} to={to} head={words[row.state] ?? "Active"} lines={[
          row.title,
          row.subtitle && <span className="text-muted-foreground">{row.subtitle}</span>,
        ]} />,
      };
    }),
    ...traces.map((row, index): LaneItem => {
      const { from, to } = absolute(range, row);
      const margin = margins?.[index]?.marginSec;
      return {
        from, to, rank: 1,
        content: <Tooltip key={`t${index}`} from={from} to={to} head="Played elsewhere (estimated)" lines={[
          row.title,
          row.subtitle && <span className="text-muted-foreground">{row.subtitle}</span>,
          <span key="n" className="text-[10px] text-muted-foreground">
            Estimated from Apple Music&apos;s recently played list and track lengths{typeof margin === "number" ? `, ideal start error ±${margin < 90 ? `${Math.max(1, margin)}s` : pulseDuration(margin)}` : ""}
          </span>,
        ]} />,
      };
    }),
  ].sort((a, b) => a.from - b.from || a.rank - b.rank);
  const { activeSeconds, titles } = lane.summary;
  return {
    items,
    svg: runs(segments.map((row) => ({ ...absolute(range, row), state: row.state }))).map((run, index) => {
      if (run.state >= 2) return <Rect key={index} range={range} from={run.from} to={run.to} top={BAND_TOP} fill="var(--live)" opacity={0.85} />;
      if (run.state === 1) return <Rect key={index} range={range} from={run.from} to={run.to} top={14} fill="var(--live)" opacity={0.4} />;
      return <IdleLine key={index} range={range} from={run.from} to={run.to} />;
    }),
    under: spans(traces.map((row) => absolute(range, row))).map(({ from, to }, index) => {
      return (
        <span
          key={index}
          aria-hidden
          className={cn("pulse-trace absolute bottom-0", traceStyle === "hatched" ? "pulse-trace-hatched" : "pulse-trace-faint")}
          style={{ left: percent(range, from), width: `max(2px, calc(${percent(range, to)} - ${percent(range, from)}))`, top: `${(BAND_TOP / LANE_HEIGHT) * 100}%` }}
        />
      );
    }),
    summary: segments.length || traces.length
      ? { value: pulseDuration(activeSeconds), detail: domain === "listening" && titles ? `${titles.toLocaleString("en-US")} ${titles === 1 ? "track" : "tracks"}` : ACTIVE_WORDS[domain] }
      : null,
    aria: domain === "gaming" ? "PlayStation status: offline, online or in a game" : `${domain} status: idle, paused or playing`,
  };
}

const POWER_SCALE_MIN_W = 20;

function powerModel(lane: PulsePowerLane, range: Range): LaneModel | null {
  const segments = columnRows(lane.segments, ["watts"]);
  if (!segments || !lane.summary) return null;
  const scale = Math.max(POWER_SCALE_MIN_W, lane.summary.peakW ?? 0);
  const rows = segments.map((row) => ({ ...absolute(range, row), watts: row.watts }));
  const y = (watts: number) => (watts <= 0 ? LANE_HEIGHT - 1 : LANE_HEIGHT - Math.max(1.5, (watts / scale) * (LANE_HEIGHT - BAND_TOP)));
  const chains: (typeof rows)[] = [];
  for (const row of rows) {
    if (row.watts <= 0) continue;
    const chain = chains.at(-1);
    if (chain && chain.at(-1)!.to === row.from) chain.push(row);
    else chains.push([row]);
  }
  const fixed = (value: number) => value.toFixed(1);
  const area = chains.map((chain) => `M${fixed(x(range, chain[0].from))} ${LANE_HEIGHT}${chain.map((row) => ` L${fixed(x(range, row.from))} ${fixed(y(row.watts))} L${fixed(x(range, row.to))} ${fixed(y(row.watts))}`).join("")} L${fixed(x(range, chain.at(-1)!.to))} ${LANE_HEIGHT} Z`).join(" ");
  const line = chains.map((chain) => `M${fixed(x(range, chain[0].from))} ${fixed(y(chain[0].watts))}${chain.map((row) => ` L${fixed(x(range, row.from))} ${fixed(y(row.watts))} L${fixed(x(range, row.to))} ${fixed(y(row.watts))}`).join("")}`).join(" ");
  const watts = (value: number) => `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })} W`;
  const { peakW, energyWh } = lane.summary;
  return {
    items: rows.map((row, index) => ({
      from: row.from, to: row.to, rank: 0,
      content: <Tooltip key={index} from={row.from} to={row.to} head={row.watts > 1 ? watts(row.watts) : row.watts > 0 ? `${watts(row.watts)} · standby` : "Not charging"} lines={[]} />,
    })),
    svg: (
      <>
        {rows.filter((row) => row.watts <= 0).map((row, index) => <IdleLine key={index} range={range} from={row.from} to={row.to} />)}
        {chains.length > 0 && <path d={area} fill="var(--live)" fillOpacity={0.3} />}
        {chains.length > 0 && <path d={line} fill="none" stroke="var(--live)" strokeWidth="1.25" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
      </>
    ),
    summary: rows.length && peakW != null
      ? peakW > 0
        ? { value: `Peak ${watts(peakW)}`, detail: lane.currentPowerW != null && lane.currentPowerW > 1 ? `now ${watts(lane.currentPowerW)}` : `${energyWh.toLocaleString("en-US")} Wh` }
        : { value: "0 W", detail: "not charging" }
      : null,
    aria: "charger output in watts",
  };
}

const compactWhole = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 0 });
const compactTenths = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function compactCount(value: number): string {
  return (value < 1000 ? compactWhole : compactTenths).format(value);
}

const TOKEN_SCALE_MIN = 10_000;

function tokensModel(lane: PulseTokensLane, range: Range): LaneModel | null {
  const buckets = columnRows(lane.buckets, ["fresh", "output", "cacheRead"]);
  if (!buckets || !lane.summary) return null;
  const rows = buckets.map((row) => {
    const { from, to } = absolute(range, row);
    const minutes = Math.max(1 / 60, (to - from) / 60_000);
    return { from, to, rate: row.fresh / minutes, output: row.output / minutes, cacheRead: row.cacheRead / minutes };
  });
  const scale = Math.max(TOKEN_SCALE_MIN, ...rows.map((row) => row.rate));
  const y = (rate: number) => LANE_HEIGHT - Math.max(1.5, Math.sqrt(rate / scale) * (LANE_HEIGHT - BAND_TOP));
  const chains: (typeof rows)[] = [];
  for (const row of rows) {
    const chain = chains.at(-1);
    if (chain && chain.at(-1)!.to === row.from) chain.push(row);
    else chains.push([row]);
  }
  const fixed = (value: number) => value.toFixed(1);
  const steps = (chain: typeof rows) => chain.map((row) => ` L${fixed(x(range, row.from))} ${fixed(y(row.rate))} L${fixed(x(range, row.to))} ${fixed(y(row.rate))}`).join("");
  const area = chains.map((chain) => `M${fixed(x(range, chain[0].from))} ${LANE_HEIGHT}${steps(chain)} L${fixed(x(range, chain.at(-1)!.to))} ${LANE_HEIGHT} Z`).join(" ");
  const line = chains.map((chain) => `M${fixed(x(range, chain[0].from))} ${fixed(y(chain[0].rate))}${steps(chain)}`).join(" ");
  const { peakPerMinute, currentPerMinute, freshTokens } = lane.summary;
  return {
    items: rows.map((row, index) => ({
      from: row.from, to: row.to, rank: 0,
      content: (
        <Tooltip key={index} from={row.from} to={row.to} head={`${compactCount(row.rate)} tokens/min`} lines={[
          <span key="o" className="text-muted-foreground">Output {compactCount(row.output)}/min · Cache read {compactCount(row.cacheRead)}/min</span>,
        ]} />
      ),
    })),
    svg: (
      <>
        {chains.length > 0 && <path d={area} fill="var(--pulse-agent)" fillOpacity={0.3} />}
        {chains.length > 0 && <path d={line} fill="none" stroke="var(--pulse-agent)" strokeWidth="1.25" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
      </>
    ),
    summary: rows.length && peakPerMinute != null
      ? {
        value: `Peak ${compactCount(peakPerMinute)}/min`,
        detail: currentPerMinute != null && currentPerMinute > 0 ? `now ${compactCount(currentPerMinute)}/min` : `${compactCount(freshTokens)} in 24h`,
      }
      : null,
    aria: "new tokens per minute across coding agents, excluding cache reads",
  };
}

const STEPS_SCALE_MIN = 400;

function stepsModel(lane: PulseStepsLane, range: Range, width: number): LaneModel | null {
  const buckets = columnRows(lane.buckets, ["steps"]);
  const workouts = columnRows(lane.workouts, ["activityType"]);
  if (!buckets || !workouts || !lane.summary) return null;
  const scale = Math.max(STEPS_SCALE_MIN, ...buckets.map((row) => row.steps));
  const sessions = workouts.map((row) => ({ ...absolute(range, row), activityType: row.activityType }));
  const items: LaneItem[] = [
    ...buckets.map((row, index): LaneItem => {
      const { from, to } = absolute(range, row);
      const workout = sessions.find((session) => session.from < to && session.to > from);
      return {
        from, to, rank: 0,
        content: <Tooltip key={`b${index}`} from={from} to={to} head={`${row.steps.toLocaleString("en-US")} ${row.steps === 1 ? "step" : "steps"}`} lines={[
          workout && <span key="w" className="text-muted-foreground">During {workout.activityType}</span>,
        ]} />,
      };
    }),
    ...sessions.map((session, index): LaneItem => ({
      from: session.from, to: session.to, rank: 1,
      content: <Tooltip key={`w${index}`} from={session.from} to={session.to} head={session.activityType} lines={[<span key="d" className="text-muted-foreground">Workout · {pulseDuration((session.to - session.from) / 1000)}</span>]} />,
    })),
  ].sort((a, b) => a.from - b.from || a.rank - b.rank);
  const { steps } = lane.summary;
  return {
    items,
    svg: buckets.map((row, index) => {
      const { from, to } = absolute(range, row);
      if (row.steps <= 0) return <IdleLine key={index} range={range} from={from} to={to} />;
      const height = Math.max(1.5, (row.steps / scale) * (LANE_HEIGHT - BAND_TOP));
      return <Rect key={index} range={range} from={from} to={to} top={LANE_HEIGHT - height} fill="var(--live)" opacity={0.85} />;
    }),
    under: sessions.map((session, index) => (
      <span
        key={index}
        aria-hidden
        className="absolute bottom-0 top-0 border-t-2 border-live bg-live/12"
        style={{ left: percent(range, session.from), width: `max(2px, calc(${percent(range, session.to)} - ${percent(range, session.from)}))` }}
      />
    )),
    over: sessions.map((session, index) => {
      const room = ((Math.min(range.to, sessions[index + 1]?.from ?? range.to) - session.from) / Math.max(1, range.to - range.from)) * width;
      if (room < session.activityType.length * 5.5 + 6) return null;
      const left = (session.from - range.from) / Math.max(1, range.to - range.from) * width;
      const shift = Math.min(0, width - left - (session.activityType.length * 5.5 + 6));
      return (
        <span
          key={index}
          aria-hidden
          className="pointer-events-none absolute top-0.5 whitespace-nowrap bg-surface/85 px-0.5 text-[9px] font-medium leading-none text-foreground"
          style={{ left: percent(range, session.from), transform: shift ? `translateX(${shift}px)` : undefined }}
        >
          {session.activityType}
        </span>
      );
    }),
    summary: buckets.length || sessions.length
      ? { value: steps.toLocaleString("en-US"), detail: `steps${sessions.length > 0 ? ` · ${sessions.length} ${sessions.length === 1 ? "workout" : "workouts"}` : ""}` }
      : null,
    aria: "steps per five minutes from HealthKit, with completed workouts",
  };
}

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function LaneView({ label, model, range }: { label: string; model: LaneModel; range: Range }) {
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

const TRACE_STYLE_KEY = "pulse:trace-style";
const traceStyleListeners = new Set<() => void>();
function readTraceStyle(): TraceStyle {
  if (!isDev) return "hatched";
  try { return localStorage.getItem(TRACE_STYLE_KEY) === "faint" ? "faint" : "hatched"; } catch { return "hatched"; }
}
function subscribeTraceStyle(onChange: () => void) {
  traceStyleListeners.add(onChange);
  return () => { traceStyleListeners.delete(onChange); };
}
function toggleTraceStyle() {
  try { localStorage.setItem(TRACE_STYLE_KEY, readTraceStyle() === "hatched" ? "faint" : "hatched"); } catch { return; }
  for (const listener of traceStyleListeners) listener();
}

export function PulseCard({
  fallback,
  className,
}: {
  fallback: StatusResponse<PulsePayload>;
  className?: string;
}) {
  const { data } = useStatus<PulsePayload>(PULSE_PATH, REFRESH_MS, { fallback });
  const range = data?.window ?? { from: 0, to: 0 };
  const lanes = data?.lanes;
  const traceStyle = useSyncExternalStore(subscribeTraceStyle, readTraceStyle, () => "hatched" as const);
  const activityRef = useRef<HTMLDivElement>(null);
  const activityWidth = useWidth(activityRef);

  // Worker 与站点独立部署，缓存载荷可能不符合当前形状，必须逐道校验。
  const modelOf = (domain: PulseDomain): LaneModel | null => {
    const lane = lanes && typeof lanes === "object" ? lanes[domain] : undefined;
    if (!lane || typeof lane !== "object") return null;
    try {
      switch (domain) {
        case "coding": return lane.kind === "coding" ? codingModel(lane, range) : null;
        case "tokens": return lane.kind === "tokens" ? tokensModel(lane, range) : null;
        case "listening": case "watching": case "gaming": return lane.kind === "state" ? stateModel(domain, lane, range, traceStyle) : null;
        case "charging": return lane.kind === "power" ? powerModel(lane, range) : null;
        case "activity": return lane.kind === "steps" ? stepsModel(lane, range, activityWidth) : null;
      }
    } catch {
      return null;
    }
  };

  return (
    <Card label="Pulse" action="Last 24 hours" className={cn("h-full", className)}>
      <div className="flex flex-col gap-3 p-4 sm:gap-2 lg:p-5">
        {LANES.map(({ domain, label }) => {
          const model = modelOf(domain);
          const empty = !model || !model.items.length;
          return (
            <div
              key={domain}
              className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 sm:grid-cols-[5.5rem_1fr_8rem] sm:gap-y-0"
              role="group"
              aria-label={`${label} over the last 24 hours`}
            >
              <span
                className="label-mono truncate text-muted-foreground"
                title={domain === "activity"
                  ? "Steps from closed HealthKit five-minute buckets; gaps are unknown, not still."
                  : domain === "tokens" ? "New tokens per minute across all coding agents and sources, excluding cache reads." : undefined}
              >
                {label}
              </span>
              <div ref={domain === "activity" ? activityRef : undefined} className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:row-start-auto">
                {empty ? (
                  <span className="text-xs text-muted-foreground">No data</span>
                ) : (
                  <LaneView label={label} model={model} range={range} />
                )}
              </div>
              <div className="flex min-w-0 items-baseline justify-end gap-x-1.5 text-right leading-tight sm:flex-col sm:items-end">
                {model?.summary ? (
                  <>
                    <span className="max-w-full truncate font-mono text-xs font-medium tabular-nums">{model.summary.value}</span>
                    <span className="max-w-full truncate text-[10px] text-muted-foreground">{model.summary.detail}</span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
            </div>
          );
        })}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground" aria-hidden>
          <span className="flex items-center gap-1"><span className="size-2 bg-(--pulse-human)" />Coding app</span>
          <span className="flex items-center gap-1"><span className="size-2 bg-(--pulse-agent)" />Agent</span>
          <span className="flex items-center gap-1"><span className="size-2 bg-(--pulse-both)" />Both</span>
          <span className="flex items-center gap-1"><span className="h-2 w-3 border-t border-(--pulse-agent) bg-(--pulse-agent)/30" />Tokens/min (excl. cache reads)</span>
          <span className="flex items-center gap-1">
            <span className={cn("pulse-trace relative inline-block h-2 w-3", traceStyle === "hatched" ? "pulse-trace-hatched" : "pulse-trace-faint")} />
            Played elsewhere, estimated
          </span>
          <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-current opacity-45" />Idle</span>
        </div>
      </div>
      {isDev && (
        <DevToggleSlot>
          <DevToggle
            label="Traces"
            on={traceStyle === "hatched"}
            states={["Hatched", "Faint"]}
            title="开发环境调试：切换 Pulse 听歌道「不确定区间」的画法（斜线 / 淡色填充）"
            onClick={toggleTraceStyle}
          />
        </DevToggleSlot>
      )}
    </Card>
  );
}
