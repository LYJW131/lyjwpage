import CursorIcon from "@lobehub/icons/es/Cursor/components/Mono";
import { Cloud } from "lucide-react";

import { BAND_TOP, IDLE_HEIGHT, LANE_HEIGHT, IdleLine, Rect, Tooltip, absolute, barPath, codingBars, percent, pulseDuration, runs, spans, type LaneItem, type LaneModel, type Range, type TraceStyle } from "@/components/live/pulse/lane-geometry";
import { MacBookProIcon } from "@/components/ui/device-icons";
import { CODING_AGENT_CLOUD, CODING_AGENT_CURSOR, CODING_AGENT_MAC } from "@shared/pulse-coding";
import { gamingSummaryDetail } from "@/lib/gaming-lane-detail";
import { columnRows } from "@shared/pulse-columns";
import { codingAgentSeconds, codingDriverSeconds } from "@shared/pulse-types";
import type { PulseCodingLane, PulseStateLane } from "@shared/types";
import { cn } from "@/lib/utils";

const CODING_WORDS = ["No coding", "Coding app", "Agent", "Coding app + agent"] as const;
const CODING_FILLS = ["", "var(--pulse-human)", "var(--pulse-agent)", "var(--pulse-both)"] as const;

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

export function codingModel(lane: PulseCodingLane, range: Range): LaneModel | null {
  const segments = columnRows(lane.segments, ["value"]);
  if (!segments || !lane.summary) return null;
  const items = segments.map((row, index): LaneItem => {
    const { from, to } = absolute(range, row);
    return {
      from, to, rank: row.value ? 0 : 1,
      content: (
        <Tooltip key={index} from={from} to={to} head={CODING_WORDS[row.value] ?? "Coding"} lines={[
          <AgentSources key="a" mask={lane.segments.agentSources?.[index] ?? 0} />,
        ]} />
      ),
    };
  });
  return {
    items,
    svg: (() => {
      const bars = codingBars(range, segments.map((row) => ({ ...absolute(range, row), state: row.value })));
      return CODING_FILLS.map((fill, value) => {
        const rows = bars.filter((bar) => bar.state === value);
        if (!rows.length) return null;
        return value
          ? <path key={value} d={barPath(rows, BAND_TOP)} fill={fill} />
          : <path key={value} d={barPath(rows, LANE_HEIGHT - IDLE_HEIGHT)} fill="currentColor" fillOpacity={0.42} />;
      });
    })(),
    summary: segments.length ? { value: `driver ${pulseDuration(codingDriverSeconds(lane.summary))}`, detail: `agent ${pulseDuration(codingAgentSeconds(lane.summary))}` } : null,
    aria: "coding timeline: coding app in front, agent running, or both",
  };
}

const STATE_WORDS: Record<"listening" | "watching" | "gaming", readonly string[]> = {
  listening: ["Idle", "Paused", "Playing"],
  watching: ["Idle", "Paused", "Playing"],
  gaming: ["Offline", "Online", "In game"],
};
const ACTIVE_WORDS = { listening: "playing", watching: "watching", gaming: "in game" } as const;

export function stateModel(domain: "listening" | "watching" | "gaming", lane: PulseStateLane, range: Range, traceStyle: TraceStyle): LaneModel | null {
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
          <span key="n" className="text-2xs text-muted-foreground">
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
      ? {
          value: pulseDuration(activeSeconds),
          detail: domain === "listening" && titles
            ? `${titles.toLocaleString("en-US")} ${titles === 1 ? "track" : "tracks"}`
            : domain === "gaming"
              ? gamingSummaryDetail(activeSeconds, titles, segments.map((row) => row.state))
              : ACTIVE_WORDS[domain],
        }
      : null,
    aria: domain === "gaming" ? "Game status on PlayStation or Meta Quest: offline, online or in a game" : `${domain} status: idle, paused or playing`,
  };
}
