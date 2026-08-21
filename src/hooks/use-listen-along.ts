"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  followTargetMs,
  isHostSeek,
  needsResync,
} from "@/lib/listen-along";
import {
  getMusicKit,
  MUSICKIT_TOKEN_ENDPOINT,
  PLAYBACK_STATE,
  type MusicKitInstance,
} from "@/lib/musickit";
import { catalogItemId, mediaItemIndex } from "@/lib/playing-queue";
import { trackPositionMs } from "@/lib/track-position";
import type { LocalNowPlaying } from "@/lib/types";

/**
 * 跟着此刻在播的那首一起听。
 *
 * 访客用**自己的** Apple Music 订阅授权，MusicKit 在他自己那边放同一首、对到
 * 同一个进度。站点这侧不转发任何音频 —— 传过去的只有一个目录 ID 和一个秒数，
 * 播放和计费都发生在访客和 Apple 之间。我的那份 music user token 不出服务器，
 * 它连这条路径都碰不到（见 lib/musickit 开头）。
 *
 * 「跟随」具体指四件事，都由锚点变化驱动：
 *   刚点一起听 → 静音加载，出声后 seek 到主人此刻再恢复音量；
 *   正常下一首（已预排）→ 本首走完直接切，从 0 起，不 seek；
 *   主人暂停 / 续播 / 拖进度 → 跟着停、对齐、跟过去。
 * 另外挂一个慢速巡检，兜住访客这侧缓冲卡顿慢慢攒出来的偏差。
 *
 * MusicKit 不 play 就不会去拉 HLS。刚加入必须 play 再 seek；已经在跟的时候
 * 换到预排的下一首，进度两边都从 0 附近走，再 seek 会把开头切掉。
 *
 * 上报器给了 Playing Next 时，服务端会先搜后面两首的目录 ID。这边 playNext
 * 预排进去。本首结束就 skipToNext，不等主人锚点；主人暂停才停。
 */

export type ListenAlongStatus =
  /** 没配签发地址，功能整体不可用 */
  | "unavailable"
  /** 可用，还没开始 */
  | "idle"
  /** 正在加载 MusicKit / 取令牌 / 等访客在弹窗里授权 */
  | "starting"
  /** 正在跟听。主人暂停时也停在这个状态 —— 是「跟着暂停」，不是「断了」 */
  | "following"
  | "error";

/**
 * 偏差超过这么多就重新对齐。
 *
 * 定小了会被 seek 抖来抖去（每次 seek 本身要重新缓冲，反而拉大偏差），定大了
 * 「一起听」就名不副实。5 秒是一句歌词的长度，超过这个数两边听感上已经错开了。
 */
const RESYNC_THRESHOLD_MS = 5_000;
/** 巡检间隔。锚点变化是主要的同步时机，这个只兜缓冲卡顿攒出来的偏差，给得很松 */
const RESYNC_INTERVAL_MS = 20_000;
/** 换歌后等真正出声。超时就不再干等，后面的 seek 接着兜 */
const READY_TIMEOUT_MS = 25_000;

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "未知错误";
}

function localPositionMs(music: MusicKitInstance): number {
  const seconds = music.currentPlaybackTime;
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0;
}

function localSongId(music: MusicKitInstance): string | null {
  return catalogItemId(music.nowPlayingItem?.id);
}

function hasQueuedNext(music: MusicKitInstance): boolean {
  const items = music.queue?.items ?? [];
  const current = localSongId(music);
  if (!current) return items.length > 1;
  const at = mediaItemIndex(items, current);
  return at >= 0 && at < items.length - 1;
}

async function syncUpcomingQueue(music: MusicKitInstance, ids: string[]) {
  if (ids.length === 0 || upcomingAlreadyQueued(music, ids)) return;
  await mkSafe(() => music.playNext({ song: ids[0] }, true));
  for (const id of ids.slice(1)) {
    await mkSafe(() => music.playLater({ song: id }));
  }
}

function waitUntilPlaying(music: MusicKitInstance, cancelled: () => boolean): Promise<void> {
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
    const timeout = window.setTimeout(finish, READY_TIMEOUT_MS);
    const poll = window.setInterval(onState, 250);
    music.addEventListener("playbackStateDidChange", onState);
    onState();
  });
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

/** play() 还没落地就 seek / 再 play，Chrome 会丢 AbortError，MusicKit 还会弹窗 */
async function playSafe(music: MusicKitInstance) {
  await mkSafe(() => music.play());
}

function upcomingAlreadyQueued(music: MusicKitInstance, ids: string[]) {
  if (ids.length === 0) return true;
  const items = music.queue?.items ?? [];
  const current = localSongId(music);
  const at = current ? mediaItemIndex(items, current) : -1;
  if (at < 0) return false;
  return ids.every((id, i) => catalogItemId(items[at + 1 + i]?.id) === id);
}

/** 加载和对齐期间把喇叭关掉。MusicKit 的 volume 是 0–1 */
function mute(music: MusicKitInstance) {
  const previous = Number.isFinite(music.volume) ? music.volume : 1;
  music.volume = 0;
  return previous;
}

export type ListenAlong = {
  status: ListenAlongStatus;
  /** 访客已经授权过（MusicKit 把用户令牌记在本地，再来不用重新弹窗） */
  authorized: boolean;
  error: string | null;
  /** 主人此刻没在放，跟听处于待命 —— 他一开始放就自动跟上 */
  waiting: boolean;
  start: () => void;
  stop: () => void;
};

export function useListenAlong(source: {
  track: LocalNowPlaying | null;
  /** 目录里那首曲子的资源 ID。搜不到就是 null，那时没有可播的东西 */
  songId: string | null;
  /** 当前曲后面两首的目录 ID，已经在服务端搜过 */
  upcomingSongIds?: string[];
}): ListenAlong {
  const { track, songId, upcomingSongIds = [] } = source;

  const [music, setMusic] = useState<MusicKitInstance | null>(null);
  const [status, setStatus] = useState<ListenAlongStatus>(
    MUSICKIT_TOKEN_ENDPOINT ? "idle" : "unavailable",
  );
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 已经排进队列的那首。
   *
   * 用来分辨「换歌」和「同一首但状态变了」：前者要重排队列，后者只要对齐进度。
   * 放 ref 不放 state —— 它只在 effect 和事件里读写，进渲染只会多一轮。
   */
  const queuedSongId = useRef<string | null>(null);
  /** 这首已经加载完并对过进度。加载期间巡检和「同一首」对齐都不得碰它 */
  const readySongId = useRef<string | null>(null);
  /** 这轮跟听是否已经对过第一次进度。换歌用它区分「刚加入」和「正常下一首」 */
  const hasFollowed = useRef(false);
  /** 主人锚点上一次对齐到的那首。本首走完先切下一首时，用它避免被拖回刚播完的那首 */
  const lastHostSongId = useRef<string | null>(null);
  /** 出声时主人已经超前的毫秒数。加载后再对进度，通常是 0 */
  const lagMs = useRef(0);
  const upcomingRef = useRef(upcomingSongIds);
  useEffect(() => {
    upcomingRef.current = upcomingSongIds;
  }, [upcomingSongIds]);
  const songIdRef = useRef(songId);
  useEffect(() => {
    songIdRef.current = songId;
  }, [songId]);

  /**
   * MusicKit 的 play / skip / setQueue 不能重叠，否则会 AbortError 弹窗，
   * 音频再被后面那次 load 拽一截。所有改播放的操作排成一条链。
   */
  const opChain = useRef(Promise.resolve());
  const runExclusive = (fn: () => Promise<void>) => {
    const next = opChain.current.then(fn, fn);
    opChain.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const state = track?.state ?? "stopped";
  const observedAt = track?.observedAt ?? 0;
  const positionMs = track?.positionMs ?? 0;
  const durationMs = track?.durationMs ?? 0;
  const repeatOne = track?.repeatOne ?? false;
  const hostRef = useRef({ state, observedAt, positionMs, durationMs, repeatOne });
  useEffect(() => {
    hostRef.current = { state, observedAt, positionMs, durationMs, repeatOne };
  }, [state, observedAt, positionMs, durationMs, repeatOne]);
  const hostNow = () => trackPositionMs(hostRef.current, Date.now());

  const stop = useCallback(() => {
    queuedSongId.current = null;
    readySongId.current = null;
    hasFollowed.current = false;
    lastHostSongId.current = null;
    lagMs.current = 0;
    // 走得到这里就说明配了签发地址（没配的话按钮根本不渲染），不必再判一次
    setStatus("idle");
    /*
     * 真的让它停下来交给下面那个 effect 的清理 —— music 变成 null 时它就会跑。
     * 在这里顺手调一次也不是不行，但放进 setState 的更新函数里不干净：严格模式
     * 会把更新函数跑两遍，于是 stop() 也跟着发两次。
     */
    setMusic(null);
  }, []);

  const start = useCallback(() => {
    setError(null);
    setStatus("starting");

    void (async () => {
      try {
        const instance = await getMusicKit();
        /*
         * 已经授权过就不再弹窗。MusicKit 把用户令牌存在本地，第二次进来
         * isAuthorized 直接是 true —— 每次都弹一遍会很烦人。
         */
        if (!instance.isAuthorized) await instance.authorize();
        setAuthorized(instance.isAuthorized);
        setMusic(instance);
        setStatus("following");
      } catch (caught) {
        /*
         * 访客自己关掉授权弹窗也走到这里。这不是故障，但也不该假装成功 ——
         * 说清楚怎么回事，按钮回到可点的样子让他再来一次。
         */
        setError(describe(caught));
        setStatus("error");
      }
    })();
  }, []);

  /**
   * 换歌 / 起播。进度上报会不停刷新锚点，不能放进这个 effect 的依赖 ——
   * 否则等出声的那几秒会被反复取消，永远 play 不起来。
   */
  useEffect(() => {
    if (!music) return;

    let cancelled = false;
    void runExclusive(async () => {
      if (cancelled) return;
      try {
        if (!songId || state !== "playing") {
          if (music.playbackState === PLAYBACK_STATE.playing) await mkSafe(() => music.pause());
          return;
        }

        if (readySongId.current === songId) {
          if (lastHostSongId.current !== songId) {
            lagMs.current = hostNow() - localPositionMs(music);
          }
          lastHostSongId.current = songId;
          return;
        }

        const localId = localSongId(music);
        if (localId === songId) {
          // 已经在播这首（本首走完自己切过来的）：不要再 skip / play / seek
          queuedSongId.current = songId;
          readySongId.current = songId;
          hasFollowed.current = true;
          lastHostSongId.current = songId;
          lagMs.current = hostNow() - localPositionMs(music);
          return;
        }

        // 本首走完已经切到下一首，主人锚点还停在刚播完的那首：别拖回去。
        if (lastHostSongId.current === songId && localId && localId !== songId) {
          return;
        }

        const joining = !hasFollowed.current;
        const previousVolume = joining ? mute(music) : music.volume;
        try {
          if (queuedSongId.current !== songId) {
            queuedSongId.current = songId;
            readySongId.current = null;
            lagMs.current = 0;
            const preparedAt = mediaItemIndex(music.queue?.items ?? [], songId);
            if (preparedAt > 0) {
              try {
                await music.changeToMediaAtIndex(preparedAt);
              } catch (error) {
                if (!isPlayInterrupted(error)) await mkSafe(() => music.setQueue({ song: songId }));
              }
            } else if (preparedAt !== 0) {
              await mkSafe(() => music.setQueue({ song: songId }));
            }
          }
          if (cancelled || queuedSongId.current !== songId) return;
          if (localSongId(music) === songId && music.playbackState === PLAYBACK_STATE.playing) {
            readySongId.current = songId;
            hasFollowed.current = true;
            lastHostSongId.current = songId;
            lagMs.current = hostNow() - localPositionMs(music);
            return;
          }
          if (music.playbackState !== PLAYBACK_STATE.playing) await playSafe(music);
          if (cancelled || queuedSongId.current !== songId) return;
          await waitUntilPlaying(music, () => cancelled);
          if (cancelled || queuedSongId.current !== songId) return;

          if (joining) {
            try {
              await mkSafe(() => music.seekToTime(hostNow() / 1000));
            } catch {
              // seek 失败就停在加载完的位置，总比没声音强
            }
            if (cancelled || queuedSongId.current !== songId) return;
            if (music.playbackState !== PLAYBACK_STATE.playing) await playSafe(music);
            if (cancelled || queuedSongId.current !== songId) return;
            await waitUntilPlaying(music, () => cancelled);
            if (cancelled || queuedSongId.current !== songId) return;
            lagMs.current = 0;
          } else {
            lagMs.current = hostNow() - localPositionMs(music);
          }

          readySongId.current = songId;
          hasFollowed.current = true;
          lastHostSongId.current = songId;
          if (joining) music.volume = previousVolume;
          await syncUpcomingQueue(music, upcomingRef.current);
        } finally {
          if (joining && music.volume === 0) music.volume = previousVolume;
        }
      } catch (caught) {
        if (cancelled) return;
        queuedSongId.current = null;
        readySongId.current = null;
        hasFollowed.current = false;
        lastHostSongId.current = null;
        lagMs.current = 0;
        setError(describe(caught));
        setStatus("error");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [music, songId, state]);

  /** 已经在跟同一首：主人拖进度才 seek。加载中不管，交给上面那个 effect */
  useEffect(() => {
    if (!music || !songId || state !== "playing") return;
    if (readySongId.current !== songId) return;

    let cancelled = false;
    void (async () => {
      try {
        const host = hostNow();
        const local = localPositionMs(music);
        if (!isHostSeek(local, lagMs.current, host, RESYNC_THRESHOLD_MS)) {
          if (cancelled) return;
          if (music.playbackState !== PLAYBACK_STATE.playing) {
            await runExclusive(() => playSafe(music));
          }
          return;
        }
        await runExclusive(async () => {
          if (cancelled || readySongId.current !== songId) return;
          const nowHost = hostNow();
          const nowLocal = localPositionMs(music);
          if (!isHostSeek(nowLocal, lagMs.current, nowHost, RESYNC_THRESHOLD_MS)) return;
          lagMs.current = 0;
          await mkSafe(() => music.seekToTime(nowHost / 1000));
          if (cancelled) return;
          if (music.playbackState !== PLAYBACK_STATE.playing) await playSafe(music);
        });
      } catch {
        // 巡检会再兜一次
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [music, songId, state, observedAt, positionMs, durationMs, repeatOne]);

  /**
   * 慢速巡检：访客这侧缓冲卡一下就会落后，而那期间不会有新锚点来纠正。
   *
   * 锚点变化会顺带重建这个定时器（依赖列表里有），不要紧 —— 它本来就只是兜底，
   * 而锚点变化那一刻刚刚对齐过，重新计时反而是对的。
   */
  useEffect(() => {
    if (!music || !songId || state !== "playing") return;

    const timer = window.setInterval(() => {
      if (music.playbackState !== PLAYBACK_STATE.playing) return;
      // 还没出声（换歌缓冲）就不管，交给上面那个 effect
      if (readySongId.current !== songId) return;

      const host = trackPositionMs(
        { state, observedAt, positionMs, durationMs, repeatOne },
        Date.now(),
      );
      const target = followTargetMs(host, lagMs.current);
      if (needsResync(localPositionMs(music), target, RESYNC_THRESHOLD_MS)) {
        void runExclusive(async () => {
          if (readySongId.current !== songId) return;
          await mkSafe(() => music.seekToTime(target / 1000));
        });
      }
    }, RESYNC_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [music, songId, state, observedAt, positionMs, durationMs, repeatOne]);

  /**
   * 当前曲出声之后，把后面两首插进 MusicKit 队列。
   *
   * playNext 插在正在放的后面；先 clear 再 playLater，避免上次预排的残留
   * 和这次的顺序缠在一起。预排不是出声保证，但目录条目和播放地址能提前准备。
   */
  const upcomingKey = upcomingSongIds.join(",");
  useEffect(() => {
    if (!music || !songId || state !== "playing") return;
    if (readySongId.current !== songId) return;

    void runExclusive(async () => {
      if (readySongId.current !== songId) return;
      await syncUpcomingQueue(music, upcomingSongIds);
    }).catch(() => {});
  }, [music, songId, state, upcomingKey, upcomingSongIds]);

  /**
   * 本首走完直接切预排的下一首。主人那边还没换也先走，他暂停了再停。
   * 不在这里 play：skipToNext 自己会起播，再 play 会把进行中的 load 掐掉并弹窗。
   */
  useEffect(() => {
    if (!music) return;
    const onState = () => {
      if (music.playbackState !== PLAYBACK_STATE.ended) return;
      void runExclusive(async () => {
        if (music.playbackState !== PLAYBACK_STATE.ended) return;
        if (localSongId(music) === songIdRef.current) return;
        if (!hasQueuedNext(music)) return;
        await mkSafe(() => music.skipToNextItem());
        const next = localSongId(music);
        if (next) {
          queuedSongId.current = next;
          readySongId.current = next;
          lagMs.current = 0;
        }
      });
    };
    music.addEventListener("playbackStateDidChange", onState);
    return () => music.removeEventListener("playbackStateDidChange", onState);
  }, [music]);

  /**
   * 收尾。点「停止」（music 置 null）和卡片卸载（换页、布局切换）都走这里 ——
   * 两种情况都不该把声音留在后台继续放。
   *
   * stop 而不是 pause：队列一起清掉，不在访客的媒体控件里留一个停住的条目。
   */
  useEffect(() => {
    if (!music) return;
    return () => {
      void music.stop().catch(() => {});
    };
  }, [music]);

  return {
    status,
    authorized,
    error,
    waiting: status === "following" && (!songId || state !== "playing"),
    start,
    stop,
  };
}
