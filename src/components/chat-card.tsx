"use client";

import { FadeInImage } from "@/components/fade-in-image";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import useSWR from "swr";

import { Rings, ringValues } from "@/components/live/activity-card";
import { COVER_PX as PLAYSTATION_COVER_PX, mediaApp, mergeVariants, playedFor, playTime } from "@/components/live/playstation-card";
import { StatusDot } from "@/components/ui/status-dot";
import { useLiveNowListening, useStale } from "@/hooks/use-stale";
import { appleArtwork, ARTWORK_SCALE, needsOptimizing, TRACK_ROW_ART_PX } from "@/lib/apple-artwork";
import { imageSourceFromInternalPath, optimizerImagePath } from "@/lib/image-proxy";
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
import type { GodChatCard } from "@shared/god-chat";

const TILE_PX = 80;
const HERO_PX = 96;
const HERO_WIDE_PX = 128;
const RECENT_LIMIT = 8;
// 流式中新到的卡片里，条目按这个间隔依次淡入；八项约半秒排完。
const TILE_STAGGER_MS = 60;

const Entering = createContext(false);

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
export function ChatCard({ card, entering = false }: { card: GodChatCard; entering?: boolean }) {
  const [animate] = useState(entering);
  return (
    <div className={cn(animate && "animate-headline-in")}>
      <Entering.Provider value={animate}>{cardBody(card)}</Entering.Provider>
    </div>
  );
}

function cardBody(card: GodChatCard) {
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
// 只有一排「最近」条目的卡片不带标题栏：条目排自己的小标题已经说明是什么。
function Frame({ title, aside, compact = false, children }: { title?: string; aside?: ReactNode; compact?: boolean; children: ReactNode }) {
  return (
    <section className={cn("w-fit min-w-[min(100%,20rem)] overflow-hidden border border-line bg-surface", compact ? "max-w-[min(100%,32rem)]" : "max-w-full")}>
      {title && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <span className="label-mono text-muted-foreground">{title}</span>
          {aside && <span className="label-mono min-w-0 truncate text-muted-foreground">{aside}</span>}
        </header>
      )}
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
      <span className="label-mono text-muted-foreground">{children}</span>
    </div>
  );
}

// 封面先垫一张模糊的低清图（首页同尺寸的图或几十像素的小图，多半已在缓存或很快到），高清图加载完再淡入盖上。
// progress 把封面外框从左上角起顺时针逐段换成绿色，换了多长就是看了多少；不另占一行，有进度和没进度的条目文字对得齐。
function Thumb({ src, preview, progress, platinum = false, optimize = false, wide = false, poster = false, px = wide ? HERO_WIDE_PX : TILE_PX }: { src: string | null; preview?: string | null; progress?: number | null; platinum?: boolean; optimize?: boolean; wide?: boolean; poster?: boolean; px?: number }) {
  return (
    <div
      title={platinum ? "Platinum earned" : undefined}
      className={cn(
        "relative shrink-0 bg-muted",
        platinum ? "platinum-frame" : "border border-line",
        poster ? "aspect-[2/3] w-full" : wide ? "aspect-video w-32" : "aspect-square w-full",
      )}
    >
      <div className="absolute inset-0 overflow-hidden">
        {preview && preview !== src && <FadeInImage src={preview} alt="" aria-hidden fill sizes={`${px}px`} className="scale-110 object-cover blur-md" unoptimized />}
        {src && <FadeInImage src={src} alt="" fill sizes={`${px}px`} className="object-cover" unoptimized={!optimize} />}
      </div>
      {/* 描边层铺满外框所在的盒子，2px 描边以盒子边缘为中线、外侧一半被 svg 自身裁掉，只剩正好压住 1px 外框的那一半：外框本身逐段变色，宽度不变。 */}
      {progress != null && progress > 0 && (
        <div aria-hidden className="pointer-events-none absolute -inset-px">
          <svg className="size-full text-signal-green">
            <rect width="100%" height="100%" pathLength={100} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray={`${Math.min(100, progress)} 100`} />
          </svg>
        </div>
      )}
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
          <span className={cn("label-mono", tone === "live" ? "text-live-ink" : "text-muted-foreground")}>{status}</span>
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
        <ProgressBar percent={progress} className="mt-2 h-1" />
        {meta && <div className="mt-1 font-mono text-2xs tabular-nums text-muted-foreground">{meta}</div>}
      </div>
    </div>
  );
}

function ProgressBar({ percent, className }: { percent?: number | null; className: string }) {
  if (percent == null) return null;
  return (
    <div className={cn(className, "overflow-hidden bg-muted")}>
      <div className="h-full bg-foreground/60" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}

function Strip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-line pt-2 first:border-t-0 [header+&]:border-t-0">
      <div className="label-mono px-3 text-muted-foreground">{label}</div>
      <ul className="scrollbar-none flex snap-x snap-mandatory scroll-px-3 gap-3 overflow-x-auto px-3 pb-3 pt-2 [&::-webkit-scrollbar]:hidden">
        {children}
      </ul>
    </div>
  );
}

function Tile({ index, href, image, title, subtitle }: { index: number; href?: string | null; image: ReactNode; title: string; subtitle?: string | null }) {
  const entering = useContext(Entering);
  const body = (
    <>
      {image}
      <div className="mt-1.5 truncate text-2xs leading-tight">{title}</div>
      {subtitle && <div className="truncate text-2xs leading-tight text-muted-foreground">{subtitle}</div>}
    </>
  );
  return (
    <li className={cn("w-20 shrink-0 snap-start", entering && "animate-headline-in")} style={entering ? { animationDelay: `${index * TILE_STAGGER_MS}ms` } : undefined}>
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

function clock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function artwork(url: string | null | undefined, px = TILE_PX) {
  if (!url) return { src: null };
  const optimize = needsOptimizing(url);
  return { src: appleArtwork(url, px * ARTWORK_SCALE), preview: optimize ? null : appleArtwork(url, TRACK_ROW_ART_PX * ARTWORK_SCALE), px, optimize };
}

// R2 里的海报经图片变体出小图，不拉原图；变体按内容哈希永久缓存。
const POSTER_WIDTH = 240;
const PREVIEW_WIDTH = 32;

function posterImage(url: string | null | undefined) {
  if (!url || !imageSourceFromInternalPath(url)) return { src: url ?? null };
  return { src: optimizerImagePath(url, POSTER_WIDTH, 75), preview: optimizerImagePath(url, PREVIEW_WIDTH, 50) };
}

// 首页游戏卡同尺寸的封面多半已在缓存；比对话里的格子大，直接当正式图用。
function gameCover(url: string | null | undefined) {
  return { src: playstationImage(url, PLAYSTATION_COVER_PX * PLAYSTATION_IMAGE_SCALE), preview: playstationImage(url, PREVIEW_WIDTH) };
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
