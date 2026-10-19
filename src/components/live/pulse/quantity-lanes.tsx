import { BAND_TOP, LANE_HEIGHT, IdleLine, Rect, Tooltip, absolute, percent, pulseDuration, x, type LaneItem, type LaneModel, type Range } from "@/components/live/pulse/lane-geometry";
import { columnRows } from "@shared/pulse-columns";
import type { PulsePowerLane, PulseStepsLane, PulseTokensLane } from "@shared/types";

const POWER_SCALE_MIN_W = 20;

export function powerModel(lane: PulsePowerLane, range: Range): LaneModel | null {
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

export function tokensModel(lane: PulseTokensLane, range: Range): LaneModel | null {
  const buckets = columnRows(lane.buckets, ["total", "output", "cacheRead"]);
  if (!buckets || !lane.summary) return null;
  const rows = buckets.map((row) => {
    const { from, to } = absolute(range, row);
    const minutes = Math.max(1 / 60, (to - from) / 60_000);
    return { from, to, rate: row.total / minutes, output: row.output / minutes, cacheRead: row.cacheRead / minutes };
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
  const { peakPerMinute, currentPerMinute, totalTokens } = lane.summary;
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
        detail: currentPerMinute != null && currentPerMinute > 0 ? `now ${compactCount(currentPerMinute)}/min` : `${compactCount(totalTokens)} in 24h`,
      }
      : null,
    aria: "tokens per minute across coding agents, including cache reads",
  };
}

const STEPS_SCALE_MIN = 400;

export function stepsModel(lane: PulseStepsLane, range: Range, width: number): LaneModel | null {
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
      if (room < session.activityType.length * 6.1 + 6) return null;
      const left = (session.from - range.from) / Math.max(1, range.to - range.from) * width;
      const shift = Math.min(0, width - left - (session.activityType.length * 6.1 + 6));
      return (
        <span
          key={index}
          aria-hidden
          className="pointer-events-none absolute top-0.5 whitespace-nowrap bg-surface/85 px-0.5 text-[10px] font-medium leading-none text-foreground"
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
