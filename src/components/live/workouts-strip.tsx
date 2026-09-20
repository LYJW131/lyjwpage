"use client";

import { useEffect, useRef } from "react";
import { Bike, Dumbbell, Swords, Footprints } from "lucide-react";
import { useStatus } from "@/hooks/use-status";
import { useStale } from "@/hooks/use-stale";
import { STATUS_VIEWS } from "@/lib/status-views";
import { workoutMetrics } from "@/lib/workout-display";
import type { StatusResponse, Workout, WorkoutsPayload } from "@/lib/types";

function stamp(workout: Workout) {
  return new Date(workout.startedAt + workout.secondsFromGMT * 1000).toLocaleString("en-US", {
    timeZone: "UTC", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function WorkoutTile({ workout }: { workout: Workout }) {
  const Icon = workout.activityType === "Fencing" ? Swords : workout.activityType === "Cycling" ? Bike : workout.activityType === "Skating" ? Footprints : Dumbbell;
  const details = [
    workout.activeEnergyKcal == null ? null : `Active energy: ${Math.floor(workout.activeEnergyKcal)} kcal`,
    workout.elevationAscendedMeters == null ? null : `Elevation gain: ${workout.elevationAscendedMeters.toLocaleString("en-US", { maximumFractionDigits: 1 })} m`,
  ].filter(Boolean).join(" · ");
  return (
    <li className="flex min-w-0 snap-start items-center gap-4 px-4 py-3 lg:px-5 even:border-t even:border-line" title={details || undefined}>
      <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex items-baseline gap-2 leading-5"><span className="truncate text-sm font-medium leading-5">{workout.activityType}</span>{workout.indoor != null && <span className="text-[10px] text-muted-foreground">{workout.indoor ? "Indoor" : "Outdoor"}</span>}</div>
          <time dateTime={new Date(workout.startedAt).toISOString()} className="block text-[11px] leading-5 text-muted-foreground">{stamp(workout)}</time>
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs leading-5 tabular-nums">
          {workoutMetrics(workout).map(({ label, value }) => <div key={label} className="flex min-w-0 items-baseline gap-2"><dt className="text-[10px] text-muted-foreground">{label}</dt><dd className="whitespace-nowrap" title={label}>{value}</dd></div>)}
        </dl>
      </div>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-lime-400/10 text-lime-600 dark:text-lime-400"><Icon size={16} aria-hidden="true" /></span>
    </li>
  );
}

export function WorkoutsStrip({ fallback }: { fallback: StatusResponse<WorkoutsPayload> }) {
  const { data, error } = useStatus<WorkoutsPayload>(STATUS_VIEWS.workouts.path, 300_000, { fallback });
  const listRef = useRef<HTMLUListElement>(null);
  const items = data?.items.slice(0, 10) ?? [];
  // Preserve the visible pair when the card width changes.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let width = 0;
    let leading = 0;
    const rememberPosition = () => {
      const currentWidth = list.firstElementChild?.getBoundingClientRect().width ?? 0;
      if (width && Math.abs(currentWidth - width) < 0.5) leading = Math.round(list.scrollLeft / width);
    };
    const observer = new ResizeObserver(() => {
      width = list.firstElementChild?.getBoundingClientRect().width ?? 0;
      if (!width) return;
      leading = Math.min(leading, Math.max(0, Math.ceil(list.children.length / 2) - 1));
      list.scrollTo({ left: leading * width, behavior: "instant" });
    });
    list.addEventListener("scroll", rememberPosition, { passive: true });
    observer.observe(list);
    return () => {
      observer.disconnect();
      list.removeEventListener("scroll", rememberPosition);
    };
  }, [items.length]);
  const stale = useStale(data?.pushedAt, 7 * 86400_000);
  return (
    <section id="workouts" aria-label="Recent workouts" className="@container flex min-w-0 flex-col justify-center border-t border-line md:border-t-0 md:border-l">
      {!data ? (
        <p className="p-4 text-sm text-muted-foreground">{error ? "Workout history unavailable" : "Awaiting workout report"}</p>
      ) : data.items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No readable workouts</p>
      ) : (
        <ul ref={listRef} id="workout-list" aria-label="Recent workouts" tabIndex={0} className="grid h-[207px] lg:h-[215px] grid-flow-col grid-rows-2 auto-cols-[100%] overflow-x-auto scrollbar-none [&::-webkit-scrollbar]:hidden snap-x snap-mandatory">
          {items.map((workout) => <WorkoutTile key={workout.id} workout={workout} />)}
        </ul>
      )}
      {data && (stale || error) && <p className="border-t border-line p-4 text-xs lg:p-5 text-muted-foreground">Sync delayed · Last report {new Date(data.pushedAt).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })} (UTC)</p>}
    </section>
  );
}
