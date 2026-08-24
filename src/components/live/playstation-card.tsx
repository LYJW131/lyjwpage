"use client";

import Image from "next/image";

import { Card } from "@/components/ui/card";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useStatus } from "@/hooks/use-status";
import { NOW_PLAYING_PATH, PLAYING_PATH } from "@/lib/paths";
import type {
  PlaystationGame,
  PlaystationPlayingPayload,
  PlaystationPresencePayload,
  StatusResponse,
} from "@/lib/types";

/** 实时性由 playing / playing-now 推送负责；轮询只兜推送整体停用。 */
const REFRESH_MS = 10 * 60_000;

function mediaApp(game: PlaystationGame): boolean {
  return game.category?.endsWith("_media_app") === true;
}

function playTime(milliseconds: number | null, playCount: number): string {
  if (milliseconds == null) return `游玩 ${playCount} 次`;
  const hours = milliseconds / 3_600_000;
  if (hours >= 10) return `累计 ${Math.round(hours)} 小时`;
  if (hours >= 1) return `累计 ${hours.toFixed(1).replace(/\.0$/, "")} 小时`;
  return `累计 ${Math.max(1, Math.round(milliseconds / 60_000))} 分钟`;
}

function Cover({
  src,
  alt,
  sizes,
  className,
}: {
  src: string | null;
  alt: string;
  sizes: string;
  className?: string;
}) {
  return (
    <div className={`relative overflow-hidden bg-muted ${className ?? ""}`}>
      {src ? (
        <Image src={src} alt={alt} fill sizes={sizes} className="object-cover" />
      ) : (
        <div className="label-mono flex h-full items-center justify-center text-muted-foreground">
          PS
        </div>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <Card label="PLAYSTATION" action="PSN" className="md:col-span-2">
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 lg:grid-cols-8">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="overflow-hidden rounded-md border border-line">
            <div className="aspect-square animate-pulse bg-muted" />
            <div className="space-y-2 p-2.5">
              <div className="h-3 animate-pulse rounded bg-muted" />
              <div className="h-2.5 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RecentGame({ game }: { game: PlaystationGame }) {
  return (
    <div className="group min-w-0 overflow-hidden rounded-md border border-line bg-background">
      <Cover
        src={game.imageUrl}
        alt={game.name}
        sizes="(min-width: 1024px) 112px, (min-width: 640px) 22vw, 44vw"
        className="aspect-square"
      />
      <div className="min-w-0 border-t border-line px-2.5 py-2">
        <div className="truncate text-xs font-medium" title={game.name}>
          {game.name}
        </div>
        <div className="mt-1 truncate text-[0.6875rem] text-muted-foreground">
          {playTime(game.playDurationMs, game.playCount)}
        </div>
      </div>
    </div>
  );
}

export function PlaystationCard({
  fallback,
  nowFallback,
}: {
  fallback: StatusResponse<PlaystationPlayingPayload>;
  nowFallback: StatusResponse<PlaystationPresencePayload>;
}) {
  useLiveEvents();
  const list = useStatus<PlaystationPlayingPayload>(PLAYING_PATH, REFRESH_MS, { fallback });
  const presence = useStatus<PlaystationPresencePayload>(NOW_PLAYING_PATH, REFRESH_MS, {
    fallback: nowFallback,
  });

  if (list.isLoading && presence.isLoading && !list.data && !presence.data) {
    return <Skeleton />;
  }

  const visibleGames = (list.data?.items ?? []).filter((game) => !mediaApp(game));
  const rawPlaying = presence.data?.playing ?? null;
  const playingCategory = rawPlaying
    ? list.data?.items.find((game) => game.titleId === rawPlaying.titleId)?.category
    : null;
  // presence 本身没有 category；用最近列表里同 titleId 的上游枚举挡掉媒体应用。
  const playing =
    rawPlaying && !playingCategory?.endsWith("_media_app") ? rawPlaying : null;
  const recent = visibleGames
    .filter((game) => game.titleId !== playing?.titleId)
    .slice(0, playing ? 6 : 8);
  const platform = playing?.launchPlatform ?? playing?.format ?? presence.data?.platform;
  const tone = playing ? "live" : presence.data?.online ? "idle" : "off";

  return (
    <Card
      id="playing"
      label="PLAYSTATION"
      tone={tone}
      action={platform ?? "PSN"}
      className="md:col-span-2"
    >
      {!list.data && !presence.data ? (
        <div className="m-4 flex min-h-32 items-center justify-center rounded-md border border-dashed border-line px-4 text-center text-sm text-muted-foreground">
          还没收到 PlayStation 遥测
        </div>
      ) : (
        <>
          {playing && (
            <div className="flex min-w-0 gap-4 p-4 sm:items-center">
              <Cover
                src={playing.iconUrl}
                alt={playing.title}
                sizes="(min-width: 640px) 144px, 112px"
                className="h-28 w-28 shrink-0 rounded-md border border-line sm:h-36 sm:w-36"
              />
              <div className="min-w-0">
                <div className="label-mono mb-2 text-live">正在玩</div>
                <h3 className="text-balance text-lg font-medium sm:text-2xl">{playing.title}</h3>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {platform && (
                    <span className="label-mono border border-line-strong bg-muted px-2 py-1 text-foreground">
                      {platform}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {presence.data?.online ? "PlayStation 在线" : "游戏仍在运行"}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className={playing ? "border-t border-line p-4" : "p-4"}>
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-sm font-medium">{playing ? "最近还玩过" : "最近在玩"}</h3>
              <span className="label-mono text-muted-foreground">
                {presence.data?.online ? "ONLINE" : "OFFLINE"}
              </span>
            </div>
            {recent.length ? (
              <div
                className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${
                  playing ? "lg:grid-cols-6" : "lg:grid-cols-8"
                }`}
              >
                {recent.map((game) => (
                  <RecentGame key={game.titleId} game={game} />
                ))}
              </div>
            ) : (
              <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed border-line text-sm text-muted-foreground">
                最近没有游戏记录
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
