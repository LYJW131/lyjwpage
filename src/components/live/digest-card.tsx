"use client";

import { useEffect, useState, type CSSProperties } from "react";

import { PULSE_REFRESH_MS } from "@/components/live/pulse-card";
import { TimezoneCard } from "@/components/live/timezone-card";
import { Card } from "@/components/ui/card";
import { useMountedAt } from "@/hooks/use-mounted-at";
import { useStale } from "@/hooks/use-stale";
import { useStatus } from "@/hooks/use-status";
import { digestFigure } from "@/lib/digest-figure";
import { STRIP_BINS, topicStrip } from "@/lib/digest-strips";
import { DIGEST_PATH, PULSE_PATH, TIMEZONE_PATH } from "@/lib/paths";
import { formatUTCOffset, resolveTimezoneDisplay } from "@/lib/timezone-display";
import { cn } from "@/lib/utils";
import type { DigestPayload, DigestTopic } from "@shared/digest";
import { DIGEST_STALE_MS } from "@shared/freshness";
import type { PulsePayload, StatusResponse, TimezonePayload } from "@shared/types";

const TONES: Record<DigestTopic, string> = {
  coding: "var(--signal-blue)",
  agents: "var(--claude)",
  tokens: "var(--signal-orange)",
  site: "var(--signal-green)",
  music: "var(--signal-red)",
  watching: "var(--signal-violet)",
  gaming: "var(--pulse-both)",
  trophies: "var(--signal-yellow)",
  fitness: "var(--activity-move)",
};

const DAY_SECONDS = 86_400;
const SIZE = 200;
const CENTER = SIZE / 2;
const TRACK_WIDTH = 9;
const TICK_OUTER = 5;
const TICK_INNER = 12;

function dayTurn(at: number, offsetSeconds: number) {
  return ((((at / 1000 + offsetSeconds) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS) / DAY_SECONDS;
}

function polar(radius: number, turn: number) {
  return [CENTER + radius * Math.sin(turn * 2 * Math.PI), CENTER - radius * Math.cos(turn * 2 * Math.PI)] as const;
}

function arc(radius: number, from: number, to: number) {
  const [x0, y0] = polar(radius, from);
  const [x1, y1] = polar(radius, to);
  return `M ${x0} ${y0} A ${radius} ${radius} 0 0 1 ${x1} ${y1}`;
}

const clockFormat = new Map<string, Intl.DateTimeFormat>();

function clockLabel(now: number, timezone: string) {
  let format = clockFormat.get(timezone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    clockFormat.set(timezone, format);
  }
  return format.format(new Date(now));
}

function DayDial({
  tracks,
  window,
  now,
  timezone,
  offsetSeconds,
  zoneLabel,
}: {
  tracks: { topic: DigestTopic; bins: number[] }[];
  window: { from: number; to: number } | null;
  now: number;
  timezone: string;
  offsetSeconds: number;
  zoneLabel: string;
}) {
  const nowTurn = dayTurn(now, offsetSeconds);
  const startTurn = window ? dayTurn(window.from, offsetSeconds) : 0;
  const binTurn = window ? (window.to - window.from) / 1000 / STRIP_BINS / DAY_SECONDS : 0;
  const [handX0, handY0] = polar(36, nowTurn);
  const [handX1, handY1] = polar(CENTER - 4, nowTurn);
  return (
    <div className="clock-ui-host col-start-2 row-span-2 row-start-1 size-32 shrink-0 self-center max-[359px]:size-28 lg:size-40">
      <div className="clock-ui clock-ui--bordered">
        <div className="clock-ui__face">
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 size-full" role="img" aria-label="The past 24 hours on a 24-hour dial">
            {Array.from({ length: 12 }, (_, index) => {
              if (index % 3 === 0) return null;
              const [x0, y0] = polar(CENTER - TICK_OUTER, index / 12);
              const [x1, y1] = polar(CENTER - TICK_INNER, index / 12);
              return <line key={index} x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--foreground)" strokeWidth={2} />;
            })}
            {[0, 6, 12, 18].map((hour) => {
              const [x, y] = polar(CENTER - (TICK_OUTER + TICK_INNER) / 2, hour / 24);
              return <text key={hour} x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="11" fill="var(--muted-foreground)">{hour}</text>;
            })}
            {tracks.map((track, ring) => {
              const radius = CENTER - 34 - ring * (TRACK_WIDTH + 4);
              return (
                <g key={track.topic} style={{ "--tone": TONES[track.topic] } as CSSProperties}>
                  <circle cx={CENTER} cy={CENTER} r={radius} fill="none" stroke="var(--tone)" strokeOpacity={0.12} strokeWidth={TRACK_WIDTH} />
                  {track.bins.map((value, index) => (value > 0.02 ? (
                    <path key={index} d={arc(radius, startTurn + index * binTurn, startTurn + (index + 1) * binTurn)} fill="none" stroke="var(--tone)" strokeWidth={TRACK_WIDTH} strokeOpacity={0.35 + 0.65 * value} />
                  ) : null))}
                </g>
              );
            })}
            <line x1={handX0} y1={handY0} x2={handX1} y2={handY1} stroke="var(--signal-red)" strokeWidth={1.5} strokeLinecap="round" />
            <text x={CENTER} y={CENTER - 4} textAnchor="middle" dominantBaseline="central" fontSize="20" fontWeight="600" fill="var(--foreground)">{clockLabel(now, timezone)}</text>
            <text x={CENTER} y={CENTER + 14} textAnchor="middle" dominantBaseline="central" fontSize="9" fill="var(--muted-foreground)">{zoneLabel}</text>
          </svg>
        </div>
      </div>
    </div>
  );
}

export function DigestCard({
  fallback,
  pulseFallback,
  timezoneFallback,
  className,
}: {
  fallback: StatusResponse<DigestPayload>;
  pulseFallback: StatusResponse<PulsePayload>;
  timezoneFallback: StatusResponse<TimezonePayload>;
  className?: string;
}) {
  const { data, updatedAt, servedAt } = useStatus<DigestPayload>(DIGEST_PATH, { fallback });
  const { data: pulse } = useStatus<PulsePayload>(PULSE_PATH, PULSE_REFRESH_MS, { fallback: pulseFallback });
  const { data: zone } = useStatus<TimezonePayload>(TIMEZONE_PATH, { fallback: timezoneFallback });
  const timezoneEnvelope: StatusResponse<TimezonePayload> = zone ? { ok: true, data: zone } : timezoneFallback;
  const stale = useStale(updatedAt, DIGEST_STALE_MS, servedAt);
  const mountedAt = useMountedAt();
  const [ticked, setTicked] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTicked(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!data || !updatedAt) return <TimezoneCard fallback={timezoneEnvelope} className={className} />;

  const now = ticked || mountedAt || (zone ? zone.snapshotAt : updatedAt);
  const { identifier: timezone, abbreviation, offsetSeconds } = resolveTimezoneDisplay(zone?.timezone ?? null, now);
  const tracks = pulse && !stale
    ? data.highlights.flatMap((item) => {
      const bins = topicStrip(item.topic, pulse);
      return bins ? [{ topic: item.topic, bins }] : [];
    })
    : [];

  return (
    <Card id="digest" className={cn("h-full scroll-mt-28", className)}>
      <div className="grid h-full min-h-44 grid-cols-[minmax(0,1fr)_auto] content-center items-center gap-x-3 gap-y-2.5 p-4 pl-4.5 lg:gap-x-4 lg:p-5">
        <div className="col-start-1 row-start-1 flex min-w-0 flex-col gap-1">
          <div className="text-xs text-muted-foreground">Last 24 hours</div>
          <h2 lang="zh-CN" className="font-brush whitespace-nowrap text-[28px] leading-none md:text-4xl lg:text-5xl">{data.headline}</h2>
        </div>
        <ul className={cn("col-start-1 row-start-2 grid grid-cols-[auto_auto_minmax(0,1fr)] items-baseline gap-x-1.5 gap-y-1.5 sm:gap-x-2", stale && "opacity-60")}>
          {data.highlights.map((item) => (
            <li key={item.topic} className="col-span-3 grid grid-cols-subgrid items-baseline" style={{ "--tone": TONES[item.topic] ?? TONES.coding } as CSSProperties}>
              <span className="size-2 -translate-y-[3px] bg-(--tone)" aria-hidden />
              <span className="whitespace-nowrap text-lg font-semibold leading-none tabular-nums text-(--tone)">{digestFigure(item)}</span>
              <span className="truncate text-sm text-muted-foreground">{item.caption}</span>
            </li>
          ))}
        </ul>
        <DayDial tracks={tracks} window={pulse?.window ?? null} now={now} timezone={timezone} offsetSeconds={offsetSeconds ?? 0} zoneLabel={abbreviation ?? formatUTCOffset(offsetSeconds ?? 0)} />
      </div>
    </Card>
  );
}
