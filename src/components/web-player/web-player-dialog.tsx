"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ExternalLink, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";

import { SyncPlaybackButton } from "@/components/web-player/sync-playback-button";
import { Modal } from "@/components/ui/modal";
import { PlayerCover } from "@/components/web-player/player-cover";
import { PlayerLyrics } from "@/components/web-player/player-lyrics";
import type { WebPlayer } from "@/hooks/use-web-player";
import { PLAYBACK_STATE } from "@/lib/musickit";
import { catalogItemId } from "@/lib/playing-queue";
import { cn } from "@/lib/utils";
import {
  formatClock,
  playlistScrollportHeight,
  PLAYLIST_MAX_VISIBLE_ROWS,
  queueOptionsFor,
} from "@/lib/web-player";

function DialogButton({ children, onClick, disabled }: {
  children: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="label-mono min-w-0 flex-1 py-2.5 text-center text-foreground transition-colors hover:bg-surface-hover disabled:cursor-default disabled:opacity-60"
    >
      {children}
    </button>
  );
}

const SEEK_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

function usePlaylistSnap(albumId: string | null | undefined) {
  const node = useRef<HTMLDivElement | null>(null);
  const previous = useRef(albumId);

  useEffect(() => {
    if (previous.current === albumId) return;
    previous.current = albumId;

    const el = node.current;
    if (!el || el.scrollTop === 0) return;
    const saved = el.style.scrollBehavior;
    el.style.scrollBehavior = "auto";
    el.scrollTop = 0;
    el.style.scrollBehavior = saved;
  }, [albumId]);

  return useCallback((el: HTMLDivElement | null) => {
    node.current = el;
  }, []);
}

export function WebPlayerDialog({ player }: { player: WebPlayer }) {
  const titleId = useId();
  const listRef = usePlaylistSnap(player.item?.id);
  const [activePositionMs, setActivePositionMs] = useState(0);
  const [activeDurationMs, setActiveDurationMs] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [seekEvent, setSeekEvent] = useState<{ targetMs: number; at: number } | null>(null);

  const isDraggingRef = useRef(false);
  const seekingTargetMsRef = useRef<number | null>(null);
  const seekTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const item = player.item;
  const isItemActive = player.isItemActive;
  const isStarting = player.status === "starting";
  const hasQueue = player.queue.length > 0;
  const isPlaying = isItemActive && player.playbackState === PLAYBACK_STATE.playing;
  const playable = item ? queueOptionsFor(item) !== null : false;
  const previewing = !player.authorized;

  const positionMs = isItemActive ? activePositionMs : 0;
  const durationMs = isItemActive ? activeDurationMs : 0;
  const percent =
    durationMs > 0 ? Math.min(100, Math.max(0, (positionMs / durationMs) * 100)) : 0;

  useEffect(() => {
    return () => {
      if (seekTimeoutRef.current) {
        clearTimeout(seekTimeoutRef.current);
      }
    };
  }, []);

  // seek 生效前保留乐观位置，避免旧进度事件把滑块拉回去。
  const commitSeek = useCallback(
    (targetMs: number) => {
      isDraggingRef.current = false;
      setIsDragging(false);
      seekingTargetMsRef.current = targetMs;
      setActivePositionMs(targetMs);
      setSeekEvent({ targetMs, at: Date.now() });

      if (seekTimeoutRef.current) {
        clearTimeout(seekTimeoutRef.current);
      }
      seekTimeoutRef.current = setTimeout(() => {
        seekingTargetMsRef.current = null;
      }, 2500);

      void player.seekTo(targetMs).finally(() => {
        const inst = player.instance;
        if (inst && !isDraggingRef.current) {
          const currentMs = Math.max(0, (inst.currentPlaybackTime || 0) * 1000);
          if (
            seekingTargetMsRef.current === targetMs &&
            Math.abs(currentMs - targetMs) <= 1500
          ) {
            seekingTargetMsRef.current = null;
            setActivePositionMs(currentMs);
          }
        }
      });
    },
    [player],
  );

  // 进度订阅不依赖 isDragging，避免重订阅首帧覆盖刚提交的位置。
  useEffect(() => {
    const inst = player.instance;
    if (!inst || !player.isItemActive) {
      return;
    }

    const onTime = () => {
      if (isDraggingRef.current) return;

      const currentMs = Math.max(0, (inst.currentPlaybackTime || 0) * 1000);
      const targetMs = seekingTargetMsRef.current;

      if (targetMs !== null) {
        if (Math.abs(currentMs - targetMs) > 1500) {
          return;
        }
        seekingTargetMsRef.current = null;
      }

      setActivePositionMs(currentMs);

      const dur = (inst.currentPlaybackDuration || 0) * 1000;
      if (dur > 0) {
        setActiveDurationMs(dur);
      } else if (player.nowPlaying?.attributes?.durationInMillis) {
        setActiveDurationMs(player.nowPlaying.attributes.durationInMillis);
      }
    };

    onTime();
    inst.addEventListener("playbackTimeDidChange", onTime);
    return () => {
      inst.removeEventListener("playbackTimeDidChange", onTime);
    };
  }, [player.instance, player.isItemActive, player.nowPlaying]);

  return (
    <Modal titleId={titleId} onClose={player.closeDialog} className="max-w-md">
      <header className="flex items-center justify-between gap-2 px-4">
        <div className="flex items-center gap-1.5">
          <span id={titleId} className="label-mono text-muted-foreground">
            Web Player
          </span>
          <span className="label-mono text-muted-foreground/60">beta</span>
          <SyncPlaybackButton player={player} />
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={player.closeDialog}
          className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </header>

      <div className="px-4">
        <div className="mt-3 flex items-center gap-3">
          <PlayerCover item={item} />
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <div className="truncate font-medium">{item?.title}</div>
            <div className="truncate text-sm text-muted-foreground">{item?.artist}</div>
            <div className="min-h-5 truncate text-sm text-foreground">
              {(isItemActive ? player.nowPlaying?.attributes?.name : null) ?? (
                <span className="invisible select-none" aria-hidden>
                  &nbsp;
                </span>
              )}
            </div>
          </div>
        </div>

        {!previewing ? (
          <PlayerLyrics
            instance={player.instance}
            nowPlaying={player.nowPlaying}
            active={isItemActive}
            seekEvent={seekEvent}
            previewing={previewing}
          />
        ) : null}

        {!playable ? (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            This item has no playable source.
          </p>
        ) : (
          <>
            {!player.authorized ? (
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Without signing in, each track plays a 30-second preview. Sign in with an active Apple Music subscription for full playback; the site never relays audio or stores credentials.
              </p>
            ) : null}

            <div className="mt-3">
              <div
                className={cn(
                  "group relative flex h-4 w-full touch-none select-none items-center",
                  isItemActive ? "cursor-pointer" : "cursor-default opacity-50",
                )}
              >
                <div className="relative h-1 w-full overflow-hidden rounded-full bg-muted transition-[height] duration-150 group-hover:h-1.5">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      isPlaying ? "bg-live" : "bg-muted-foreground",
                    )}
                    style={{ width: `${percent}%` }}
                  />
                </div>

                <div
                  className={cn(
                    "pointer-events-none absolute size-2.5 -translate-x-1/2 rounded-full bg-foreground shadow-sm ring-2 ring-surface transition-all duration-150",
                    isDragging
                      ? "scale-125 opacity-100"
                      : "opacity-80 sm:opacity-0 sm:group-hover:opacity-100 sm:group-hover:scale-110",
                  )}
                  style={{ left: `${percent}%` }}
                />

                <input
                  type="range"
                  aria-label="Playback progress"
                  disabled={!isItemActive}
                  min={0}
                  max={durationMs > 0 ? durationMs : 1000}
                  step={1000}
                  value={Math.min(positionMs, durationMs > 0 ? durationMs : 1000)}
                  onPointerDown={() => {
                    if (!isItemActive) return;
                    isDraggingRef.current = true;
                    setIsDragging(true);
                  }}
                  onChange={(e) => {
                    if (!isItemActive) return;
                    isDraggingRef.current = true;
                    setIsDragging(true);
                    setActivePositionMs(Number(e.target.value));
                  }}
                  onPointerUp={(e) => {
                    if (!isItemActive) return;
                    commitSeek(Number((e.target as HTMLInputElement).value));
                  }}
                  onPointerCancel={(e) => {
                    if (!isItemActive) return;
                    commitSeek(Number((e.target as HTMLInputElement).value));
                  }}
                  onKeyUp={(e) => {
                    if (!isItemActive) return;
                    if (!SEEK_KEYS.has(e.key)) return;
                    commitSeek(Number((e.target as HTMLInputElement).value));
                  }}
                  className="absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
                />
              </div>

              <div className="label-mono mt-1 flex justify-between text-muted-foreground tabular-nums">
                <span>{formatClock(positionMs)}</span>
                <span>
                  {previewing ? "Preview · " : null}
                  {formatClock(durationMs)}
                </span>
              </div>
            </div>

            <div className="mt-2 flex items-center justify-center gap-6">
              <button
                type="button"
                aria-label="Previous"
                disabled={isStarting || !isItemActive}
                onClick={player.previous}
                className="p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                <SkipBack className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={isPlaying ? "Pause" : "Play"}
                disabled={isStarting}
                onClick={isItemActive ? player.toggle : player.play}
                className="p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                {isPlaying ? (
                  <Pause className="size-5" aria-hidden />
                ) : (
                  <Play className="size-5" aria-hidden />
                )}
              </button>
              <button
                type="button"
                aria-label="Next"
                disabled={isStarting || !isItemActive}
                onClick={player.next}
                className="p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                <SkipForward className="size-4" aria-hidden />
              </button>
            </div>

            {(() => {
              if (!hasQueue && !isStarting) return null;

              const scrollportHeight = playlistScrollportHeight(
                hasQueue ? player.queue.length : PLAYLIST_MAX_VISIBLE_ROWS,
              );

              return (
                // 内边距在滚动口外，按行高吸附才不会停在半行。
                <div className="mt-3 border-t border-line py-1.5">
                  <div
                    ref={listRef}
                    className="snap-y snap-mandatory overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden"
                    style={{ height: `${scrollportHeight}px` }}
                  >
                  {!hasQueue ? (
                    <div aria-hidden>
                      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                        <div
                          key={i}
                          className="flex h-8 snap-start items-center gap-2 px-1 py-1.5"
                        >
                          <div className="h-3.5 w-5 rounded bg-muted" />
                          <div className="h-3.5 flex-1 rounded bg-muted" />
                          <div className="h-3.5 w-8 rounded bg-muted" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    player.queue.map((song, index) => {
                      const isCurrent =
                        isItemActive &&
                        catalogItemId(song.id) === catalogItemId(player.nowPlaying?.id);
                      return (
                        <button
                          key={`${song.id ?? "song"}:${index}`}
                          type="button"
                          onClick={() => player.playAt(index)}
                          className="flex h-8 w-full snap-start items-center gap-2 px-1 py-1.5 text-left text-sm transition-colors hover:bg-surface-hover"
                        >
                          <span className="label-mono w-5 shrink-0 text-muted-foreground">
                            {index + 1}
                          </span>
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate",
                              isCurrent && "font-medium text-live",
                            )}
                          >
                            {song.attributes?.name ?? "Unknown track"}
                          </span>
                          <span className="label-mono shrink-0 text-muted-foreground">
                            {formatClock(song.attributes?.durationInMillis ?? 0)}
                          </span>
                        </button>
                      );
                    })
                  )}
                  </div>
                </div>
              );
            })()}
          </>
        )}

        {player.error ? (
          <p className="mt-2 text-sm text-muted-foreground">{player.error}</p>
        ) : null}
      </div>

      <div
        className={cn(
          "flex border-t border-line",
          (hasQueue || isStarting) && !player.error ? "mt-0" : "mt-4",
        )}
      >
        {!playable ? null : isItemActive ? (
          <DialogButton onClick={player.stop}>Stop</DialogButton>
        ) : (
          <DialogButton disabled={isStarting} onClick={player.play}>
            {isStarting ? "Loading..." : "Play"}
          </DialogButton>
        )}

        {playable && !player.authorized ? (
          <>
            <div className="w-px self-stretch bg-line" aria-hidden />
            <DialogButton disabled={isStarting} onClick={player.signIn}>
              {isStarting ? "Connecting..." : "Sign in"}
            </DialogButton>
          </>
        ) : null}

        {item?.link ? (
          <>
            {playable ? <div className="w-px self-stretch bg-line" aria-hidden /> : null}
            <a
              href={item.link}
              target="_blank"
              rel="noreferrer noopener"
              className="label-mono inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 py-2.5 text-center text-foreground transition-colors hover:bg-surface-hover"
            >
              <span>Apple Music</span>
              <ExternalLink className="size-3 shrink-0" aria-hidden />
            </a>
          </>
        ) : null}

        {player.authorized ? (
          <>
            <div className="w-px self-stretch bg-line" aria-hidden />
            <DialogButton
              onClick={() => {
                player.logout();
                player.closeDialog();
              }}
            >
              Sign out
            </DialogButton>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
