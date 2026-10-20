"use client";
import { useEffect, useState, type ReactNode } from "react";
import useSWR from "swr";

import { Entering, Frame, HERO_PX, Hero, Idle, Placeholder, Strip, Thumb, Tile, artwork, clock, gameCover, posterImage } from "@/components/chat-card/layout";
import { Rings, ringValues } from "@/components/live/activity-card";
import { mediaApp, mergeVariants, playedFor, playTime } from "@/components/live/playstation-card";
import { TrophyMetal, trophyTypeLabel } from "@/components/trophies/trophy-metal";
import { useLiveNowListening, useStale } from "@/hooks/use-stale";
import { ACTIVITY_STALE_MS } from "@shared/freshness";
import { LISTENING_ELSEWHERE_HOLD_MS } from "@shared/limits";
import { PLAYSTATION_IMAGE_SCALE, playstationImage } from "@/lib/playstation-image";
import { formatRelativeTime } from "@/lib/relative-time";
import { fetchStatus, guardPolled } from "@/lib/status-reads";
import { STATUS_VIEWS, type StatusViewKey } from "@shared/status-views";
import { trackPositionMs } from "@/lib/track-position";
import type {
  ActivityPayload,
  TrophiesSummaryPayload,
  ListeningPayload,
  NowListeningPayload,
  PlaystationPlayingPayload,
  PlaystationPresencePayload,
  StatusResponse,
  WorkoutsPayload,
} from "@shared/types";
import { cn } from "@/lib/utils";
import { workoutMetrics } from "@/lib/workout-display";
import type { NowWatchingPayload, WatchingPayload } from "@shared/emby";
import { TROPHY_TYPES } from "@shared/playstation-types";
import type { GodChatCard } from "@shared/god-chat";
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

// entering 只看挂载那一刻：流式中新到的卡片淡入、条目依次跟上；回复随后结束也不摘动画，免得还没轮到的条目一下子跳出来。
export function ChatCard({ card, game, entering = false }: { card: GodChatCard; game?: string; entering?: boolean }) {
  const [animate] = useState(entering);
  return (
    <div className={cn(animate && "animate-headline-in")}>
      <Entering.Provider value={animate}>{cardBody(card, game)}</Entering.Provider>
    </div>
  );
}

function cardBody(card: GodChatCard, game?: string) {
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
    case "game":
      return <GameCard titleId={game} />;
  }
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
        meta={music.durationMs > 0 ? `${clock(position)} / ${clock(music.durationMs)}` : null}
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
        meta={`~${clock(position)} / ${clock(elsewhere.durationMs)}`}
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
    <Frame>
      {items?.length ? (
        <Strip label="Recently played">
          {items.map((item, index) => (
            <Tile key={item.id} index={index} href={item.link} image={<Thumb {...artwork(item.artwork)} />} title={item.title} subtitle={item.artist} />
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
    <Frame>
      {items?.length ? (
        <Strip label="Recently watched">
          {items.map((item, index) => (
            <Tile key={item.id} index={index} href={item.link} image={<Thumb {...posterImage(item.poster)} poster progress={item.progress || null} />} title={item.title} subtitle={item.subtitle} />
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
  // 奖杯摘要只用来给白金游戏换边框，没取到就都按普通边框画。
  const trophies = useCardView<TrophiesSummaryPayload>("trophies");
  const platinum = new Set((trophies.data?.titles ?? []).filter((title) => title.earned.platinum > 0).flatMap((title) => title.titleIds));
  const games = recent.data ? recentGames(recent.data).slice(0, RECENT_LIMIT) : undefined;
  return (
    <Frame>
      {games?.length ? (
        <Strip label="Recently played">
          {games.map((game, index) => (
            <Tile
              key={game.titleId}
              index={index}
              image={<Thumb {...gameCover(game.imageUrl)} platinum={game.titleIds.some((id) => platinum.has(id))} />}
              title={game.name}
              subtitle={game.playDurationMs == null ? null : playedFor(game.playDurationMs)}
            />
          ))}
        </Strip>
      ) : (
        <Placeholder failed={recent.failed}>{games ? "No games played recently." : undefined}</Placeholder>
      )}
    </Frame>
  );
}

function GameCard({ titleId }: { titleId?: string }) {
  const recent = useCardView<PlaystationPlayingPayload>("playing");
  const trophies = useCardView<TrophiesSummaryPayload>("trophies");
  const game = titleId ? recentGames(recent.data).find((candidate) => candidate.titleIds.includes(titleId)) : undefined;
  const tick = useNow(60_000);
  const notStarted = game ? game.preOrder && game.playCount === 0 && game.playDurationMs == null : false;
  const title = game && trophies.data?.titles.find((candidate) => candidate.titleIds.some((id) => game.titleIds.includes(id)));

  return (
    <Frame compact title="Gaming" aside="PlayStation">
      {game ? (
        <>
          <Hero
            image={<div className="w-20 sm:w-24"><Thumb {...gameCover(game.imageUrl)} px={HERO_PX} platinum={Boolean(title?.earned.platinum)} /></div>}
            tone="off"
            status={notStarted ? "Pre-ordered" : game.lastPlayedAt ? `Played ${formatRelativeTime(game.lastPlayedAt, tick).replace(/^on /, "")}` : "Played"}
            title={game.name}
            subtitle={notStarted ? "Not started" : [playTime(game.playDurationMs, game.playCount), game.playDurationMs != null && `${game.playCount} ${game.playCount === 1 ? "session" : "sessions"}`].filter(Boolean).join(" · ")}
            progress={title ? title.progress : null}
            meta={title ? `${title.progress}% trophies` : null}
          />
          {title && (
            <ul className="flex justify-between gap-2 border-t border-line px-3 py-2">
              {TROPHY_TYPES.filter((type) => title.defined[type] > 0).map((type) => (
                <li key={type} className="flex items-center gap-1.5 whitespace-nowrap" title={trophyTypeLabel(type)}>
                  <TrophyMetal kind={type} size="sm" />
                  <span className="font-mono text-xs tabular-nums">
                    {title.earned[type]}
                    <span className="text-muted-foreground">{`/${title.defined[type]}`}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <Placeholder failed={recent.failed}>{recent.data ? "This game isn't in the play history." : undefined}</Placeholder>
      )}
    </Frame>
  );
}

function ActivityCard() {
  const activity = useCardView<ActivityPayload>("activity");
  const stale = useStale(activity.updatedAt ?? activity.data?.pushedAt, ACTIVITY_STALE_MS);
  const data = stale ? undefined : activity.data;
  const current = Boolean(data?.currentAtSource);
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
          <div className="label-mono px-3 pt-2 text-muted-foreground">Recent workouts</div>
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
