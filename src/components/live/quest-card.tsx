"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import { DiscordConnectionIcon } from "@/components/live/discord-connection-icon";
import { Card } from "@/components/ui/card";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useMountedAt } from "@/hooks/use-mounted-at";
import { useStale } from "@/hooks/use-stale";
import { useStatus } from "@/hooks/use-status";
import { DISCORD_STALE_MS } from "@/lib/freshness";
import { DISCORD_PATH } from "@/lib/paths";
import { discordConnectionUrl, discordCreatedAt } from "@/lib/discord-profile";
import { discordGameUrl } from "@/lib/discord-game";
import type { DiscordNowPayload, DiscordPlaying, DiscordProfile, StatusResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 推送驱动；一分钟兜底，和 watching/now 对齐。 */
const REFRESH_MS = 60_000;
const COVER_PX = 80;

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function Elapsed({ startedAt }: { startedAt: number }) {
  const mountedAt = useMountedAt();
  const [now, setNow] = useState(0);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  const t = now || mountedAt;
  if (!t) return null;
  return (
    <span className="tabular-nums text-muted-foreground">{formatElapsed(t - startedAt)}</span>
  );
}

export function QuestCard({ fallback, className }: { fallback: StatusResponse<DiscordNowPayload>; className?: string }) {
  useLiveEvents();
  const status = useStatus<DiscordNowPayload>(DISCORD_PATH, REFRESH_MS, { fallback });
  const stale = useStale(
    status.data?.observedAt,
    status.data?.staleAfterMs ?? DISCORD_STALE_MS,
  );
  const unavailable = stale || Boolean(status.data?.staleAtSource);
  const playing = !unavailable && status.data?.playing ? status.data.playing : null;
  const href = playing ? discordGameUrl(playing.applicationId) : null;

  return (
    <Card
      id="quest"
      className={className}
      label="DISCORD"
      action="META QUEST"
    >
      {playing ? (
        href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="flex min-h-24 items-center gap-3 p-3 transition-colors hover:bg-surface-hover"
          >
            <PlayingBody playing={playing} />
          </a>
        ) : (
          <div className="flex min-h-24 items-center gap-3 p-3">
            <PlayingBody playing={playing} />
          </div>
        )
      ) : status.data?.profile ? (
        <ProfileBody profile={status.data.profile} unavailable={unavailable} />
      ) : (
        <div className="flex min-h-24 items-center px-3 text-sm text-muted-foreground">
          {!status.data ? "Waiting for Quest activity" : unavailable ? "Quest activity unavailable" : "Not playing"}
        </div>
      )}
    </Card>
  );
}

function PlayingBody({ playing }: { playing: DiscordPlaying }) {
  const cover = playing.largeImageUrl;

  return (
    <>
      <div
        className={cn(
          "relative shrink-0 overflow-hidden rounded-md border border-line bg-muted",
          "h-20 w-20",
        )}
      >
        {cover ? (
          <Image
            src={cover}
            alt=""
            width={COVER_PX}
            height={COVER_PX}
            unoptimized
            className="h-20 w-20 object-cover"
          />
        ) : (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">
            Quest 3
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium" title={playing.name}>
          {playing.name}
        </div>
        {playing.details ? (
          <div className="mt-0.5 truncate text-xs text-muted-foreground" title={playing.details}>
            {playing.details}
          </div>
        ) : null}
        {playing.startedAt != null ? (
          <div className="mt-1 text-xs">
            <Elapsed startedAt={playing.startedAt} />
          </div>
        ) : null}
      </div>
    </>
  );
}

function ProfileBody({ profile, unavailable }: { profile: DiscordProfile; unavailable: boolean }) {
  const createdAt = discordCreatedAt(profile.id);
  return (
    <div className="flex items-center">
    <a
      href={`https://discord.com/users/${profile.id}`}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={`View ${profile.displayName} on Discord`}
      className="flex min-h-24 min-w-0 flex-1 items-center gap-2 p-3 transition-colors hover:bg-surface-hover sm:gap-3"
    >
      {profile.avatarUrl ? (
        <Image src={profile.avatarUrl} alt="" width={80} height={80} unoptimized className="h-10 w-10 shrink-0 rounded-full sm:h-20 sm:w-20 border border-line object-cover" />
      ) : (
        <div className="grid h-10 w-10 shrink-0 sm:h-20 sm:w-20 place-items-center rounded-full border border-line bg-muted text-xl">{profile.displayName.slice(0, 1)}</div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{profile.displayName}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">@{profile.username}</div>
        {createdAt ? <div className="mt-1 text-xs text-muted-foreground">Member since {new Date(createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</div> : null}
        <div className="mt-1 text-xs text-muted-foreground">{unavailable ? "Game activity unavailable" : "Not playing"}</div>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground" aria-hidden="true">↗</span>
    </a>
    {profile.connections?.length ? (
      <div className="flex w-[42%] shrink-0 flex-wrap justify-end gap-1.5 px-3 py-2">
        {profile.connections.map((connection) => {
          const href = discordConnectionUrl(connection);
          const platform = ({ domain: "Website", github: "GitHub", playstation: "PlayStation", steam: "Steam", twitter: "X", youtube: "YouTube" } as Record<string, string>)[connection.type] ?? connection.type;
          const label = `${platform} · ${connection.name}`;
          const content = <><DiscordConnectionIcon type={connection.type} /><span className="truncate">{connection.name}</span></>;
          const style = "inline-flex items-center gap-1.5 max-w-full rounded border border-line px-2 py-1 text-[11px] text-muted-foreground";
          return href ? <a key={`${connection.type}:${connection.id}`} href={href} target="_blank" rel="noreferrer noopener" title={label} aria-label={label} className={`${style} transition-colors hover:bg-surface-hover hover:text-foreground`}>{content}<span aria-hidden="true">↗</span></a> : <span key={`${connection.type}:${connection.id}`} title={label} aria-label={label} className={style}>{content}</span>;
        })}
      </div>
    ) : null}
    </div>
  );
}
