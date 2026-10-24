"use client";

import { useEffect, useState, type CSSProperties } from "react";

import { PULSE_REFRESH_MS } from "@/components/live/pulse-card";
import { TimezoneCard } from "@/components/live/timezone-card";
import { Card } from "@/components/ui/card";
import { useMountedAt } from "@/hooks/use-mounted-at";
import { useStale } from "@/hooks/use-stale";
import { useStatus } from "@/hooks/use-status";
import { arc, CENTER, clockLabel, DAY_SECONDS, dayTurn, dialBootScript, HAND_INNER, HAND_OUTER, polar, SIZE, TICK_INNER, TICK_OUTER, TRACK_WIDTH } from "@/lib/digest-dial";
import { digestFigure } from "@/lib/digest-figure";
import { STRIP_BINS, topicStrip } from "@/lib/digest-strips";
import { scriptJson } from "@/lib/inline-script";
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

const HEADLINE_ROTATE_MS = 60_000;
const HEADLINE_PICK = "__digestHeadline";

declare global {
  interface Window {
    __digestHeadline?: string;
  }
}

// 首屏的随机一条由紧跟标题的内联脚本在绘制前写进 DOM 并记下，水合时沿用它，刷新换句却不闪。
const headlinePickScript = (pool: readonly string[]) =>
  `(()=>{const p=${scriptJson(pool)},h=p[Math.floor(Math.random()*p.length)],t=document.currentScript?.previousElementSibling?.querySelector("[data-headline]")?.firstChild;window.${HEADLINE_PICK}=h;if(t)t.nodeValue=h})()`;

const otherLine = (lines: readonly string[], line: string) => {
  const shown = lines.includes(line) ? line : lines[0];
  const rest = lines.filter((candidate) => candidate !== shown);
  return rest[Math.floor(Math.random() * rest.length)];
};

function useRotatingHeadline(pool: readonly string[]) {
  const [state, setState] = useState(() => {
    if (typeof window === "undefined") return { line: pool[0], rotated: false, clicks: 0 };
    const picked = window[HEADLINE_PICK];
    delete window[HEADLINE_PICK];
    return { line: typeof picked === "string" && pool.includes(picked) ? picked : pool[Math.floor(Math.random() * pool.length)], rotated: false, clicks: 0 };
  });
  const key = pool.join("|");
  // 点击后整整一分钟才自动再换，免得刚点出来的那句马上被换掉。
  useEffect(() => {
    const lines = key.split("|");
    if (lines.length < 2) return;
    const timer = window.setInterval(() => setState((prev) => ({ ...prev, line: otherLine(lines, prev.line), rotated: true })), HEADLINE_ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [key, state.clicks]);
  const next = () => setState((prev) => ({ line: otherLine(key.split("|"), prev.line), rotated: true, clicks: prev.clicks + 1 }));
  return { ...(pool.includes(state.line) ? state : { line: pool[0], rotated: false }), next };
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
  const [handX0, handY0] = polar(HAND_INNER, nowTurn);
  const [handX1, handY1] = polar(HAND_OUTER, nowTurn);
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
            <line data-dial-hand x1={handX0} y1={handY0} x2={handX1} y2={handY1} stroke="var(--signal-red)" strokeWidth={1.5} strokeLinecap="round" suppressHydrationWarning />
            <text data-dial-clock x={CENTER} y={CENTER - 4} textAnchor="middle" dominantBaseline="central" fontSize="20" fontWeight="600" fill="var(--foreground)" suppressHydrationWarning>{clockLabel(now, timezone)}</text>
            <text x={CENTER} y={CENTER + 14} textAnchor="middle" dominantBaseline="central" fontSize="9" fill="var(--muted-foreground)">{zoneLabel}</text>
          </svg>
          <script dangerouslySetInnerHTML={{ __html: dialBootScript(timezone) }} />
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
  const pool = data?.headlines?.length ? data.headlines : [data?.headline ?? ""];
  const headline = useRotatingHeadline(pool);
  const [ticked, setTicked] = useState(0);
  useEffect(() => {
    let timer: number;
    // 每次都按墙上时钟重排到下一个整分钟：后台标签页会推迟定时器，固定间隔的 setInterval 回到前台后会一直错位。
    const schedule = () => {
      timer = window.setTimeout(() => {
        setTicked(Date.now());
        schedule();
      }, 60_000 - (Date.now() % 60_000));
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);
  if (!data || !updatedAt || data.quiet) return <TimezoneCard fallback={timezoneEnvelope} className={className} />;

  const now = ticked || mountedAt || (zone ? zone.snapshotAt : updatedAt);
  const { identifier: timezone, abbreviation, offsetSeconds } = resolveTimezoneDisplay(zone?.timezone ?? null, now);
  const tracks = pulse && !stale
    ? data.highlights.flatMap((item) => {
      const bins = topicStrip(item.topic, pulse);
      return bins ? [{ topic: item.topic, bins }] : [];
    })
    : [];

  const headlineText = <span key={headline.line} data-headline suppressHydrationWarning className={cn("inline-block", headline.rotated && "animate-headline-in")}>{headline.line}。</span>;

  return (
    <Card id="digest" className={cn("h-full scroll-mt-28", className)}>
      <div className="grid h-full min-h-44 grid-cols-[minmax(0,1fr)_auto] content-center items-center gap-x-3 gap-y-4 p-4 lg:gap-x-4 lg:gap-y-5 lg:p-5">
        <h2 lang="zh-CN" className="col-start-1 row-start-1 min-w-0 text-balance font-sans text-2xl font-bold leading-none tracking-tight lg:text-4xl">
          {pool.length > 1 ? (
            <button type="button" onClick={headline.next} title="Show another headline" className="cursor-pointer text-left focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-live">
              {headlineText}
            </button>
          ) : headlineText}
        </h2>
        {pool.length > 1 && <script dangerouslySetInnerHTML={{ __html: headlinePickScript(pool) }} />}
        <ul className={cn("col-start-1 row-start-2 grid grid-cols-[auto_auto_minmax(0,1fr)] items-baseline gap-x-1.5 gap-y-1.5 sm:gap-x-2", stale && "opacity-60")}>
          {data.highlights.map((item) => (
            <li key={item.topic} className="contents" style={{ "--tone": TONES[item.topic] ?? TONES.coding } as CSSProperties}>
              <span className="size-2 self-center bg-(--tone)" aria-hidden />
              <span className="whitespace-nowrap text-lg font-semibold leading-none tabular-nums">{digestFigure(item)}</span>
              <span className="truncate text-sm text-muted-foreground">{item.caption}</span>
            </li>
          ))}
        </ul>
        <DayDial tracks={tracks} window={pulse?.window ?? null} now={now} timezone={timezone} offsetSeconds={offsetSeconds ?? 0} zoneLabel={abbreviation ?? formatUTCOffset(offsetSeconds ?? 0)} />
      </div>
    </Card>
  );
}
