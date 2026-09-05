"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ListenAlong } from "@/hooks/use-listen-along";
import {
  getMusicKit,
  PLAYBACK_STATE,
  REPEAT_MODE,
  type MusicKitInstance,
  type MusicKitMediaItem,
} from "@/lib/musickit";
import {
  boundedSeek,
  createPlaybackCommands,
  playbackDuration,
  playerQueue,
  type PlayerRecord,
} from "@/lib/music-player";

const EMPTY = {
  item: null as MusicKitMediaItem | null,
  queue: [] as MusicKitMediaItem[],
  index: -1,
  time: 0,
  duration: 0,
  state: PLAYBACK_STATE.none as number,
  shuffle: false,
  repeat: 0,
  authorized: false,
};

/** Own playback controls; follow mode yields the singleton before manual operations. */
export function useMusicPlayer(listen: ListenAlong) {
  const {
    stopForPlayback,
    start: startFollowing,
    setVolume: setFollowVolume,
  } = listen;
  const [commands] = useState(createPlaybackCommands);
  const [instance, setInstance] = useState<MusicKitInstance | null>(null);
  const instanceRef = useRef<MusicKitInstance | null>(null);
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const pending = useRef(0);
  const operationEpoch = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [engaged, setEngaged] = useState(false);
  const [record, setRecord] = useState<PlayerRecord | null>(null);
  const [mode, setMode] = useState<"manual" | "follow">("manual");
  const modeRef = useRef<"manual" | "follow">("manual");
  const mounted = useRef(true);
  const volume = useRef(listen.volume);

  useEffect(() => {
    volume.current = listen.volume;
  }, [listen.volume]);

  const read = useCallback(() => {
    const player = instanceRef.current;
    if (!player || !mounted.current) return;
    const queue = [...(player.queue?.items ?? [])];
    const id = player.nowPlayingItem?.id;
    const at = player.nowPlayingItemIndex;
    setSnapshot({
      item: player.nowPlayingItem ?? null,
      queue,
      index:
        at != null && at >= 0 && at < queue.length
          ? at
          : queue.findIndex((item) => item.id === id),
      time: Number.isFinite(player.currentPlaybackTime)
        ? Math.max(0, player.currentPlaybackTime)
        : 0,
      duration: playbackDuration(player),
      state: player.playbackState,
      shuffle: (player.shuffleMode ?? 0) !== 0,
      repeat: player.repeatMode ?? 0,
      authorized: player.isAuthorized,
    });
  }, []);

  useEffect(() => {
    if (!instance) return;
    const events = [
      "playbackStateDidChange",
      "nowPlayingItemDidChange",
      "queueItemsDidChange",
      "authorizationStatusDidChange",
      "playbackDurationDidChange",
      "playbackTimeDidChange",
    ];
    for (const name of events) instance.addEventListener(name, read);
    const timer = window.setInterval(read, 500);
    return () => {
      for (const name of events) instance.removeEventListener(name, read);
      window.clearInterval(timer);
    };
  }, [instance, read]);

  const run = useCallback(
    async (action: (cancelled: () => boolean) => Promise<void>) => {
      const epoch = operationEpoch.current;
      pending.current += 1;
      setBusy(true);
      setError(null);
      try {
        await commands.run(async (cancelled) => {
          try {
            await action(cancelled);
          } catch (caught) {
            if (!cancelled()) throw caught;
          }
        });
      } catch (caught) {
        if (mounted.current && epoch === operationEpoch.current)
          setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (epoch === operationEpoch.current) pending.current -= 1;
        if (mounted.current && epoch === operationEpoch.current) {
          setBusy(pending.current > 0);
          read();
        }
      }
    },
    [commands, read],
  );

  const connect = useCallback(async (cancelled: () => boolean) => {
    const player = await getMusicKit();
    if (cancelled()) return null;
    instanceRef.current = player;
    setInstance(player);
    if (!player.isAuthorized) await player.authorize();
    if (cancelled()) return null;
    if (!player.isAuthorized)
      throw new Error("Apple Music 授权未完成，请重试登录。");
    return player;
  }, []);

  const prepareManual = useCallback(
    async (cancelled: () => boolean) => {
      const wasFollowing = modeRef.current === "follow";
      await stopForPlayback();
      if (cancelled()) return null;
      modeRef.current = "manual";
      setMode("manual");
      const player = await connect(cancelled);
      if (player) {
        player.volume = volume.current;
        player.autoplayEnabled = false;
        if (wasFollowing) {
          player.repeatMode = REPEAT_MODE.none;
          player.shuffleMode = 0;
        }
      }
      return player;
    },
    [connect, stopForPlayback],
  );

  const playRecord = useCallback(
    (next: PlayerRecord) =>
      run(async (cancelled) => {
        const queue = playerQueue(next);
        if (!queue)
          throw new Error("这条记录暂时没有可播放的 Apple Music 链接。");
        setEngaged(true);
        setRecord(next);
        const player = await prepareManual(cancelled);
        if (!player || cancelled()) return;
        await player.stop();
        if (cancelled()) return;
        await player.setQueue(queue);
        if (cancelled()) return;
        if (player.playbackState !== PLAYBACK_STATE.playing)
          await player.play();
      }),
    [prepareManual, run],
  );

  const enqueue = useCallback(
    (next: PlayerRecord) =>
      run(async (cancelled) => {
        const queue = playerQueue(next);
        if (!queue)
          throw new Error("这条记录暂时没有可播放的 Apple Music 链接。");
        if (modeRef.current === "follow")
          throw new Error("请先停止一起听，再编辑自己的播放队列。");
        const player = await connect(cancelled);
        if (!player || cancelled()) return;
        setEngaged(true);
        if (player.queue?.items?.length) await player.playLater(queue);
        else {
          setRecord(next);
          await player.setQueue(queue);
        }
      }),
    [connect, run],
  );

  const toggle = useCallback(
    (selection: PlayerRecord | null) => {
      if (!instanceRef.current?.nowPlayingItem) {
        if (selection) return playRecord(selection);
        return Promise.resolve();
      }
      return run(async (cancelled) => {
        if (modeRef.current === "follow") return;
        const player = instanceRef.current;
        if (!player || cancelled()) return;
        if (player.playbackState === PLAYBACK_STATE.playing)
          await player.pause();
        else await player.play();
      });
    },
    [playRecord, run],
  );

  const seek = useCallback(
    (time: number) =>
      run(async (cancelled) => {
        const player = instanceRef.current;
        if (!player || cancelled() || modeRef.current === "follow") return;
        const duration = playbackDuration(player);
        if (duration > 0) await player.seekToTime(boundedSeek(time, duration));
      }),
    [run],
  );

  const changeItem = useCallback(
    (index: number) =>
      run(async (cancelled) => {
        const player = instanceRef.current;
        if (!player || cancelled() || modeRef.current === "follow") return;
        if (index < 0 || index >= (player.queue?.items?.length ?? 0)) return;
        await player.pause();
        if (cancelled()) return;
        await player.changeToMediaAtIndex(index);
        if (!cancelled() && player.playbackState !== PLAYBACK_STATE.playing)
          await player.play();
      }),
    [run],
  );

  const previous = useCallback(() => {
    if ((instanceRef.current?.currentPlaybackTime ?? 0) > 3) return seek(0);
    return changeItem(snapshot.index - 1);
  }, [changeItem, seek, snapshot.index]);
  const next = useCallback(
    () => changeItem(snapshot.index + 1),
    [changeItem, snapshot.index],
  );

  const toggleShuffle = useCallback(
    () =>
      run(async () => {
        const player = instanceRef.current;
        if (player && modeRef.current === "manual")
          player.shuffleMode = player.shuffleMode ? 0 : 1;
      }),
    [run],
  );
  const cycleRepeat = useCallback(
    () =>
      run(async () => {
        const player = instanceRef.current;
        if (!player || modeRef.current === "follow") return;
        player.repeatMode =
          player.repeatMode === REPEAT_MODE.none
            ? REPEAT_MODE.all
            : player.repeatMode === REPEAT_MODE.all
              ? REPEAT_MODE.one
              : REPEAT_MODE.none;
      }),
    [run],
  );

  const setVolume = useCallback(
    (value: number) => {
      const next = Math.max(0, Math.min(1, value));
      volume.current = next;
      setFollowVolume(next);
      if (instanceRef.current && modeRef.current === "manual")
        instanceRef.current.volume = next;
    },
    [setFollowVolume],
  );

  const stop = useCallback(() => {
    commands.cancel();
    operationEpoch.current += 1;
    pending.current = 0;
    setBusy(false);
    setError(null);
    setEngaged(false);
    setRecord(null);
    modeRef.current = "manual";
    setMode("manual");
    const drained = stopForPlayback();
    const player = instanceRef.current;
    // Silence immediately; final stop waits for any in-flight setQueue / authorization.
    if (player) void Promise.resolve(player.pause()).catch(() => {});
    return commands
      .run(async () => {
        await drained;
        await player?.stop();
        if (mounted.current) read();
      })
      .catch((caught: unknown) => {
        if (mounted.current)
          setError(caught instanceof Error ? caught.message : String(caught));
      });
  }, [commands, stopForPlayback, read]);

  const follow = useCallback(() => {
    commands.cancel();
    return run(async (cancelled) => {
      await stopForPlayback();
      if (cancelled()) return;
      await instanceRef.current?.stop();
      const player = await connect(cancelled);
      if (!player || cancelled()) return;
      player.shuffleMode = 0;
      modeRef.current = "follow";
      setMode("follow");
      setEngaged(true);
      startFollowing();
    });
  }, [commands, connect, startFollowing, stopForPlayback, run]);

  const login = useCallback(
    () =>
      run(async (cancelled) => {
        await connect(cancelled);
      }),
    [connect, run],
  );
  const logout = useCallback(async () => {
    await stop();
    await run(async () => {
      await instanceRef.current?.unauthorize();
    });
  }, [run, stop]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      commands.cancel();
      void commands
        .run(async () => {
          await instanceRef.current?.stop();
        })
        .catch(() => {});
    };
  }, [commands]);

  return {
    ...snapshot,
    mode,
    busy: busy || listen.status === "starting",
    engaged,
    record,
    error: error ?? (mode === "follow" ? listen.error : null),
    waiting: mode === "follow" && listen.waiting,
    audible: mode !== "follow" || listen.audible,
    volume: listen.volume,
    playRecord,
    enqueue,
    toggle,
    seek,
    previous,
    next,
    changeItem,
    toggleShuffle,
    cycleRepeat,
    setVolume,
    stop,
    follow,
    login,
    logout,
    dismissError: () => setError(null),
  };
}

export type MusicPlayer = ReturnType<typeof useMusicPlayer>;
