"use client";

import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";
import useSWR from "swr";

import { Rings, ringValues } from "@/components/live/activity-card";
import { mediaApp, mergeVariants, playTime } from "@/components/live/playstation-card";
import { StatusDot } from "@/components/ui/status-dot";
import { useActivityCurrent, useLiveNowListening, useStale } from "@/hooks/use-stale";
import { appleArtwork, ARTWORK_SCALE, needsOptimizing } from "@/lib/apple-artwork";
import { formatClock } from "@/lib/clock-format";
import { ACTIVITY_STALE_MS } from "@/lib/freshness";
import { LISTENING_ELSEWHERE_HOLD_MS } from "@/lib/limits";
import { PLAYSTATION_IMAGE_SCALE, playstationImage } from "@/lib/playstation-image";
import { formatRelativeTime } from "@/lib/relative-time";
import { fetchStatus, guardPolled } from "@/lib/status-reads";
import { STATUS_VIEWS, type StatusViewKey } from "@/lib/status-views";
import { trackPositionMs } from "@/lib/track-position";
import type {
  ActivityPayload,
  ListeningPayload,
  NowListeningPayload,
  PlaystationPlayingPayload,
  PlaystationPresencePayload,
  StatusResponse,
  WorkoutsPayload,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { workoutMetrics } from "@/lib/workout-display";
import type { NowWatchingPayload, WatchingPayload } from "@shared/emby";
import type { GodChatCard } from "@shared/god-chat";

const TILE_PX = 80;
const HERO_PX = 96;
const HERO_WIDE_PX = 128;
const RECENT_LIMIT = 8;

const readStatus = async <T,>(path: string) => guardPolled(path, await fetchStatus<T>(path));

// 与首页卡片共用 SWR 键：首页已取到的数据直接拿来用，推送写进同一份缓存，卡片跟着更新；这里自己不轮询，缓存里没有才取一次。
function useCardView<T>(view: StatusViewKey) {
  const { data, error, isValidating } = useSWR<StatusResponse<T>>(STATUS_VIEWS[view].path, readStatus<T>, {
    revalidateIfStale: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
  });
  return {
    data: data?.ok ? data.data : undefined,
    updatedAt: data?.ok ? data.updatedAt : undefined,
    failed: Boolean(error) || data?.ok === false,
    validating: isValidating,
  };
}

function useNow(intervalMs: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs == null) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function ChatCard({ card }: { card: GodChatCard }) {
  switch (card) {
    case "nowListening":
      return <NowListeningCard />;
    case "listening":
      return <ListeningCard />;
    case "nowWatching":
      return <NowWatchingCard />;
    case "watching":
      return <WatchingCard />;
    case "playingNow":
      return <PlayingNowCard />;
    case "playing":
      return <PlayingCard />;
    case "activity":
      return <ActivityCard />;
    case "workouts":
      return <WorkoutsCard />;
  }
}

// 卡片按内容收缩，不铺满对话宽度；此刻卡的歌名专辑名可以很长，另设上限，超出就截断。
function Frame({ title, aside, compact = false, children }: { title: string; aside?: ReactNode; compact?: boolean; children: ReactNode }) {
  return (
    <section className={cn("w-fit min-w-[min(100%,20rem)] overflow-hidden border border-line bg-surface", compact ? "max-w-[min(100%,32rem)]" : "max-w-full")}>
      <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="label-mono text-[10px] text-muted-foreground">{title}</span>
        {aside && <span className="label-mono min-w-0 truncate text-[10px] text-muted-foreground">{aside}</span>}
      </header>
      {children}
    </section>
  );
}

function Placeholder({ failed, children }: { failed: boolean; children?: ReactNode }) {
  return (
    <div className={cn("px-3 py-3 text-xs text-muted-foreground", !failed && !children && "animate-pulse")}>
      {failed ? "Couldn't load this right now." : (children ?? "Loading…")}
    </div>
  );
}

function Idle({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-3">
      <StatusDot tone="off" />
      <span className="label-mono text-[10px] text-muted-foreground">{children}</span>
    </div>
  );
}

function Thumb({ src, optimize = false, wide = false, poster = false, px = wide ? HERO_WIDE_PX : TILE_PX }: { src: string | null; optimize?: boolean; wide?: boolean; poster?: boolean; px?: number }) {
  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden border border-line bg-muted",
        poster ? "aspect-[2/3] w-full" : wide ? "aspect-video w-32" : "aspect-square w-full",
      )}
    >
      {src && <Image src={src} alt="" fill sizes={`${px}px`} className="object-cover" unoptimized={!optimize} />}
    </div>
  );
}

function Hero({
  image,
  tone,
  status,
  title,
  subtitle,
  href,
  progress,
  meta,
}: {
  image: ReactNode;
  tone: "live" | "idle" | "off";
  status: string;
  title: string;
  subtitle?: string | null;
  href?: string | null;
  progress?: number | null;
  meta?: string | null;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-3">
      {image}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <StatusDot tone={tone} />
          <span className={cn("label-mono text-[10px]", tone === "live" ? "text-live" : "text-muted-foreground")}>{status}</span>
        </div>
        <div className="mt-1 truncate text-sm font-medium">
          {href ? (
            <a href={href} target="_blank" rel="noreferrer noopener" className="hover:underline">
              {title}
            </a>
          ) : (
            title
          )}
        </div>
        {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
        {progress != null && (
          <div className="mt-2 h-1 overflow-hidden bg-muted">
            <div className="h-full bg-foreground/60" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
          </div>
        )}
        {meta && <div className="mt-1 font-mono text-[10px] tabular-nums text-muted-foreground">{meta}</div>}
      </div>
    </div>
  );
}

function Strip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-line pt-2 [header+&]:border-t-0">
      <div className="label-mono px-3 text-[10px] text-muted-foreground">{label}</div>
      <ul className="scrollbar-none flex snap-x snap-mandatory scroll-px-3 gap-3 overflow-x-auto px-3 pb-3 pt-2 [&::-webkit-scrollbar]:hidden">
        {children}
      </ul>
    </div>
  );
}

function Tile({ href, image, title, subtitle, progress }: { href?: string | null; image: ReactNode; title: string; subtitle?: string | null; progress?: number | null }) {
  const body = (
    <>
      {image}
      {progress != null && (
        <div className="mt-1 h-0.5 overflow-hidden bg-muted">
          <div className="h-full bg-foreground/60" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </div>
      )}
      <div className="mt-1.5 truncate text-[11px] leading-tight">{title}</div>
      {subtitle && <div className="truncate text-[10px] leading-tight text-muted-foreground">{subtitle}</div>}
    </>
  );
  return (
    <li className="w-20 shrink-0 snap-start">
      {href ? (
        <a href={href} target="_blank" rel="noreferrer noopener" title={title} className="block hover:opacity-80">
          {body}
        </a>
      ) : (
        <div title={title}>{body}</div>
      )}
    </li>
  );
}

function artwork(url: string | null | undefined, px = TILE_PX) {
  return url ? { src: appleArtwork(url, px * ARTWORK_SCALE), px, optimize: needsOptimizing(url) } : { src: null };
}

function NowListeningCard() {
  const now = useCardView<NowListeningPayload>("nowListening");
  const live = useLiveNowListening(now.data, { validating: now.validating });
  const music = live && !live.idle ? live.music : null;
  const inferred = !music ? (live?.elsewhere ?? null) : null;
  const tick = useNow(music?.state === "playing" || inferred ? 1_000 : null);
  const elsewhere = inferred && tick < inferred.startedAt + inferred.durationMs + LISTENING_ELSEWHERE_HOLD_MS ? inferred : null;

  let body: ReactNode;
  if (music) {
    const position = trackPositionMs(music, tick);
    body = (
      <Hero
        image={<div className="w-24"><Thumb {...artwork(music.artworkUrl, HERO_PX)} /></div>}
        tone={music.state === "playing" ? "live" : "idle"}
        status={`${music.state === "playing" ? "Now playing" : "Paused"} · ${music.source === "homepod" ? "HomePod" : "Mac"}`}
        title={music.title ?? "Unknown track"}
        subtitle={[music.artist, music.album].filter(Boolean).join(" · ")}
        href={live?.link}
        progress={music.durationMs > 0 ? (position / music.durationMs) * 100 : null}
        meta={music.durationMs > 0 ? `${formatClock(position)} / ${formatClock(music.durationMs)}` : null}
      />
    );
  } else if (elsewhere) {
    const position = Math.min(elsewhere.durationMs, tick - elsewhere.startedAt);
    body = (
      <Hero
        image={<div className="w-24"><Thumb {...artwork(elsewhere.artworkUrl, HERO_PX)} /></div>}
        tone="live"
        status="Playing elsewhere"
        title={elsewhere.title}
        subtitle={[elsewhere.artist, elsewhere.album].filter(Boolean).join(" · ")}
        progress={(position / elsewhere.durationMs) * 100}
        meta={`~${formatClock(position)} / ${formatClock(elsewhere.durationMs)}`}
      />
    );
  } else if (live) {
    body = <Idle>Nothing playing right now</Idle>;
  } else {
    body = <Placeholder failed={now.failed} />;
  }

  return (
    <Frame compact title="Music" aside="Apple Music">
      {body}
    </Frame>
  );
}

function ListeningCard() {
  const recent = useCardView<ListeningPayload>("listening");
  const items = recent.data?.items.slice(0, RECENT_LIMIT);
  return (
    <Frame title="Music" aside="Apple Music">
      {items?.length ? (
        <Strip label="Recently played">
          {items.map((item) => (
            <Tile key={item.id} href={item.link} image={<Thumb {...artwork(item.artwork)} />} title={item.title} subtitle={item.artist} />
          ))}
        </Strip>
      ) : (
        <Placeholder failed={recent.failed}>{items ? "Nothing played recently." : undefined}</Placeholder>
      )}
    </Frame>
  );
}

function NowWatchingCard() {
  const now = useCardView<NowWatchingPayload>("nowWatching");
  const playing = now.data?.nowPlaying ?? null;
  const current = now.data?.current ?? null;
  const device = playing ? (playing.deviceName ?? playing.client) : null;

  return (
    <Frame compact title="Watching" aside="Emby">
      {playing ? (
        <Hero
          image={<Thumb src={current?.backdrop ?? current?.poster ?? null} wide />}
          tone={playing.paused ? "idle" : "live"}
          status={[playing.paused ? "Paused" : "Now playing", device].filter(Boolean).join(" · ")}
          title={current?.title ?? "Something on Emby"}
          subtitle={current?.subtitle}
          href={current?.link}
          progress={playing.positionMs != null && playing.durationMs ? (playing.positionMs / playing.durationMs) * 100 : (playing.progress ?? current?.progress ?? null)}
        />
      ) : now.data ? (
        <Idle>Nothing playing right now</Idle>
      ) : (
        <Placeholder failed={now.failed} />
      )}
    </Frame>
  );
}

function WatchingCard() {
  const recent = useCardView<WatchingPayload>("watching");
  const items = recent.data?.items.slice(0, RECENT_LIMIT);
  return (
    <Frame title="Watching" aside="Emby">
      {items?.length ? (
        <Strip label="Recently watched">
          {items.map((item) => (
            <Tile key={item.id} href={item.link} image={<Thumb src={item.poster} poster />} title={item.title} subtitle={item.subtitle} progress={item.progress || null} />
          ))}
        </Strip>
      ) : (
        <Placeholder failed={recent.failed}>{items ? "Nothing watched recently." : undefined}</Placeholder>
      )}
    </Frame>
  );
}

function recentGames(payload: PlaystationPlayingPayload | undefined) {
  return mergeVariants((payload?.items ?? []).filter((game) => !mediaApp(game.category)));
}

function PlayingNowCard() {
  const presence = useCardView<PlaystationPresencePayload>("playingNow");
  // 只借来补图标和游玩时长，没有它卡片照样画。
  const recent = useCardView<PlaystationPlayingPayload>("playing");
  const status = presence.data;
  const tick = useNow(status && !status.online ? 60_000 : null);
  const playingGame = status?.playing ? recentGames(recent.data).find((game) => game.titleIds.includes(status.playing!.titleId)) : undefined;

  let body: ReactNode;
  if (status?.playing) {
    body = (
      <Hero
        image={<div className="w-24"><Thumb src={playstationImage(status.playing.iconUrl ?? playingGame?.imageUrl, HERO_PX * PLAYSTATION_IMAGE_SCALE)} px={HERO_PX} /></div>}
        tone="live"
        status={`Playing · ${status.playing.launchPlatform ?? status.platform ?? "PlayStation"}`}
        title={status.playing.title}
        subtitle={playingGame ? playTime(playingGame.playDurationMs, playingGame.playCount) : null}
      />
    );
  } else if (status?.online) {
    body = <Idle>{`Online${status.platform ? ` · ${status.platform}` : ""} · not in a game`}</Idle>;
  } else if (status) {
    body = <Idle>{status.lastOnlineAt ? `Offline · last online ${formatRelativeTime(status.lastOnlineAt, tick)}` : "Offline"}</Idle>;
  } else {
    body = <Placeholder failed={presence.failed} />;
  }

  return (
    <Frame compact title="Gaming" aside="PlayStation">
      {body}
    </Frame>
  );
}

function PlayingCard() {
  const recent = useCardView<PlaystationPlayingPayload>("playing");
  const games = recent.data ? recentGames(recent.data).slice(0, RECENT_LIMIT) : undefined;
  return (
    <Frame title="Gaming" aside="PlayStation">
      {games?.length ? (
        <Strip label="Recently played">
          {games.map((game) => (
            <Tile
              key={game.titleId}
              image={<Thumb src={playstationImage(game.imageUrl, TILE_PX * PLAYSTATION_IMAGE_SCALE)} />}
              title={game.name}
              subtitle={playTime(game.playDurationMs, game.playCount)}
            />
          ))}
        </Strip>
      ) : (
        <Placeholder failed={recent.failed}>{games ? "No games played recently." : undefined}</Placeholder>
      )}
    </Frame>
  );
}

function ActivityCard() {
  const activity = useCardView<ActivityPayload>("activity");
  const stale = useStale(activity.updatedAt ?? activity.data?.pushedAt, ACTIVITY_STALE_MS);
  const data = stale ? undefined : activity.data;
  const current = useActivityCurrent(data);
  const rings = ringValues(data, current);

  return (
    <Frame title="Fitness" aside="Apple Watch">
      {data ? (
        <div className="flex items-center gap-4 px-3 py-3">
          <Rings rings={rings} className="size-20 shrink-0" />
          <dl className="grid min-w-0 flex-1 gap-1 text-xs">
            {rings.map((ring) => (
              <div key={ring.id} className="flex items-baseline justify-between gap-2">
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: `var(--activity-${ring.id})` }} />
                  {ring.label}
                </dt>
                <dd className="font-mono tabular-nums">
                  {Math.round(ring.value)}
                  <span className="text-muted-foreground">{` / ${ring.goal} ${ring.unit}`}</span>
                </dd>
              </div>
            ))}
            {current && data.steps != null && (
              <div className="flex items-baseline justify-between gap-2">
                <dt className="pl-3.5 text-muted-foreground">Steps</dt>
                <dd className="font-mono tabular-nums">{data.steps.toLocaleString("en-US")}</dd>
              </div>
            )}
          </dl>
        </div>
      ) : (
        <Placeholder failed={activity.failed}>{activity.data && stale ? "No recent activity reported." : undefined}</Placeholder>
      )}
    </Frame>
  );
}

function WorkoutsCard() {
  const workouts = useCardView<WorkoutsPayload>("workouts");
  const tick = useNow(60_000);
  const recent = workouts.data?.items.slice(0, 3);

  return (
    <Frame title="Fitness" aside="Apple Watch">
      {recent?.length ? (
        <div>
          <div className="label-mono px-3 pt-2 text-[10px] text-muted-foreground">Recent workouts</div>
          <ul className="px-3 pb-2">
            {recent.map((workout) => (
              <li key={workout.id} className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 text-xs last:border-b-0">
                <span className="min-w-0 truncate">
                  {workout.activityType}
                  <span className="text-muted-foreground"> · {formatRelativeTime(workout.startedAt, tick)}</span>
                </span>
                <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                  {workoutMetrics(workout).map(({ value }) => value).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Placeholder failed={workouts.failed}>{recent ? "No recent workouts." : undefined}</Placeholder>
      )}
    </Frame>
  );
}
