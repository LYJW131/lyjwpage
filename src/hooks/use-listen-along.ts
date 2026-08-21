"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  getMusicKit,
  MUSICKIT_TOKEN_ENDPOINT,
  PLAYBACK_STATE,
  type MusicKitInstance,
} from "@/lib/musickit";
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
 *   换歌 → 重排队列并从对应进度起播；主人暂停 → 跟着暂停；主人续播 → 对齐再放；
 *   主人拖动进度 → 新锚点和本地对不上，就地重新对齐。
 * 另外挂一个慢速巡检，兜住访客这侧缓冲卡顿慢慢攒出来的偏差。
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

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "未知错误";
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
}): ListenAlong {
  const { track, songId } = source;

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
    void (async () => {
      try {
        // 主人没在放（暂停、停了、或者这首在目录里搜不到）：跟着停下来待命
        if (!songId || state !== "playing") {
          if (music.playbackState === PLAYBACK_STATE.playing) await music.pause();
          return;
        }

        const target = trackPositionMs(
          { state, observedAt, positionMs, durationMs, repeatOne },
          Date.now(),
        );

        // 换歌：重排队列，直接从对应进度起播，不用先播再 seek
        if (queuedSongId.current !== songId) {
          queuedSongId.current = songId;
          await music.setQueue({ song: songId, startPlaying: true, startTime: target / 1000 });
          return;
        }

        if (cancelled) return;

        // 同一首：主人续播或拖了进度。差得多才 seek，差一点点听不出来
        if (Math.abs(music.currentPlaybackTime * 1000 - target) > RESYNC_THRESHOLD_MS) {
          await music.seekToTime(target / 1000);
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
      // 队列还没排到这首（换歌那一下还在路上）就不管，交给上面那个 effect
      if (queuedSongId.current !== songId) return;

      const target = trackPositionMs(
        { state, observedAt, positionMs, durationMs, repeatOne },
        Date.now(),
      );
      if (Math.abs(music.currentPlaybackTime * 1000 - target) > RESYNC_THRESHOLD_MS) {
        void music.seekToTime(target / 1000).catch(() => {});
      }
    }, RESYNC_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [music, songId, state, observedAt, positionMs, durationMs, repeatOne]);

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
