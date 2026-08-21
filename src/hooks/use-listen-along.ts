"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  followTargetMs,
  hostRewoundIntoTrack,
  isHostSeek,
  needsResync,
  playbackLagMs,
  shouldSeekAfterTrackChange,
} from "@/lib/listen-along";
import {
  applyRepeatMode,
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
 *   正常下一首（已预排）→ 结尾渐弱，剩 2 秒预切过去静音加载，好了停在 0。
 *   出声看这首按锚点算出的结束时刻，不看他切歌的信号。预切没赶上的话
 *   直接切，加载耗时记成这一首的滞后；锚点已经在歌中间、或播放状态变
 *   了、或同一首进度差过大，才对齐；
 *   单曲循环 → 不要接下首，这一首从头再来；
 *   主人暂停 / 续播 / 拖进度 → 跟着停、对齐、跟过去。
 * 另外挂一个慢速巡检，兜住访客这侧缓冲卡顿慢慢攒出来的偏差。
 *
 * MusicKit 不 play 就不会去拉 HLS。刚加入必须 play 再 seek。预排进队列之后
 * 打开 autoplay，本首结束由播放器切下一首。单曲循环时关掉 autoplay、改成
 * repeat one，这一首自己转，不接队列里的下一首。
 *
 * 上报器给了 Playing Next 时，服务端会先搜后面两首的目录 ID。这边 playNext
 * 预排进去。主人暂停才停。
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
/** 单曲循环 ended 后先让 MusicKit 自己重启这么久，它没动再手动从头放 */
const REPEAT_RESTART_GRACE_MS = 1_200;
/**
 * 预切点：主人这首还剩这么多毫秒时切到下一首去加载。切早了结尾丢得多，
 * 切晚了下一首出声晚 —— 取结尾只牺牲两秒。出声不再等他的切歌信号，
 * 按这首锚点算出的结束时刻解除静音。
 */
const SWITCH_LEAD_MS = 2_000;
/** 渐弱起点：预切前先把音量压下去，结尾不硬生生断掉 */
const SWITCH_FADE_START_MS = 5_000;
const SWITCH_FADE_STEP_MS = 100;

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

/** 预切要接的下一首：上报的 Playing Next，或队列里当前曲后面那首 */
function nextPreparedId(music: MusicKitInstance, current: string, upcoming: string[]) {
  if (upcoming[0] && upcoming[0] !== current) return upcoming[0];
  const at = mediaItemIndex(music.queue?.items ?? [], current);
  if (at < 0) return null;
  return catalogItemId(music.queue?.items?.[at + 1]?.id);
}

/** 切到目录里的某一首：已在队列里就按位置切（省一次整队重排），不在才 setQueue */
async function changeToSong(music: MusicKitInstance, songId: string) {
  const at = mediaItemIndex(music.queue?.items ?? [], songId);
  if (at >= 0) {
    try {
      await music.changeToMediaAtIndex(at);
      return;
    } catch (error) {
      if (isPlayInterrupted(error)) return;
    }
  }
  await mkSafe(() => music.setQueue({ song: songId }));
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
  /** 喇叭已经打开。刚加入时先静音加载，这时候还是 false */
  audible: boolean;
  start: () => void;
  stop: () => void;
  logout: () => void;
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
  const [audible, setAudible] = useState(false);

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
  /** 这首已经按「换歌规则」处理过：后面同一首的进度更新才判断要不要 seek */
  const alignedSongId = useRef<string | null>(null);
  /** 出声时主人已经超前的毫秒数。加载后再对进度，通常是 0 */
  const lagMs = useRef(0);
  /** 预切停在 0 之后，到这个墙上时刻才解除静音。0 表示没有在等 */
  const holdUntilMs = useRef(0);
  const holdVolume = useRef(1);
  const holdTimer = useRef<number | null>(null);
  /** 已经按这首结束时刻预切过去的下一首。切歌信号到了只认 id，不要再 play */
  const prearmedSongId = useRef<string | null>(null);
  const upcomingRef = useRef(upcomingSongIds);
  useEffect(() => {
    upcomingRef.current = upcomingSongIds;
  }, [upcomingSongIds]);
  const songIdRef = useRef(songId);
  useEffect(() => {
    songIdRef.current = songId;
  }, [songId]);
  const musicRef = useRef(music);
  useEffect(() => {
    musicRef.current = music;
  }, [music]);

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
  const repeatOneRef = useRef(repeatOne);
  useEffect(() => {
    repeatOneRef.current = repeatOne;
  }, [repeatOne]);
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
    alignedSongId.current = null;
    lagMs.current = 0;
    holdUntilMs.current = 0;
    prearmedSongId.current = null;
    if (holdTimer.current != null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setAudible(false);
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
    setAudible(false);
    setStatus("starting");

    void (async () => {
      try {
        const instance = await getMusicKit();
        /*
         * 已经授权过就不再弹窗。MusicKit 把用户令牌存在本地，第二次进来
         * isAuthorized 直接是 true —— 每次都弹一遍会很烦人。
         */
        if (!instance.isAuthorized) await instance.authorize();
        applyRepeatMode(instance, repeatOneRef.current);
        setAuthorized(instance.isAuthorized);
        setMusic(instance);
        setStatus("following");
      } catch (caught) {
        /*
         * 访客自己关掉授权弹窗也走到这里。这不是故障，但也不该假装成功 ——
         * 说清楚怎么回事，按钮回到可点的样子让他再来一次。
         */
        setError(describe(caught));
        setAudible(false);
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
          if (lastHostSongId.current === songId) return;
          lastHostSongId.current = songId;
          alignedSongId.current = songId;
          // 预切在等这首的结束时刻，切歌信号到了也不出声
          if (holdUntilMs.current > Date.now()) return;
          if (holdUntilMs.current) {
            holdUntilMs.current = 0;
            const player = musicRef.current;
            if (player) player.volume = holdVolume.current;
          }
          /*
           * 预切已经按上一首结束时刻 play 过：信号只是认下这首。
           * 再 play 一次 MusicKit 会从头再来，听感就是切两次。
           * 锚点已经在歌中间才 seek。微任务里清标记，好让同轮的进度
           * effect 也能看见，下一拍主人暂停再续播不受影响。
           */
          if (prearmedSongId.current === songId) {
            queueMicrotask(() => {
              if (prearmedSongId.current === songId) prearmedSongId.current = null;
            });
            if (shouldSeekAfterTrackChange(hostRef.current.positionMs, RESYNC_THRESHOLD_MS)) {
              await mkSafe(() => music.seekToTime(hostNow() / 1000));
              lagMs.current = 0;
            } else {
              lagMs.current = playbackLagMs(hostNow(), localPositionMs(music));
            }
            return;
          }
          if (shouldSeekAfterTrackChange(hostRef.current.positionMs, RESYNC_THRESHOLD_MS)) {
            await mkSafe(() => music.seekToTime(hostNow() / 1000));
            lagMs.current = 0;
            if (music.playbackState !== PLAYBACK_STATE.playing) await playSafe(music);
          } else {
            lagMs.current = playbackLagMs(hostNow(), localPositionMs(music));
            if (music.playbackState !== PLAYBACK_STATE.playing) await playSafe(music);
          }
          return;
        }

        const localId = localSongId(music);
        const joining = !hasFollowed.current;
        if (localId === songId) {
          // 已经在播这首（队列自己切过来的）：不要再 skip / play。
          // 刚加入仍要对到主人；正常下一首不对齐，除非锚点已经在歌中间。
          queuedSongId.current = songId;
          readySongId.current = songId;
          hasFollowed.current = true;
          lastHostSongId.current = songId;
          alignedSongId.current = songId;
          if (joining) {
            const previousVolume = mute(music);
            try {
              await mkSafe(() => music.seekToTime(hostNow() / 1000));
            } finally {
              music.volume = previousVolume;
            }
            lagMs.current = 0;
          } else if (shouldSeekAfterTrackChange(hostRef.current.positionMs, RESYNC_THRESHOLD_MS)) {
            await mkSafe(() => music.seekToTime(hostNow() / 1000));
            lagMs.current = 0;
          } else {
            lagMs.current = playbackLagMs(hostNow(), localPositionMs(music));
          }
          setAudible(true);
          return;
        }

        // 本首走完已经切到下一首，主人锚点还停在刚播完的那首：别拖回去。
        // 但他真的拖回这首重听（离结尾还很远）就得回去。单曲循环也除外 ——
        // 那是这一首再来一遍，接错了要切回去。
        if (
          !repeatOneRef.current &&
          lastHostSongId.current === songId &&
          localId &&
          localId !== songId &&
          !hostRewoundIntoTrack(
            hostNow(),
            hostRef.current.durationMs,
            SWITCH_LEAD_MS + RESYNC_THRESHOLD_MS,
          )
        ) {
          return;
        }

        const previousVolume = joining ? mute(music) : music.volume;
        try {
          if (prearmedSongId.current && prearmedSongId.current !== songId) {
            prearmedSongId.current = null;
          }
          if (queuedSongId.current !== songId) {
            queuedSongId.current = songId;
            readySongId.current = null;
            await changeToSong(music, songId);
          }
          if (cancelled || queuedSongId.current !== songId) return;
          if (localSongId(music) === songId && music.playbackState === PLAYBACK_STATE.playing) {
            readySongId.current = songId;
            hasFollowed.current = true;
            lastHostSongId.current = songId;
            alignedSongId.current = songId;
            if (joining) {
              try {
                await mkSafe(() => music.seekToTime(hostNow() / 1000));
              } catch {
                // seek 失败就停在加载完的位置，总比没声音强
              }
              lagMs.current = 0;
            } else if (shouldSeekAfterTrackChange(hostRef.current.positionMs, RESYNC_THRESHOLD_MS)) {
              await mkSafe(() => music.seekToTime(hostNow() / 1000));
              lagMs.current = 0;
            } else {
              lagMs.current = playbackLagMs(hostNow(), localPositionMs(music));
            }
            if (joining) music.volume = previousVolume;
            setAudible(true);
            return;
          }
          if (music.playbackState !== PLAYBACK_STATE.playing) await playSafe(music);
          if (cancelled || queuedSongId.current !== songId) return;
          await waitUntilPlaying(music, () => cancelled);
          if (cancelled || queuedSongId.current !== songId) return;

          if (joining || shouldSeekAfterTrackChange(hostRef.current.positionMs, RESYNC_THRESHOLD_MS)) {
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
            lagMs.current = playbackLagMs(hostNow(), localPositionMs(music));
          }

          readySongId.current = songId;
          hasFollowed.current = true;
          lastHostSongId.current = songId;
          alignedSongId.current = songId;
          if (joining) music.volume = previousVolume;
          setAudible(true);
          if (!repeatOneRef.current) await syncUpcomingQueue(music, upcomingRef.current);
        } finally {
          if (joining && music.volume === 0) music.volume = previousVolume;
        }
      } catch (caught) {
        if (cancelled) return;
        queuedSongId.current = null;
        readySongId.current = null;
        hasFollowed.current = false;
        lastHostSongId.current = null;
        alignedSongId.current = null;
        lagMs.current = 0;
        prearmedSongId.current = null;
        setAudible(false);
        setError(describe(caught));
        setStatus("error");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [music, songId, state]);

  /** 已经在跟同一首：主人拖进度或进度差过大才 seek。换歌那一下不对齐。 */
  useEffect(() => {
    if (!music || !songId || state !== "playing") return;

    let cancelled = false;
    void (async () => {
      try {
        if (readySongId.current !== songId) {
          /*
           * 播放器已经预切 / 自然接到下一首，主人却把这首拖回去重听。换歌
           * effect 的依赖（songId/state）都没变、不会再跑，只能在这里拉回来。
           * 不跟 cancelled 联动：同曲的锚点每来一条都会重建这个 effect，
           * 拉到一半被取消会卡在半路。songIdRef 变了才作废。
           */
          const parked = readySongId.current;
          if (
            !parked ||
            parked !== queuedSongId.current ||
            localSongId(music) !== parked ||
            !hostRewoundIntoTrack(hostNow(), durationMs, SWITCH_LEAD_MS + RESYNC_THRESHOLD_MS)
          ) {
            return;
          }
          await runExclusive(async () => {
            if (songIdRef.current !== songId || hostRef.current.state !== "playing") return;
            if (readySongId.current !== parked || localSongId(music) !== parked) return;
            queuedSongId.current = songId;
            readySongId.current = null;
            alignedSongId.current = null;
            await changeToSong(music, songId);
            if (queuedSongId.current !== songId) return;
            if (music.playbackState !== PLAYBACK_STATE.playing) await playSafe(music);
            await waitUntilPlaying(music, () => songIdRef.current !== songId);
            if (queuedSongId.current !== songId || songIdRef.current !== songId) return;
            await mkSafe(() => music.seekToTime(hostNow() / 1000));
            if (music.playbackState !== PLAYBACK_STATE.playing) await playSafe(music);
            lagMs.current = 0;
            readySongId.current = songId;
            alignedSongId.current = songId;
            lastHostSongId.current = songId;
          });
          return;
        }

        const songChanged = alignedSongId.current !== songId;
        const host = hostNow();
        const local = localPositionMs(music);

        if (songChanged) {
          alignedSongId.current = songId;
          if (holdUntilMs.current > Date.now()) return;
          if (holdUntilMs.current) {
            holdUntilMs.current = 0;
            const player = musicRef.current;
            if (player) player.volume = holdVolume.current;
          }
          if (!shouldSeekAfterTrackChange(positionMs, RESYNC_THRESHOLD_MS)) {
            lagMs.current = playbackLagMs(host, local);
            // 预切已经出声：切歌锚点不要再 play
            if (prearmedSongId.current === songId) return;
            if (cancelled) return;
            if (music.playbackState !== PLAYBACK_STATE.playing) {
              await runExclusive(() => playSafe(music));
            }
            return;
          }
          lagMs.current = 0;
        } else if (
          !isHostSeek(local, lagMs.current, host, RESYNC_THRESHOLD_MS, repeatOne ? durationMs : 0)
        ) {
          // 预切刚出声时 playbackState 往往还不是 playing，这里再 play 会从头再来
          if (prearmedSongId.current === songId) return;
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
          if (
            !songChanged &&
            !isHostSeek(
              nowLocal,
              lagMs.current,
              nowHost,
              RESYNC_THRESHOLD_MS,
              repeatOne ? durationMs : 0,
            )
          ) {
            return;
          }
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
      if (
        needsResync(localPositionMs(music), target, RESYNC_THRESHOLD_MS, repeatOne ? durationMs : 0)
      ) {
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
    if (repeatOne) return;

    void runExclusive(async () => {
      if (readySongId.current !== songId) return;
      await syncUpcomingQueue(music, upcomingSongIds);
    }).catch(() => {});
  }, [music, songId, state, upcomingKey, upcomingSongIds, repeatOne]);

  /**
   * 预切：剩 5 秒开始把音量线性收到 0，剩 2 秒切到下一首静音加载，停在 0。
   * 出声看这首按锚点算出的结束时刻，不看他切歌的信号。
   *
   * 进度锚点会不停刷新 observedAt / positionMs，不能放进依赖 —— 一刷新就拆
   * 定时器，渐弱和预切永远走不到，只能再等切歌信号。剩余时间从 hostRef 读。
   */
  useEffect(() => {
    const player = musicRef.current;
    if (!player || !songId || state !== "playing" || repeatOne) return;

    let baseline: number | null = null;
    let switched = false;
    const fadeSpan = SWITCH_FADE_START_MS - SWITCH_LEAD_MS;

    const tick = () => {
      if (switched || repeatOneRef.current) return;
      if (songIdRef.current !== songId || hostRef.current.state !== "playing") return;
      if (readySongId.current !== songId) return;
      const host = hostRef.current;
      if (host.durationMs <= 0) return;
      const next = nextPreparedId(player, songId, upcomingRef.current);
      if (!next) return;
      const left = host.durationMs - trackPositionMs(host, Date.now());
      if (left > SWITCH_FADE_START_MS) return;

      if (baseline == null) {
        baseline = Number.isFinite(player.volume) ? player.volume : 1;
      }
      const t = Math.min(1, Math.max(0, (SWITCH_FADE_START_MS - left) / fadeSpan));
      player.volume = baseline * (1 - t);
      if (left > SWITCH_LEAD_MS) return;

      player.volume = 0;
      switched = true;
      const endsAt = Date.now() + Math.max(0, left);
      const base = baseline;

      void runExclusive(async () => {
        /*
         * 不验 songIdRef === 旧 id：加载这几秒他的切歌信号可能已经到了，
         * 那正是我们要抢在前面做完的事，中断只会退回等信号。
         */
        if (
          repeatOneRef.current ||
          hostRef.current.state !== "playing" ||
          readySongId.current !== songId ||
          localSongId(player) !== songId
        ) {
          player.volume = base;
          switched = false;
          return;
        }
        queuedSongId.current = next;
        readySongId.current = next;
        alignedSongId.current = next;
        prearmedSongId.current = next;
        lagMs.current = 0;
        holdVolume.current = base;
        holdUntilMs.current = endsAt;
        player.volume = 0;
        try {
          await changeToSong(player, next);
          if (player.playbackState !== PLAYBACK_STATE.playing) await playSafe(player);
          await waitUntilPlaying(player, () => false);
          await mkSafe(() => player.pause());
          await mkSafe(() => player.seekToTime(0));
          player.volume = 0;
          if (holdTimer.current != null) window.clearTimeout(holdTimer.current);
          const wait = Math.max(0, holdUntilMs.current - Date.now());
          holdTimer.current = window.setTimeout(() => {
            holdTimer.current = null;
            void runExclusive(async () => {
              if (holdUntilMs.current === 0) return;
              if (hostRef.current.state !== "playing") return;
              holdUntilMs.current = 0;
              player.volume = holdVolume.current;
              if (player.playbackState !== PLAYBACK_STATE.playing) await playSafe(player);
              setAudible(true);
            });
          }, wait);
        } catch {
          holdUntilMs.current = 0;
          queuedSongId.current = null;
          readySongId.current = null;
          alignedSongId.current = null;
          prearmedSongId.current = null;
          player.volume = base;
          switched = false;
        }
      });
    };

    const interval = window.setInterval(tick, SWITCH_FADE_STEP_MS);
    tick();
    return () => {
      window.clearInterval(interval);
      // 渐弱到一半被取消（这首结束、暂停）：把音量还原，别留个半哑的
      if (!switched && baseline != null) player.volume = baseline;
    };
  }, [music, songId, state, repeatOne]);

  /**
   * 主人开/关单曲循环时跟着改。走 ref，避免 eslint 把 useState 的 music 当成不可变。
   */
  useEffect(() => {
    const player = musicRef.current;
    if (!player) return;
    applyRepeatMode(player, repeatOne);
  }, [music, repeatOne]);

  /**
   * 预排进队列后让播放器自己接着播。nowPlaying 变了就认下新曲，不要 skipToNext
   * 再 play —— 那是重新 load，每切一首多一轮延迟。
   *
   * 单曲循环：这一首再来，不要 adopt 下一首，ended 就 seek 回开头。
   * autoplay 没动、停在 ended 时才 skipToNext 兜底。
   */
  useEffect(() => {
    if (!music) return;

    const adopt = () => {
      const local = localSongId(music);
      if (!local) return;
      const host = songIdRef.current;
      if (local === host) {
        queuedSongId.current = local;
        readySongId.current = local;
        lastHostSongId.current = local;
        hasFollowed.current = true;
        return;
      }
      if (repeatOneRef.current) return;
      const items = music.queue?.items ?? [];
      const hostAt = host ? mediaItemIndex(items, host) : -1;
      const localAt = mediaItemIndex(items, local);
      if (localAt > 0 && (hostAt < 0 || localAt > hostAt)) {
        queuedSongId.current = local;
        readySongId.current = local;
      }
    };

    const onItem = () => adopt();
    const onState = () => {
      if (music.playbackState !== PLAYBACK_STATE.ended) return;
      void runExclusive(async () => {
        if (music.playbackState !== PLAYBACK_STATE.ended) return;
        if (repeatOneRef.current) {
          /*
           * repeatMode=one 时 MusicKit 自己会从头再放。抢在它前面 seek/play
           * 是叠操作，iOS 上会弹「The operation was aborted.」。先让一让，
           * 它真没接手再兜底。
           */
          await new Promise((resolve) => window.setTimeout(resolve, REPEAT_RESTART_GRACE_MS));
          if (music.playbackState !== PLAYBACK_STATE.ended) return;
          await mkSafe(() => music.seekToTime(0));
          await playSafe(music);
          return;
        }
        if (localSongId(music) === songIdRef.current) return;
        if (!hasQueuedNext(music)) return;
        await mkSafe(() => music.skipToNextItem());
        adopt();
      });
    };
    music.addEventListener("nowPlayingItemDidChange", onItem);
    music.addEventListener("playbackStateDidChange", onState);
    return () => {
      music.removeEventListener("nowPlayingItemDidChange", onItem);
      music.removeEventListener("playbackStateDidChange", onState);
    };
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

  const logout = useCallback(() => {
    stop();
    /*
     * 没点过 Sign in 就还没加载 MusicKit。这时候 Sign out 只是占位，
     * 别为了它把几百 KB 的播放器拉进来。
     */
    if (!authorized) {
      setError(null);
      return;
    }
    void (async () => {
      try {
        const instance = await getMusicKit();
        await instance.unauthorize();
        setAuthorized(false);
        setError(null);
      } catch (caught) {
        setError(describe(caught));
        setStatus("error");
      }
    })();
  }, [authorized, stop]);

  return {
    status,
    authorized,
    error,
    waiting: status === "following" && (!songId || state !== "playing"),
    audible,
    start,
    stop,
    logout,
  };
}
