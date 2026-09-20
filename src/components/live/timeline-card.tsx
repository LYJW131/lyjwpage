"use client";

import { AppWindow, Code2, Dumbbell, Gamepad2, Headphones, Trophy, Tv } from "lucide-react";
import Image from "next/image";
import { useMemo, type ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-dot";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useMountedAt } from "@/hooks/use-mounted-at";
import { useStatus } from "@/hooks/use-status";
import { appleArtwork, ARTWORK_SCALE, needsOptimizing } from "@/lib/apple-artwork";
import type { NowWatchingPayload, WatchingPayload } from "@/lib/emby";
import {
  DESKTOP_PATH,
  NOW_LISTENING_PATH,
  NOW_PLAYING_PATH,
  NOW_WATCHING_PATH,
  PLAYING_PATH,
  VIBECODING_PATH,
  WATCHING_PATH,
  WORKOUTS_PATH,
} from "@/lib/paths";
import { playstationImage } from "@/lib/playstation-image";
import {
  buildTimeline,
  formatTimelineClock,
  groupTimelineDays,
  timelineSourceNames,
  TIMELINE_SOURCE_LABEL,
  type TimelineEvent,
  type TimelineSource,
} from "@/lib/timeline";
import type {
  DesktopPayload,
  NowListeningPayload,
  PlaystationPlayingPayload,
  PlaystationPresencePayload,
  StatusResponse,
  TrophiesSummaryPayload,
  VibeCodingPayload,
  WorkoutsPayload,
} from "@/lib/types";
import { fetchVibeCoding, seedVibeCoding } from "@/lib/vibecoding-activity";
import { cn } from "@/lib/utils";

const LIST_REFRESH_MS = 10 * 60_000;
const NOW_REFRESH_MS = 60_000;
const WORKOUT_REFRESH_MS = 5 * 60_000;
const VIBE_REFRESH_MS = 2 * 60_000;
const THUMB_PX = 40;

const SOURCE_ICON: Record<TimelineSource, typeof Headphones> = {
  listening: Headphones,
  watching: Tv,
  playing: Gamepad2,
  trophy: Trophy,
  workout: Dumbbell,
  coding: Code2,
  desktop: AppWindow,
};

function thumbSrc(event: TimelineEvent): string | null {
  const url = event.imageUrl;
  if (!url) return null;
  if (event.source === "listening") return appleArtwork(url, THUMB_PX * ARTWORK_SCALE);
  if (event.source === "playing" || event.source === "trophy") return playstationImage(url, THUMB_PX);
  return url;
}

function TimelineThumb({ event }: { event: TimelineEvent }) {
  const src = thumbSrc(event);
  const Icon = SOURCE_ICON[event.source];
  if (!src) {
    return (
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-line bg-muted text-muted-foreground">
        <Icon size={16} aria-hidden />
      </span>
    );
  }
  return (
    <span className="relative size-10 shrink-0 overflow-hidden rounded-md border border-line bg-muted">
      <Image
        src={src}
        alt=""
        width={THUMB_PX}
        height={THUMB_PX}
        className="size-10 object-cover"
        unoptimized={!needsOptimizing(src)}
      />
    </span>
  );
}

function EventTime({ event }: { event: TimelineEvent }) {
  if (event.live) {
    return (
      <span className="flex items-center gap-1.5">
        <StatusDot tone={event.paused ? "idle" : "live"} />
        <span>{event.paused ? "Paused" : "Now"}</span>
      </span>
    );
  }
  return <time dateTime={new Date(event.atMs).toISOString()}>{formatTimelineClock(event.atMs)}</time>;
}

function EventRow({ event }: { event: TimelineEvent }) {
  const title = event.href ? (
    <a
      href={event.href}
      target="_blank"
      rel="noreferrer noopener"
      className="truncate font-medium hover:underline"
    >
      {event.title}
    </a>
  ) : (
    <span className="truncate font-medium">{event.title}</span>
  );

  return (
    <li className="flex h-14 snap-start items-center gap-3 px-3 sm:px-4">
      <div className="label-mono w-[4.75rem] shrink-0 text-muted-foreground">
        <EventTime event={event} />
      </div>
      <TimelineThumb event={event} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2 text-sm leading-5">
          {title}
        </div>
        {event.summary ? (
          <div className="truncate text-xs leading-5 text-muted-foreground" title={event.summary}>
            {event.summary}
          </div>
        ) : null}
      </div>
      <span className="label-mono hidden shrink-0 text-muted-foreground sm:block">
        {TIMELINE_SOURCE_LABEL[event.source]}
      </span>
    </li>
  );
}

export function TimelineCard({
  nowListeningFallback,
  watchingFallback,
  nowWatchingFallback,
  playingFallback,
  playingNowFallback,
  trophiesFallback,
  workoutsFallback,
  vibeCodingFallback,
  desktopFallback,
  className,
}: {
  nowListeningFallback: StatusResponse<NowListeningPayload>;
  watchingFallback: StatusResponse<WatchingPayload>;
  nowWatchingFallback: StatusResponse<NowWatchingPayload>;
  playingFallback: StatusResponse<PlaystationPlayingPayload>;
  playingNowFallback: StatusResponse<PlaystationPresencePayload>;
  trophiesFallback: StatusResponse<TrophiesSummaryPayload>;
  workoutsFallback: StatusResponse<WorkoutsPayload>;
  vibeCodingFallback: StatusResponse<VibeCodingPayload>;
  desktopFallback: StatusResponse<DesktopPayload>;
  className?: string;
}) {
  useLiveEvents();
  const mountedAt = useMountedAt();

  const { data: nowListening } = useStatus<NowListeningPayload>(NOW_LISTENING_PATH, NOW_REFRESH_MS, {
    fallback: nowListeningFallback,
  });
  const { data: watching } = useStatus<WatchingPayload>(WATCHING_PATH, LIST_REFRESH_MS, {
    fallback: watchingFallback,
  });
  const { data: nowWatching } = useStatus<NowWatchingPayload>(NOW_WATCHING_PATH, NOW_REFRESH_MS, {
    fallback: nowWatchingFallback,
  });
  const { data: playing } = useStatus<PlaystationPlayingPayload>(PLAYING_PATH, LIST_REFRESH_MS, {
    fallback: playingFallback,
  });
  const { data: playingNow } = useStatus<PlaystationPresencePayload>(NOW_PLAYING_PATH, NOW_REFRESH_MS, {
    fallback: playingNowFallback,
  });
  const { data: workouts } = useStatus<WorkoutsPayload>(WORKOUTS_PATH, WORKOUT_REFRESH_MS, {
    fallback: workoutsFallback,
  });
  const { data: vibeCoding } = useStatus<VibeCodingPayload>(VIBECODING_PATH, VIBE_REFRESH_MS, {
    fallback: vibeCodingFallback,
    fetcher: fetchVibeCoding,
    seedFallback: seedVibeCoding,
  });
  const { data: desktop } = useStatus<DesktopPayload>(DESKTOP_PATH, NOW_REFRESH_MS, {
    fallback: desktopFallback,
  });

  const trophies = trophiesFallback.ok ? trophiesFallback.data : null;

  const events = useMemo(
    () =>
      buildTimeline(
        {
          nowListening,
          watching,
          nowWatching,
          playing,
          playingNow,
          trophies,
          workouts,
          vibeCoding,
          desktop,
        },
        mountedAt,
      ),
    [nowListening, watching, nowWatching, playing, playingNow, trophies, workouts, vibeCoding, desktop, mountedAt],
  );
  const days = useMemo(() => groupTimelineDays(events, mountedAt), [events, mountedAt]);
  const sources = timelineSourceNames(events);

  let body: ReactNode;
  if (days.length === 0) {
    body = (
      <p className="px-4 py-8 text-sm text-muted-foreground">
        No dated activity yet. Apple Music recent plays have no timestamps, so only what is playing
        now appears here.
      </p>
    );
  } else {
    body = (
      <div
        tabIndex={0}
        role="region"
        aria-label="Activity timeline"
        className="max-h-[28rem] snap-y snap-mandatory overflow-y-auto overscroll-y-contain scrollbar-none [&::-webkit-scrollbar]:hidden"
      >
        {days.map((day) => (
          <section key={day.key} aria-labelledby={`timeline-${day.key}`}>
            <h4
              id={`timeline-${day.key}`}
              className="sticky top-0 z-10 flex h-8 snap-start items-center border-b border-line bg-muted px-3 label-mono text-muted-foreground sm:px-4"
            >
              {day.label}
            </h4>
            <ol className="divide-y divide-line">
              {day.events.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </ol>
          </section>
        ))}
      </div>
    );
  }

  return (
    <Card
      id="timeline"
      label="Timeline"
      action={sources.length ? sources.join(" · ") : "Recent activity"}
      className={cn("scroll-mt-28", className)}
    >
      {body}
    </Card>
  );
}
