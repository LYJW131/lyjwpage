"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  applyRepeatMode,
  getMusicKit,
  MUSICKIT_TOKEN_ENDPOINT,
  PLAYBACK_STATE,
  type MediaItem,
  type MusicKitInstance,
} from "@/lib/musickit";
import {
  followTargetMs,
  isHostSeek,
  needsResync,
  playbackLagMs,
  shouldSeekAfterTrackChange,
} from "@/lib/listen-along";
import { catalogItemId, mediaItemIndex } from "@/lib/playing-queue";
import {
  isSyncEpochCurrent,
  normalizeSyncUpcomingSongIds,
  planSyncUpcomingQueue,
  shouldKeepNaturalNext,
} from "@/lib/web-player-sync";
import { trackPositionMs } from "@/lib/track-position";
import type { ListeningItem, LocalNowPlaying } from "@/lib/types";
import {
  fetchCatalogTracks,
  filterUserQueueItems,
  getCachedPlaylist,
  getMusicAuthServerSnapshot,
  getMusicAuthSnapshot,
  queueOptionsFor,
  setCachedPlaylist,
  setMusicAuthSnapshot,
  subscribeMusicAuth,
} from "@/lib/web-player";

export type WebPlayerStatus =
  | "unavailable"
  | "idle"
  | "starting"
  | "ready"
  | "error";

export type SyncSource = {
  track: LocalNowPlaying | null;
  songId: string | null;
  upcomingSongIds?: string[];
};

export type WebPlayer = {
  status: WebPlayerStatus;
  authorized: boolean;
  error: string | null;
  item: ListeningItem | null;
  activeItem: ListeningItem | null;
  isItemActive: boolean;
  open: boolean;
  playbackState: number;
  nowPlaying: MediaItem | null;
  queue: MediaItem[];
  active: boolean;
  instance: MusicKitInstance | null;
  openWith: (item: ListeningItem) => void;
  openDialog: () => void;
  closeDialog: () => void;
  signIn: () => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seekTo: (ms: number) => Promise<void>;
  playAt: (index: number) => void;
  stop: () => void;
  logout: () => void;
  setSyncSource: (source: SyncSource) => void;
  toggleSync: () => void;
  startSync: () => void;
  syncing: boolean;
  syncAvailable: boolean;
  syncWaiting: boolean;
};

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unknown error";
}

function isPlayInterrupted(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    (error instanceof Error && error.name === "AbortError") ||
    message.includes("interrupted by a new load request") ||
    message.includes("interrupted by a call to pause") ||
    /operation was aborted/i.test(message)
  );
}

async function mkSafe(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (isPlayInterrupted(error)) return;
    throw error;
  }
}

function isPlaybackActive(inst: MusicKitInstance): boolean {
  const s = inst.playbackState;
  return (
    s === PLAYBACK_STATE.playing ||
    s === PLAYBACK_STATE.loading ||
    s === PLAYBACK_STATE.waiting ||
    s === PLAYBACK_STATE.seeking
  );
}

function localPositionMs(music: MusicKitInstance): number {
  const seconds = music.currentPlaybackTime;
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0;
}

function localSongId(music: MusicKitInstance): string | null {
  return catalogItemId(music.nowPlayingItem?.id);
}

function isPlaybackLive(music: MusicKitInstance): boolean {
  return isPlaybackActive(music);
}

function waitUntilPlaying(
  music: MusicKitInstance,
  cancelled: () => boolean,
): Promise<void> {
  if (music.playbackState === PLAYBACK_STATE.playing) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.clearInterval(poll);
      music.removeEventListener("playbackStateDidChange", onState);
      resolve();
    };
    const onState = () => {
      if (cancelled() || music.playbackState === PLAYBACK_STATE.playing) finish();
    };
    const timeout = window.setTimeout(finish, 25_000);
    const poll = window.setInterval(onState, 250);
    music.addEventListener("playbackStateDidChange", onState);
    onState();
  });
}

function playSafe(music: MusicKitInstance): Promise<void> {
  return mkSafe(() => music.play());
}

function syncItemForSource(source: SyncSource, previous?: ListeningItem | null): ListeningItem {
  const track = source.track;
  const songId = source.songId;
  const previousTrack = previous?.id === "listen-along" ? previous : null;
  return {
    id: "listen-along",
    title: track?.title || previousTrack?.title || "Listen Along",
    artist: track?.artist || previousTrack?.artist || "",
    artwork: track?.artworkUrl ?? previousTrack?.artwork ?? null,
    link:
      songId != null
        ? `https://music.apple.com/song/${encodeURIComponent(songId)}`
        : previousTrack?.link ?? null,
    palette: previousTrack?.palette ?? [],
    durationMs: track?.durationMs || previousTrack?.durationMs || null,
  };
}

function sameSyncItem(a: ListeningItem | null, b: ListeningItem): boolean {
  return Boolean(
    a &&
      a.id === b.id &&
      a.title === b.title &&
      a.artist === b.artist &&
      a.artwork === b.artwork &&
      a.link === b.link &&
      a.durationMs === b.durationMs,
  );
}

async function changeToSong(
  music: MusicKitInstance, songId: string, cancelled: () => boolean = () => false,
): Promise<void> {
  const at = mediaItemIndex(music.queue?.items ?? [], songId);
  if (at >= 0) {
    try {
      if (isPlaybackLive(music)) await mkSafe(() => music.pause());
      if (cancelled()) return;
      await music.changeToMediaAtIndex(at);
      return;
    } catch (error) {
      if (!isPlayInterrupted(error)) throw error;
    }
  }
  await mkSafe(() => music.stop());
  if (cancelled()) return;
  await mkSafe(() => music.setQueue({ song: songId }));
}

async function syncUpcomingQueue(
  music: MusicKitInstance,
  ids: string[],
  cancelled: () => boolean,
): Promise<boolean> {
  const current = localSongId(music);
  const plan = planSyncUpcomingQueue(music.queue?.items, current, ids);
  const desired = plan.desiredSongIds;
  if (!current || plan.action === "none") return false;

  if (desired.length > 0) {
    await mkSafe(() => music.playNext({ song: desired[0] }, true));
    for (const id of desired.slice(1)) {
      if (cancelled()) return true;
      await mkSafe(() => music.playLater({ song: id }));
    }
    return true;
  }

  // MusicKit 无公开 clear-tail API；重装当前曲清尾时须恢复位置，避免取消同步后自由播放回到歌头。
  const position = localPositionMs(music);
  const wasLive = isPlaybackLive(music);
  await mkSafe(() => music.stop());
  if (cancelled()) return true;
  await mkSafe(() => music.setQueue({ song: current }));
  if (cancelled()) return true;
  if (wasLive) {
    await playSafe(music);
    await waitUntilPlaying(music, cancelled);
  }
  if (cancelled()) return true;
  if (position > 0) await mkSafe(() => music.seekToTime(position / 1000));
  return true;
}

const setAuthorized = setMusicAuthSnapshot;

export function useWebPlayerState(): WebPlayer {
  const [status, setStatus] = useState<WebPlayerStatus>(
    MUSICKIT_TOKEN_ENDPOINT ? "idle" : "unavailable",
  );
  const authorized = useSyncExternalStore(
    subscribeMusicAuth,
    getMusicAuthSnapshot,
    getMusicAuthServerSnapshot,
  );
  const [error, setError] = useState<string | null>(null);
  const [item, setItem] = useState<ListeningItem | null>(null);
  const [activeItem, setActiveItem] = useState<ListeningItem | null>(null);
  const [open, setOpen] = useState(false);
  const [playbackState, setPlaybackState] = useState<number>(PLAYBACK_STATE.none);
  const [nowPlaying, setNowPlaying] = useState<MediaItem | null>(null);
  const [queue, setQueue] = useState<MediaItem[]>([]);
  const [active, setActive] = useState(false);
  const [instance, setInstance] = useState<MusicKitInstance | null>(null);
  const [syncSource, setSyncSourceState] = useState<SyncSource>({
    track: null,
    songId: null,
    upcomingSongIds: [],
  });
  const [syncing, setSyncing] = useState(false);

  const instanceRef = useRef<MusicKitInstance | null>(null);
  const itemRef = useRef<ListeningItem | null>(null);
  const activeItemRef = useRef<ListeningItem | null>(null);
  const activeRef = useRef(false);
  const openRef = useRef(false);
  const loadedIdRef = useRef<string | null>(null);
  const syncingRef = useRef(false);
  const syncSourceRef = useRef<SyncSource>(syncSource);
  const syncRevisionRef = useRef(0);
  const syncGenerationRef = useRef(0);
  const syncItemRef = useRef<ListeningItem | null>(null);
  const syncReadySongIdRef = useRef<string | null>(null);
  const syncHasFollowedRef = useRef(false);
  const syncAlignedSongIdRef = useRef<string | null>(null);
  const syncLagMsRef = useRef(0);
  const syncPendingHostStopRef = useRef<number | null>(null);

  useEffect(() => {
    itemRef.current = item;
  }, [item]);

  useEffect(() => {
    activeItemRef.current = activeItem;
  }, [activeItem]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const isItemActive = Boolean(
    active && item && activeItem && item.id === activeItem.id,
  );

  const opChain = useRef(Promise.resolve());
  const runExclusive = useCallback((fn: () => Promise<void>) => {
    const next = opChain.current.then(fn, fn).catch((caught: unknown) => {
      if (!isPlayInterrupted(caught)) {
        setError(describe(caught));
        setStatus("error");
      }
    });
    opChain.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }, []);

  // revision 与 generation 都须匹配，避免旧 await 完成后重新夺回用户控制权。
  const syncIsCurrent = useCallback((generation: number, revision: number) => {
    return isSyncEpochCurrent(
      { generation: syncGenerationRef.current, revision: syncRevisionRef.current },
      { generation, revision },
      syncingRef.current,
    );
  }, []);

  const clearSyncTimers = useCallback(() => {
    if (syncPendingHostStopRef.current != null) {
      window.clearTimeout(syncPendingHostStopRef.current);
      syncPendingHostStopRef.current = null;
    }

  }, []);

  const resetSyncSession = useCallback(() => {
    clearSyncTimers();
    syncReadySongIdRef.current = null;
    syncHasFollowedRef.current = false;
    syncAlignedSongIdRef.current = null;
    syncLagMsRef.current = 0;
  }, [clearSyncTimers]);

  const cancelSyncFollow = useCallback(
    (reset = true) => {
      syncGenerationRef.current += 1;
      syncingRef.current = false;
      setSyncing(false);
      if (reset) resetSyncSession();
      const inst = instanceRef.current;
      if (inst) {
        if (inst.volume === 0) inst.volume = 1;
        applyRepeatMode(inst, false);
        inst.autoplayEnabled = false;
        setPlaybackState(inst.playbackState);
        setStatus(
          activeRef.current || inst.nowPlayingItem
            ? "ready"
            : MUSICKIT_TOKEN_ENDPOINT
              ? "idle"
              : "unavailable",
        );
      } else {
        setStatus(MUSICKIT_TOKEN_ENDPOINT ? "idle" : "unavailable");
      }
    },
    [resetSyncSession],
  );

  const updateSyncItem = useCallback((source: SyncSource) => {
    const next = syncItemForSource(source, syncItemRef.current);
    syncItemRef.current = next;
    if (
      syncingRef.current &&
      (itemRef.current?.id === "listen-along" || itemRef.current == null) &&
      !sameSyncItem(itemRef.current, next)
    ) {
      setItem(next);
      itemRef.current = next;
    }
    if (syncingRef.current && activeItemRef.current?.id === "listen-along") {
      if (!sameSyncItem(activeItemRef.current, next)) {
        setActiveItem(next);
        activeItemRef.current = next;
      }
    }
  }, []);

  const setSyncSource = useCallback(
    (next: SyncSource) => {
      const normalized: SyncSource = {
        track: next.track ?? null,
        songId: next.songId ?? null,
        upcomingSongIds: normalizeSyncUpcomingSongIds(next.upcomingSongIds),
      };
      syncSourceRef.current = normalized;
      syncRevisionRef.current += 1;
      setSyncSourceState(normalized);
      if (syncingRef.current) updateSyncItem(normalized);
    },
    [updateSyncItem],
  );

  // getMusicKit 可能重新 configure 并打断播放，活动实例必须直接复用。
  const getOrReuseMusicKit = useCallback(async (): Promise<MusicKitInstance> => {
    const existing = instanceRef.current;
    if (existing && isPlaybackActive(existing)) {
      setAuthorized(existing.isAuthorized);
      return existing;
    }
    const inst = await getMusicKit();
    instanceRef.current = inst;
    setInstance(inst);
    /* 持久授权恢复不会触发 authorizationStatusDidChange，配置后须读取初始值。 */
    setAuthorized(inst.isAuthorized);
    return inst;
  }, []);

  useEffect(() => {
    if (!open) return;
    void getOrReuseMusicKit().catch(() => {});
  }, [open, getOrReuseMusicKit]);

  // 已在排他链内，不可再次排队，否则会等待自身而死锁。
  const prepare = useCallback(async (inst: MusicKitInstance, targetItem: ListeningItem) => {
    const options = queueOptionsFor(targetItem);
    if (!options) {
      setStatus("idle");
      return;
    }
    setStatus("starting");
    setError(null);
    try {
      inst.volume = 1;
      applyRepeatMode(inst, false);
      const saved = targetItem.id === "listen-along" ? getCachedPlaylist(targetItem.id) : null;
      const first = catalogItemId(saved?.[0]?.id);
      await mkSafe(() => inst.setQueue(first ? { song: first } : options));
      if (first) {
        for (const entry of saved!.slice(1)) {
          const id = catalogItemId(entry.id);
          if (id) await mkSafe(() => inst.playLater({ song: id }));
        }
      }
      // setQueue 重建 PlaybackController 时可能启动 Autoplay，装完必须显式关闭。
      inst.autoplayEnabled = false;

      const existingCached = getCachedPlaylist(targetItem.id);
      const items =
        existingCached && existingCached.length > 0
          ? existingCached
          : filterUserQueueItems(inst);

      if (items.length > 0) {
        setCachedPlaylist(targetItem.id, items);
      }
      loadedIdRef.current = targetItem.id;
      if (itemRef.current?.id === targetItem.id) {
        setQueue(items);
        setNowPlaying(inst.nowPlayingItem ?? items[0] ?? null);
        setStatus("ready");
      }
    } catch (err) {
      if (itemRef.current?.id === targetItem.id) {
        loadedIdRef.current = null;
        setError(describe(err));
        setStatus("error");
      }
    }
  }, []);

  const stop = useCallback(() => {
    cancelSyncFollow();
    setActive(false);
    activeRef.current = false;
    setActiveItem(null);
    activeItemRef.current = null;
    loadedIdRef.current = null;
    setPlaybackState(PLAYBACK_STATE.none);
    setNowPlaying(null);
    const inst = instanceRef.current;
    if (!inst) return;
    void runExclusive(async () => {
      await inst.stop().catch(() => {});
    });
  }, [cancelSyncFollow, runExclusive]);

  const openWith = useCallback(
    (targetItem: ListeningItem) => {
      setItem(targetItem);
      itemRef.current = targetItem;
      setOpen(true);
      openRef.current = true;
      setError(null);
      void getOrReuseMusicKit().catch(() => {});

      const isCurrentActive =
        activeRef.current && activeItemRef.current?.id === targetItem.id;
      const cached = getCachedPlaylist(targetItem.id);
      const isLoaded = loadedIdRef.current === targetItem.id;
      const playable = queueOptionsFor(targetItem) !== null;

      if (cached && cached.length > 0) {
        setQueue(cached);
        setNowPlaying(
          isCurrentActive
            ? (instanceRef.current?.nowPlayingItem ?? cached[0] ?? null)
            : null,
        );
        setStatus("ready");
      } else if (isLoaded && instanceRef.current?.queue) {
        const items = filterUserQueueItems(instanceRef.current);
        if (items.length > 0) {
          setCachedPlaylist(targetItem.id, items);
          setQueue(items);
          setNowPlaying(
            isCurrentActive
              ? (instanceRef.current.nowPlayingItem ?? items[0] ?? null)
              : null,
          );
          setStatus("ready");
        } else {
          setQueue([]);
          setNowPlaying(null);
          setStatus(playable ? "starting" : "idle");
        }
      } else {
        setQueue([]);
        setNowPlaying(null);
        setStatus(playable ? "starting" : "idle");
      }

      if (!playable) return;

      if (cached && cached.length > 0) return;
      if (isLoaded && instanceRef.current?.queue?.items?.length) return;

      void (async () => {
        try {
          const tracks = await fetchCatalogTracks(targetItem, instanceRef.current);
          if (tracks.length > 0) {
            setCachedPlaylist(targetItem.id, tracks);
            if (itemRef.current?.id === targetItem.id) {
              setQueue(tracks);
              const activeNow =
                activeRef.current && activeItemRef.current?.id === targetItem.id;
              setNowPlaying(
                activeNow
                  ? (instanceRef.current?.nowPlayingItem ?? tracks[0] ?? null)
                  : null,
              );
              setStatus("ready");
            }
          } else {
            if (!activeRef.current) {
              void runExclusive(async () => {
                if (itemRef.current?.id !== targetItem.id) return;
                let inst: MusicKitInstance;
                try {
                  inst = await getOrReuseMusicKit();
                } catch (err) {
                  setError(describe(err));
                  setStatus("error");
                  return;
                }
                if (itemRef.current?.id === targetItem.id) {
                  await prepare(inst, targetItem);
                }
              });
            } else if (itemRef.current?.id === targetItem.id) {
              setStatus("ready");
            }
          }
        } catch (err) {
          if (itemRef.current?.id === targetItem.id) {
            setError(describe(err));
            setStatus("error");
          }
        }
      })();
    },
    [getOrReuseMusicKit, prepare, runExclusive],
  );

  const openDialog = useCallback(() => {
    setOpen(true);
    openRef.current = true;
    void getOrReuseMusicKit().catch(() => {});
  }, [getOrReuseMusicKit]);
  const closeDialog = useCallback(() => {
    setOpen(false);
    openRef.current = false;
  }, []);

  const markActive = useCallback((inst: MusicKitInstance) => {
    setPlaybackState(inst.playbackState);
    setNowPlaying(inst.nowPlayingItem ?? null);
    setActive(true);
    activeRef.current = true;
  }, []);

  const syncReconcile = useCallback(
    (generation: number, revision: number): Promise<void> =>
      runExclusive(async () => {
        if (!syncIsCurrent(generation, revision)) return;

        setStatus("starting");
        setError(null);
        let inst: MusicKitInstance;
        try {
          inst = await getOrReuseMusicKit();
          if (!syncIsCurrent(generation, revision)) return;

          if (!inst.isAuthorized) await inst.authorize();
          if (!syncIsCurrent(generation, revision)) return;

          setAuthorized(inst.isAuthorized);
          const source = syncSourceRef.current;
          const track = source.track;
          const hostSongId = source.songId;
          updateSyncItem(source);
          applyRepeatMode(inst, track?.repeatOne === true);

          const setSyncQueueState = () => {
            const items = filterUserQueueItems(inst);
            setCachedPlaylist("listen-along", items);
            if (itemRef.current?.id !== "listen-along") return;
            setQueue(items);
            setNowPlaying(inst.nowPlayingItem ?? items[0] ?? null);
            setPlaybackState(inst.playbackState);
          };

          const schedulePause = async () => {
            if (syncPendingHostStopRef.current != null) {
              window.clearTimeout(syncPendingHostStopRef.current);
            }
            const hostPosition = track ? trackPositionMs(track, Date.now()) : 0;
            const edgeMs = 2_000 + 5_000;
            const midSong = Boolean(
              hostSongId &&
                track &&
                track.durationMs > 0 &&
                hostPosition > edgeMs &&
                track.durationMs - hostPosition > edgeMs,
            );

            if (midSong) {
              syncPendingHostStopRef.current = null;
              await mkSafe(() => inst.pause());
              return;
            }

            syncPendingHostStopRef.current = window.setTimeout(() => {
              syncPendingHostStopRef.current = null;
              void runExclusive(async () => {
                if (!syncIsCurrent(generation, revision)) return;
                const latest = syncSourceRef.current;
                if (latest.track?.state === "playing" && latest.songId) return;
                const local = localSongId(inst);
                if (latest.songId && local && latest.songId !== local) return;
                if (isPlaybackLive(inst)) await mkSafe(() => inst.pause());
              });
            }, 3_500);
          };

          if (!hostSongId || !track) {
            await schedulePause();
            setSyncQueueState();
            setStatus("ready");
            return;
          }

          if (track.state !== "playing") {
            clearSyncTimers();
          }

          const hostPosition = trackPositionMs(track, Date.now());
          let local = localSongId(inst);
          const joining = !syncHasFollowedRef.current;

          /* 本地可能沿预排队列先切歌，不能让晚到的歌尾旧锚点把它拉回上一首。 */
          if (local && local !== hostSongId && !track.repeatOne) {
            const staleTail = shouldKeepNaturalNext({
              queueItems: inst.queue?.items,
              hostSongId,
              localSongId: local,
              hostPositionMs: hostPosition,
              hostDurationMs: track.durationMs,
            });
            if (staleTail) {
              setSyncQueueState();
              setStatus("ready");
              return;
            }
          }

          let muted = false;
          try {
            if (local !== hostSongId) {
              inst.volume = 0;
              muted = true;
              syncReadySongIdRef.current = null;
              loadedIdRef.current = null;
              await changeToSong(inst, hostSongId, () => !syncIsCurrent(generation, revision));
              if (!syncIsCurrent(generation, revision)) return;
              local = localSongId(inst);
            }

            if (local !== hostSongId) return;

            const desiredUpcoming = track.repeatOne
              ? []
              : normalizeSyncUpcomingSongIds(source.upcomingSongIds);
            if (!planSyncUpcomingQueue(inst.queue?.items, local, desiredUpcoming).matches) {
              inst.volume = 0;
              muted = true;
            }
            const queueChanged = await syncUpcomingQueue(
              inst, desiredUpcoming, () => !syncIsCurrent(generation, revision),
            );
            if (!syncIsCurrent(generation, revision)) return;
            if (queueChanged && track.state !== "playing") {
              // setQueue 可能把暂停曲改成 loading，须先 seek 再恢复 pause。
              muted = true;
              inst.volume = 0;
            }

            if (track.state !== "playing") {
              if (isPlaybackLive(inst)) await mkSafe(() => inst.pause());
              if (
                needsResync(
                  localPositionMs(inst),
                  trackPositionMs(syncSourceRef.current.track ?? track, Date.now()),
                  5_000,
                  track.repeatOne ? track.durationMs : 0,
                )
              ) {
                await mkSafe(() =>
                  inst.seekToTime(
                    trackPositionMs(syncSourceRef.current.track ?? track, Date.now()) / 1000,
                  ),
                );
              }
              if (!syncIsCurrent(generation, revision)) return;
              syncReadySongIdRef.current = hostSongId;
              syncHasFollowedRef.current = true;
              syncAlignedSongIdRef.current = hostSongId;
              syncLagMsRef.current = 0;
              loadedIdRef.current = "listen-along";
              setActiveItem(syncItemRef.current);
              activeItemRef.current = syncItemRef.current;
              setActive(true);
              activeRef.current = true;
              setSyncQueueState();
              setStatus("ready");
              return;
            }

            if (!isPlaybackLive(inst)) {
              await playSafe(inst);
              await waitUntilPlaying(inst, () => !syncIsCurrent(generation, revision));
              if (!syncIsCurrent(generation, revision)) return;
            }

            const localNow = localPositionMs(inst);
            const latestHostPosition = trackPositionMs(
              syncSourceRef.current.track ?? track,
              Date.now(),
            );
            const songChanged = syncAlignedSongIdRef.current !== hostSongId;
            const mustAlign =
              joining ||
              (songChanged && shouldSeekAfterTrackChange(track.positionMs, 5_000)) ||
              (!songChanged &&
                isHostSeek(
                  localNow,
                  syncLagMsRef.current,
                  latestHostPosition,
                  5_000,
                  track.repeatOne ? track.durationMs : 0,
                ));

            if (mustAlign) {
              await mkSafe(() => inst.seekToTime(latestHostPosition / 1000));
              syncLagMsRef.current = 0;
            } else if (songChanged) {
              syncLagMsRef.current = playbackLagMs(latestHostPosition, localNow);
            }
            if (!syncIsCurrent(generation, revision)) return;
            if (!isPlaybackLive(inst)) await playSafe(inst);

            syncReadySongIdRef.current = hostSongId;
            syncHasFollowedRef.current = true;
            syncAlignedSongIdRef.current = hostSongId;
            loadedIdRef.current = "listen-along";
            setActiveItem(syncItemRef.current);
            activeItemRef.current = syncItemRef.current;
            markActive(inst);
            setSyncQueueState();
            setStatus("ready");
          } finally {
            if (localSongId(inst) === hostSongId) {
              loadedIdRef.current = "listen-along";
              setSyncQueueState();
            }
            if (muted && inst.volume === 0) inst.volume = 1;
          }
        } catch (caught) {
          if (!syncIsCurrent(generation, revision) || isPlayInterrupted(caught)) return;
          cancelSyncFollow();
          setError(describe(caught));
          setStatus("error");
        }
      }),
    [
      cancelSyncFollow,
      clearSyncTimers,
      getOrReuseMusicKit,
      markActive,
      runExclusive,
      syncIsCurrent,
      updateSyncItem,
    ],
  );

  useEffect(() => {
    if (!syncing) return;
    void syncReconcile(syncGenerationRef.current, syncRevisionRef.current);
  }, [syncReconcile, syncSource, syncing]);

  useEffect(() => {
    if (!syncing || !instance) return;
    const generation = syncGenerationRef.current;
    const timer = window.setInterval(() => {
      const revision = syncRevisionRef.current;
      if (!syncIsCurrent(generation, revision)) return;
      const source = syncSourceRef.current;
      const track = source.track;
      const songId = source.songId;
      if (!track || !songId || track.state !== "playing") return;
      if (syncReadySongIdRef.current !== songId) return;
      if (localSongId(instance) !== songId) return;
      if (instance.playbackState !== PLAYBACK_STATE.playing) return;

      const host = trackPositionMs(track, Date.now());
      const target = followTargetMs(host, syncLagMsRef.current);
      if (
        !needsResync(
          localPositionMs(instance),
          target,
          5_000,
          track.repeatOne ? track.durationMs : 0,
        )
      ) {
        return;
      }

      void runExclusive(async () => {
        if (!syncIsCurrent(generation, revision)) return;
        const latest = syncSourceRef.current;
        if (
          !latest.track ||
          !latest.songId ||
          latest.track.state !== "playing" ||
          syncReadySongIdRef.current !== latest.songId ||
          localSongId(instance) !== latest.songId
        ) {
          return;
        }
        await mkSafe(() =>
          instance.seekToTime(
            followTargetMs(trackPositionMs(latest.track!, Date.now()), syncLagMsRef.current) /
              1000,
          ),
        );
      }).catch(() => {});
    }, 20_000);

    return () => window.clearInterval(timer);
  }, [instance, runExclusive, syncIsCurrent, syncing]);

  const startSync = useCallback(() => {
    if (!MUSICKIT_TOKEN_ENDPOINT) return;
    if (syncingRef.current) {
      const current = syncItemRef.current;
      if (current) {
        setItem(current);
        itemRef.current = current;
      }
      const inst = instanceRef.current;
      const loaded = inst && loadedIdRef.current === "listen-along";
      setQueue(loaded ? filterUserQueueItems(inst) : []);
      setNowPlaying(loaded ? inst.nowPlayingItem : null);
      setOpen(true);
      openRef.current = true;
      return;
    }

    syncGenerationRef.current += 1;
    resetSyncSession();
    syncingRef.current = true;
    setSyncing(true);
    setError(null);
    setStatus("starting");
    const virtual = syncItemForSource(syncSourceRef.current, syncItemRef.current);
    syncItemRef.current = virtual;
    setItem(virtual);
    itemRef.current = virtual;
    setOpen(true);
    openRef.current = true;
    setQueue([]);
    setNowPlaying(null);
  }, [resetSyncSession]);

  const toggleSync = useCallback(() => {
    if (syncingRef.current) {
      cancelSyncFollow();
    } else {
      startSync();
    }
  }, [cancelSyncFollow, startSync]);

  const signIn = useCallback(() => {
    void runExclusive(async () => {
      setStatus("starting");
      setError(null);
      try {
        const inst = await getOrReuseMusicKit();
        if (!inst.isAuthorized) await inst.authorize();
        setAuthorized(inst.isAuthorized);
        setStatus("ready");
        /* 授权不会把已装载的试听队列升级为整曲，必须重装队列。 */
        const activeCur = activeItemRef.current;
        if (inst.isAuthorized && activeRef.current && activeCur) {
          await inst.stop().catch(() => {});
          loadedIdRef.current = null;
          await prepare(inst, activeCur);
          if (loadedIdRef.current !== activeCur.id) return;
          inst.autoplayEnabled = false;
          await mkSafe(() => inst.play());
          markActive(inst);
        }
      } catch (err) {
        setError(describe(err));
        setStatus("error");
      }
    });
  }, [getOrReuseMusicKit, markActive, prepare, runExclusive]);

  const play = useCallback(() => {
    cancelSyncFollow();
    void runExclusive(async () => {
      const currentItem =
        !openRef.current && activeItemRef.current ? activeItemRef.current : itemRef.current;
      if (!currentItem) return;

      setStatus("starting");
      setError(null);
      let inst: MusicKitInstance;
      try {
        inst = await getOrReuseMusicKit();
      } catch (err) {
        setError(describe(err));
        setStatus("error");
        return;
      }

      if (loadedIdRef.current !== currentItem.id) {
        await inst.stop().catch(() => {});
        await prepare(inst, currentItem);
        if (loadedIdRef.current !== currentItem.id) return;
      }

      inst.autoplayEnabled = false;
      if (inst.playbackState !== PLAYBACK_STATE.playing) await mkSafe(() => inst.play());
      setStatus("ready");
      setActiveItem(currentItem);
      activeItemRef.current = currentItem;
      markActive(inst);
    });
  }, [cancelSyncFollow, getOrReuseMusicKit, markActive, prepare, runExclusive]);

  const pause = useCallback(() => {
    cancelSyncFollow();
    void runExclusive(async () => {
      const inst = instanceRef.current;
      if (!inst) return;
      await mkSafe(() => inst.pause());
    });
  }, [cancelSyncFollow, runExclusive]);

  const toggle = useCallback(() => {
    const inst = instanceRef.current;
    if (inst && activeRef.current && inst.playbackState === PLAYBACK_STATE.playing) {
      if (openRef.current && itemRef.current?.id !== activeItemRef.current?.id) {
        play();
        return;
      }
      pause();
      return;
    }
    play();
  }, [pause, play]);

  const next = useCallback(() => {
    cancelSyncFollow();
    void runExclusive(async () => {
      const inst = instanceRef.current;
      if (!inst) return;
      await mkSafe(() => inst.skipToNextItem());
    });
  }, [cancelSyncFollow, runExclusive]);

  const previous = useCallback(() => {
    cancelSyncFollow();
    void runExclusive(async () => {
      const inst = instanceRef.current;
      if (!inst) return;
      await mkSafe(() => inst.skipToPreviousItem());
    });
  }, [cancelSyncFollow, runExclusive]);

  const seekTo = useCallback(
    (ms: number): Promise<void> => {
      cancelSyncFollow();
      return runExclusive(async () => {
        const inst = instanceRef.current;
        if (!inst) return;
        await mkSafe(() => inst.seekToTime(ms / 1000));
      });
    },
    [cancelSyncFollow, runExclusive],
  );

  const playAt = useCallback(
    (index: number) => {
      cancelSyncFollow();
      void runExclusive(async () => {
        const currentItem = itemRef.current;
        if (!currentItem) return;

        let inst: MusicKitInstance;
        try {
          inst = await getOrReuseMusicKit();
        } catch (err) {
          setError(describe(err));
          setStatus("error");
          return;
        }

        if (loadedIdRef.current !== currentItem.id) {
          await inst.stop().catch(() => {});
          await prepare(inst, currentItem);
          if (loadedIdRef.current !== currentItem.id) return;
        }

        inst.autoplayEnabled = false;
        await mkSafe(() => inst.pause());
        await mkSafe(() => inst.changeToMediaAtIndex(index));
        setActiveItem(currentItem);
        activeItemRef.current = currentItem;
        markActive(inst);
      });
    },
    [cancelSyncFollow, getOrReuseMusicKit, markActive, prepare, runExclusive],
  );

  const logout = useCallback(() => {
    stop();
    const inst = instanceRef.current;
    if (!inst) {
      setError(null);
      return;
    }
    void runExclusive(async () => {
      try {
        await inst.unauthorize();
        setAuthorized(false);
        setError(null);
      } catch (caught) {
        setError(describe(caught));
        setStatus("error");
      }
    });
  }, [runExclusive, stop]);

  // 不在 Provider 订阅 playbackTimeDidChange，避免整棵消费树每秒重渲染。
  useEffect(() => {
    const inst = instance;
    if (!inst) return;

    const onPlaybackState = () => {
      setPlaybackState(inst.playbackState);
    };
    const onNowPlaying = () => {
      if (activeItemRef.current?.id === itemRef.current?.id) {
        setNowPlaying(inst.nowPlayingItem ?? null);
      }
    };
    const onQueue = () => {
      const currentLoadedId = loadedIdRef.current;
      if (!currentLoadedId || currentLoadedId !== itemRef.current?.id) return;

      const existing = getCachedPlaylist(currentLoadedId);
      if (currentLoadedId !== "listen-along" && existing && existing.length > 0) return;

      const items = filterUserQueueItems(inst);
      if (items.length > 0) {
        setCachedPlaylist(currentLoadedId, items);
        setQueue(items);
      }
    };
    const onAuth = () => {
      const isAuth = inst.isAuthorized;
      setAuthorized(isAuth);
      if (!isAuth) {
        stop();
      }
    };

    inst.addEventListener("playbackStateDidChange", onPlaybackState);
    inst.addEventListener("nowPlayingItemDidChange", onNowPlaying);
    inst.addEventListener("queueItemsDidChange", onQueue);
    inst.addEventListener("authorizationStatusDidChange", onAuth);

    return () => {
      inst.removeEventListener("playbackStateDidChange", onPlaybackState);
      inst.removeEventListener("nowPlayingItemDidChange", onNowPlaying);
      inst.removeEventListener("queueItemsDidChange", onQueue);
      inst.removeEventListener("authorizationStatusDidChange", onAuth);
    };
  }, [instance, stop]);

  useEffect(() => {
    return () => {
      syncingRef.current = false;
      syncGenerationRef.current += 1;
      clearSyncTimers();
      if (instanceRef.current) {
        void instanceRef.current.stop().catch(() => {});
      }
    };
  }, [clearSyncTimers]);

  const visibleNowPlaying = isItemActive ? nowPlaying : null;

  return useMemo<WebPlayer>(
    () => ({
      status,
      authorized,
      error,
      item,
      activeItem,
      isItemActive,
      open,
      playbackState,
      nowPlaying: visibleNowPlaying,
      queue,
      active,
      instance,
      openWith,
      openDialog,
      closeDialog,
      signIn,
      play,
      pause,
      toggle,
      next,
      previous,
      seekTo,
      playAt,
      stop,
      logout,
      setSyncSource,
      toggleSync,
      startSync,
      syncing,
      syncAvailable: Boolean(MUSICKIT_TOKEN_ENDPOINT && syncSource.songId),
      syncWaiting:
        syncing &&
        (!syncSource.songId || !syncSource.track || syncSource.track.state !== "playing"),
    }),
    [
      status,
      authorized,
      error,
      item,
      activeItem,
      isItemActive,
      open,
      playbackState,
      visibleNowPlaying,
      queue,
      active,
      instance,
      openWith,
      openDialog,
      closeDialog,
      signIn,
      play,
      pause,
      toggle,
      next,
      previous,
      seekTo,
      playAt,
      stop,
      logout,
      setSyncSource,
      toggleSync,
      startSync,
      syncing,
      syncSource,
    ],
  );
}
