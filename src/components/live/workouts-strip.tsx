"use client";

import { useEffect, useRef } from "react";
import {
  Accessibility, Activity, Bike, Dumbbell, Footprints, HandFist, Kayak, Mountain, MountainSnow, PersonStanding, Sailboat, Swords, Volleyball, Waves,
  type LucideIcon,
} from "lucide-react";
import { useStatus } from "@/hooks/use-status";
import { gapCopy } from "@/lib/absence";
import { STATUS_VIEWS } from "@/lib/status-views";
import { workoutMetrics } from "@/lib/workout-display";
import type { StatusResponse, Workout, WorkoutsPayload } from "@/lib/types";

function stamp(workout: Workout) {
  return new Date(workout.startedAt + workout.secondsFromGMT * 1000).toLocaleString("en-US", {
    timeZone: "UTC", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

// 键是 iOS WorkoutsModule 上报的英文训练类型名；没有专门图标的落到 Activity，不冒充力量训练。
const WORKOUT_ICONS: Record<string, LucideIcon> = {
  Walking: Footprints, Running: Footprints, Hiking: Mountain,
  "Wheelchair Walk Pace": Accessibility, "Wheelchair Run Pace": Accessibility,
  Cycling: Bike, "Hand Cycling": Bike,
  Swimming: Waves, Surfing: Waves, "Water Fitness": Waves, "Water Polo": Waves, "Water Sports": Waves,
  Rowing: Kayak, "Paddle Sports": Kayak, Sailing: Sailboat,
  "Downhill Skiing": MountainSnow, "Cross-Country Skiing": MountainSnow, Snowboarding: MountainSnow, "Snow Sports": MountainSnow,
  Fencing: Swords,
  Boxing: HandFist, Kickboxing: HandFist, "Martial Arts": HandFist, Wrestling: HandFist,
  "Strength Training": Dumbbell, "Functional Strength": Dumbbell, "Core Training": Dumbbell, "Cross Training": Dumbbell,
  Yoga: PersonStanding, Pilates: PersonStanding, "Mind and Body": PersonStanding, "Tai Chi": PersonStanding, Flexibility: PersonStanding,
  Volleyball,
};

function WorkoutTile({ workout }: { workout: Workout }) {
  const Icon = Object.hasOwn(WORKOUT_ICONS, workout.activityType) ? WORKOUT_ICONS[workout.activityType] : Activity;
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
  const { data, error, isLoading, awaiting } = useStatus<WorkoutsPayload>(STATUS_VIEWS.workouts.path, { fallback });
  const listRef = useRef<HTMLUListElement>(null);
  const items = data?.items.slice(0, 10) ?? [];
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
  return (
    <section id="workouts" aria-label="Recent workouts" className="@container flex min-w-0 flex-col justify-center border-t border-line md:border-t-0 md:border-l">
      {!data ? (
        <p className="p-4 text-sm text-muted-foreground">{gapCopy({ loading: isLoading, awaiting, error })}</p>
      ) : data.items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No readable workouts</p>
      ) : (
        <ul ref={listRef} id="workout-list" aria-label="Recent workouts" tabIndex={0} className="grid h-[207px] lg:h-[215px] grid-flow-col grid-rows-2 auto-cols-[100%] overflow-x-auto scrollbar-none [&::-webkit-scrollbar]:hidden snap-x snap-mandatory">
          {items.map((workout) => <WorkoutTile key={workout.id} workout={workout} />)}
        </ul>
      )}
      {data && error && <p className="border-t border-line p-4 text-xs lg:p-5 text-muted-foreground">Sync delayed · Last report {new Date(data.pushedAt).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })} (UTC)</p>}
    </section>
  );
}
