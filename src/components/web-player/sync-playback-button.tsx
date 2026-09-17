"use client";

import { ListMusic, LoaderCircle, Radio } from "lucide-react";

import type { WebPlayer } from "@/hooks/use-web-player";
import { cn } from "@/lib/utils";

/** 一起听只切换同步模式，授权、队列和播放均由 Web Player 管理。 */
export function SyncPlaybackButton({ player }: { player: WebPlayer }) {
  const connecting = player.syncing && player.status === "starting";
  const Icon = connecting ? LoaderCircle : player.syncing ? Radio : ListMusic;
  const label = player.syncing
    ? connecting ? "Syncing…" : player.syncWaiting ? "Waiting" : "Synced"
    : "Listen Along";
  const available = player.status !== "unavailable" && (player.syncAvailable || player.syncing);

  return (
    <button
      type="button"
      aria-pressed={player.syncing}
      aria-label={player.syncing ? "Stop syncing queue and position" : "Sync queue and position"}
      title={player.syncing
        ? "Stop syncing and play freely"
        : available ? "Listen along: sync the queue and position" : "Nothing to sync right now"}
      disabled={!available}
      onClick={player.toggleSync}
      className={cn(
        "label-mono inline-flex items-center gap-1.5 rounded-sm px-1 py-0.5 transition-colors hover:bg-surface-hover disabled:cursor-default disabled:opacity-40",
        player.syncing ? "text-live" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className={cn("size-3 shrink-0", connecting && "animate-spin")} aria-hidden />
      <span>{label}</span>
    </button>
  );
}
