"use client";

import { Pause, Play } from "lucide-react";

import { MINI_ARTWORK_PX, PlayerArtwork } from "@/components/web-player/player-artwork";
import { useWebPlayer } from "@/components/web-player/web-player-provider";
import { PLAYBACK_STATE } from "@/lib/musickit";

export function MiniPlayer() {
  const player = useWebPlayer();

  if (!player || !player.active || player.open) {
    return null;
  }

  const isPlaying = player.playbackState === PLAYBACK_STATE.playing;

  return (
    <div className="paper-card flex size-8 items-center overflow-hidden rounded-md border border-line-strong bg-surface p-0 sm:h-8 sm:w-auto sm:gap-1 sm:p-1">
      <button
        type="button"
        aria-label="Open player"
        onClick={() => {
          if (player.activeItem) {
            player.openWith(player.activeItem);
          } else {
            player.openDialog();
          }
        }}
        className="flex size-full items-center justify-center overflow-hidden transition-opacity hover:opacity-80 sm:size-6 sm:rounded-sm"
      >
        <PlayerArtwork
          artwork={(player.activeItem ?? player.item)?.artworkUrl ?? null}
          size={MINI_ARTWORK_PX}
          className="size-full sm:size-6 sm:rounded-sm"
        />
      </button>

      <button
        type="button"
        aria-label={isPlaying ? "Pause" : "Play"}
        onClick={player.toggle}
        className="hidden p-1 text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
      >
        {isPlaying ? (
          <Pause className="size-4" aria-hidden />
        ) : (
          <Play className="size-4" aria-hidden />
        )}
      </button>
    </div>
  );
}
