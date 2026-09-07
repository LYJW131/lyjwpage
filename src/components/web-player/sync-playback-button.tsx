"use client";

import { ListMusic, LoaderCircle, Radio } from "lucide-react";

import type { WebPlayer } from "@/hooks/use-web-player";
import { cn } from "@/lib/utils";

/** 一起听只切换同步模式，授权、队列和播放均由 Web Player 管理。 */
export function SyncPlaybackButton({ player }: { player: WebPlayer }) {
  const connecting = player.syncing && player.status === "starting";
  const Icon = connecting ? LoaderCircle : player.syncing ? Radio : ListMusic;
  const label = player.syncing
    ? connecting ? "同步中…" : player.syncWaiting ? "等待播放" : "正在同步"
    : "一起听";
  const available = player.status !== "unavailable" && (player.syncAvailable || player.syncing);

  return (
    <button
      type="button"
      aria-pressed={player.syncing}
      aria-label={player.syncing ? "停止同步播放列表和进度" : "同步播放列表和进度"}
      title={player.syncing
        ? "停止同步，继续自由播放"
        : available ? "一起听：同步播放列表和进度" : "暂无可同步的歌曲"}
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
