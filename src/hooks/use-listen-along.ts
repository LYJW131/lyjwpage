"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  captureLagMs,
  followTargetMs,
  isHostSeek,
  needsResync,
  queueStartMs,
} from "@/lib/listen-along";
import {
  getMusicKit,
  MUSICKIT_TOKEN_ENDPOINT,
  PLAYBACK_STATE,
  type MusicKitInstance,
} from "@/lib/musickit";
import { mediaItemIndex } from "@/lib/playing-queue";
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
 *   换歌 → 重排队列并从锚点起播；主人暂停 → 跟着暂停；主人续播 → 对齐再放；
 *   主人拖动进度 → 新锚点和本地对不上，就地重新对齐。
 * 另外挂一个慢速巡检，兜住访客这侧缓冲卡顿慢慢攒出来的偏差。
 *
 * 换歌时新曲子要缓冲几秒，主人的进度条已经在走。起播点用锚点（几乎是 0），
 * 不要用 trackPositionMs 那种「此刻」—— 那会把缓冲耗时切掉。出声之后把这段
 * 耗时记成滞后，巡检只追额外落后，不会过一会儿再 seek 跳掉中间一截。
 *
 * 上报器给了 Playing Next 时，服务端会先搜后面两首的目录 ID。这边 playNext
 * 预排进去，主人换到预排的那首就 changeToMediaAtIndex，不再整队 setQueue。
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
/** 换歌后等 MusicKit 真正出声。超时就不再干等，后面的 play / 巡检接着兜 */
const READY_TIMEOUT_MS = 25_000;

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "未知错误";
}

function localPositionMs(music: MusicKitInstance): number {
  const seconds = music.currentPlaybackTime;
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0;
}

/**
 * setQueue 的 Promise 在队列排好时就 resolve，音频往往还在 loading。
 * 没出声就算「跟好听了」会立刻按主人此刻去 seek，正好把刚要播的开头切掉。
 */
async function syncUpcomingQueue(music: MusicKitInstance, ids: string[]) {
  if (ids.length === 0) return;
  await music.playNext({ song: ids[0] }, true);
  for (const id of ids.slice(1)) {
    await music.playLater({ song: id });
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
    // 事件偶发漏掉，隔一会儿再看一眼状态
    const poll = window.setInterval(onState, 250);
    music.addEventListener("playbackStateDidChange", onState);
    onState();
  });
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
  /** 这首已经真正出声。加载期间巡检和「同一首」对齐都不得碰它 */
  const readySongId = useRef<string | null>(null);
  /** 出声时主人已经超前的毫秒数，巡检从目标里扣掉，见 playbackLagMs */
  const lagMs = useRef(0);
  /** 这次 setQueue 定下的起播点。加载中 effect 重跑也还用这个，不能改成主人此刻 */
  const intendedStartMs = useRef(0);
  const upcomingRef = useRef(upcomingSongIds);
  upcomingRef.current = upcomingSongIds;

  /*
   * 锚点拆成原始值再进依赖列表。
   *
   * 直接依赖 track 那个对象的话，取数每轮返回的新引用都会让对齐白跑一遍 ——
   * 而「跑一遍」在这里不是空转：它会在 MusicKit 还在 loading 时补一次 play()。
   * 拆开之后只有真的换了锚点才重跑。默认值取 stopped，「没有曲目」和「停了」
   * 在下面本来就是同一条分支。
   */
  const state = track?.state ?? "stopped";
  const observedAt = track?.observedAt ?? 0;
  const positionMs = track?.positionMs ?? 0;
  const durationMs = track?.durationMs ?? 0;
  const repeatOne = track?.repeatOne ?? false;

  const stop = useCallback(() => {
    queuedSongId.current = null;
    readySongId.current = null;
    lagMs.current = 0;
    intendedStartMs.current = 0;
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

  /** 跟着锚点走。这是主要的同步时机：换歌、暂停、续播、拖进度都在这里落地 */
  useEffect(() => {
    if (!music) return;

    let cancelled = false;
    const isCancelled = () => cancelled;
    void (async () => {
      try {
        // 主人没在放（暂停、停了、或者这首在目录里搜不到）：跟着停下来待命
        if (!songId || state !== "playing") {
          if (music.playbackState === PLAYBACK_STATE.playing) await music.pause();
          return;
        }

        const hostNow = () =>
          trackPositionMs(
            { state, observedAt, positionMs, durationMs, repeatOne },
            Date.now(),
          );

        // 换歌（或刚点一起听）：预排过的走队列跳转，否则整队重排。
        if (queuedSongId.current !== songId) {
          intendedStartMs.current = queueStartMs({
            changingTrack: queuedSongId.current !== null,
            positionMs,
            hostPositionMs: hostNow(),
          });
          queuedSongId.current = songId;
          readySongId.current = null;
          lagMs.current = 0;
          const preparedAt = mediaItemIndex(music.queue?.items ?? [], songId);
          if (preparedAt > 0) {
            try {
              await music.changeToMediaAtIndex(preparedAt);
            } catch {
              await music.setQueue({
                song: songId,
                startPlaying: true,
                startTime: intendedStartMs.current / 1000,
              });
            }
          } else if (preparedAt !== 0) {
            await music.setQueue({
              song: songId,
              startPlaying: true,
              startTime: intendedStartMs.current / 1000,
            });
          }
        }

        if (cancelled) return;

        // 还没出声：接着等。effect 在缓冲中重跑也走这里，不能按主人此刻去 seek
        if (readySongId.current !== songId) {
          await waitUntilPlaying(music, isCancelled);
          if (cancelled || queuedSongId.current !== songId) return;
          // MusicKit 偶发不理 startTime，起播点和我们要的差太远就再点一次
          if (needsResync(localPositionMs(music), intendedStartMs.current, RESYNC_THRESHOLD_MS)) {
            await music.seekToTime(intendedStartMs.current / 1000);
          }
          if (cancelled || queuedSongId.current !== songId) return;
          if (music.playbackState !== PLAYBACK_STATE.playing) await music.play();
          if (cancelled || queuedSongId.current !== songId) return;
          readySongId.current = songId;
          lagMs.current = captureLagMs(
            hostNow(),
            localPositionMs(music),
            intendedStartMs.current,
            RESYNC_THRESHOLD_MS,
          );
          void syncUpcomingQueue(music, upcomingRef.current).catch(() => {});
          return;
        }

        const host = hostNow();
        const local = localPositionMs(music);
        if (isHostSeek(local, lagMs.current, host, RESYNC_THRESHOLD_MS)) {
          lagMs.current = 0;
          await music.seekToTime(host / 1000);
        }
        if (cancelled) return;
        if (music.playbackState !== PLAYBACK_STATE.playing) await music.play();
      } catch (caught) {
        if (cancelled) return;
        /*
         * 最常见的一种：这首在访客所在区域的目录里没有。songId 是按站点的
         * storefront 解出来的，各地授权范围不一样，换个国家就可能查无此曲。
         * 队列标记要清掉，否则主人换回这首时会被当成「已经排好了」而不再重试。
         */
        queuedSongId.current = null;
        readySongId.current = null;
        lagMs.current = 0;
        intendedStartMs.current = 0;
        setError(describe(caught));
        setStatus("error");
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
        void music.seekToTime(target / 1000).catch(() => {});
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

    void syncUpcomingQueue(music, upcomingSongIds).catch(() => {});
  }, [music, songId, state, upcomingKey, upcomingSongIds]);

  /**
   * 曲目播完先停住。队列里有预排的下一首时，MusicKit 会自己跳，主人还没换
   * 就会超前。等锚点来了再 changeToMediaAtIndex。
   */
  useEffect(() => {
    if (!music) return;
    const onState = () => {
      if (music.playbackState === PLAYBACK_STATE.ended) {
        void music.pause().catch(() => {});
      }
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
