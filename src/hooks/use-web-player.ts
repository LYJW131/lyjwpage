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
  | "unavailable" // 没配 MUSICKIT_TOKEN_ENDPOINT，功能整体不可用
  | "idle" // 可用，还没碰过 MusicKit
  | "starting" // 正在加载 MusicKit / 取令牌 / 等授权弹窗 / 装队列
  | "ready" // 拿到已授权的实例，队列已经装进去
  | "error";

/** Listening card 提供给统一播放器的同步锚点。 */
export type SyncSource = {
  track: LocalNowPlaying | null;
  songId: string | null;
  upcomingSongIds?: string[];
};

export type WebPlayer = {
  status: WebPlayerStatus;
  authorized: boolean;
  error: string | null;
  /** 弹窗正在查看的那张专辑 / 歌单；null 表示没有 */
  item: ListeningItem | null;
  /** 底层正在播放的那张专辑 / 歌单；null 表示没有在放 */
  activeItem: ListeningItem | null;
  /** 弹窗查看的专辑是否正是当前正在播放的专辑 */
  isItemActive: boolean;
  /** 弹窗开着 */
  open: boolean;
  /** 见 PLAYBACK_STATE */
  playbackState: number;
  nowPlaying: MediaItem | null;
  queue: MediaItem[];
  /** 已经开始放过（在播、暂停、缓冲都算）。页头缩略播放器按它显示；stop 后为 false */
  active: boolean;
  /** 配好的实例，弹窗自己订阅进度用；没拿到是 null */
  instance: MusicKitInstance | null;
  /** 点了某张专辑：装入、打开弹窗，不开播；如果已有正在播放的音乐，不会打断播放 */
  openWith: (item: ListeningItem) => void;
  /** 只打开 / 关闭弹窗，不动播放 */
  openDialog: () => void;
  closeDialog: () => void;
  /** 弹窗里的 Sign in：authorize；正在试听的话重装成完整曲目接着放 */
  signIn: () => void;
  /** 队列没装时装队列开播，装了就是续播。未授权时放的是 30 秒试听 */
  play: () => void;
  pause: () => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  /** 毫秒 */
  seekTo: (ms: number) => Promise<void>;
  /** 切到队列里第 index 首 */
  playAt: (index: number) => void;
  /** 停止并清队列；item 保留（弹窗还能再点播放），active 变 false */
  stop: () => void;
  /** 停止并 unauthorize */
  logout: () => void;
  /** 注册当前本机播放锚点；不直接控制播放，跟随只在 syncing 时生效。 */
  setSyncSource: (source: SyncSource) => void;
  /** 切换同步播放列表、进度、暂停和循环模式。 */
  toggleSync: () => void;
  /** 开启一起听并打开播放器；已经同步时只打开，不中断跟随。 */
  startSync: () => void;
  /** 当前是否由同步锚点接管播放器。 */
  syncing: boolean;
  /** 当前锚点是否足以开始同步。 */
  syncAvailable: boolean;
  /** 同步已开启，但主人暂停或没有可用曲目。 */
  syncWaiting: boolean;
};

/** 错误转换为文案 */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "未知错误";
}

/**
 * 拦截用户或代码快速切歌、暂停时触发的正常打断报错，
 * 避免 MusicKit 或浏览器将其作为未捕获异常抛出。
 */
function isPlayInterrupted(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    (error instanceof Error && error.name === "AbortError") ||
    message.includes("interrupted by a new load request") ||
    message.includes("interrupted by a call to pause") ||
    /operation was aborted/i.test(message)
  );
}

/** 包装播放异步调用，安全吸收打断错误 */
async function mkSafe(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (isPlayInterrupted(error)) return;
    throw error;
  }
}

/** 实例是否正在播放或缓冲中 */
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
    title: track?.title || previousTrack?.title || "一起听",
    artist: track?.artist || previousTrack?.artist || "",
    artwork: track?.artworkUrl ?? previousTrack?.artwork ?? null,
    // Dialog 的 playable 判定需要一个 URL；真正同步时仍按 songId 装曲目。
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

/** 切到目录里的某首歌；已有队列就复用索引，避免无谓地重装整队。 */
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

/** 把同步来源给出的后续队列覆盖到 MusicKit 当前曲后面。 */
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

  // MusicKit 没有公开的 clear-tail API。重放当前 song 会清掉旧尾巴；保存并恢复
  // 本地位置，避免同步在这一个 await 后被取消时把自由播放重置到歌头。
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
  /** 实例里此刻装着哪张专辑的队列。stop 会把队列清掉，那时归 null，下次要重装 */
  const loadedIdRef = useRef<string | null>(null);
  const syncingRef = useRef(false);
  const syncSourceRef = useRef<SyncSource>(syncSource);
  const syncRevisionRef = useRef(0);
  const syncGenerationRef = useRef(0);
  const syncItemRef = useRef<ListeningItem | null>(null);
  /** 已请求 / 已就绪的同步曲目，用来区分换歌与同曲进度更新。 */
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

  /**
   * 改播放的操作排成一条排他链，避免并发 play/pause/setQueue 导致 MusicKit 报错。
   */
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

  /**
   * 同步请求的代数。来源刷新只递增 revision，用户控制和退出同步递增 generation；
   * 两个值都要匹配，旧的 await 完成后才不会重新夺回 MusicKit。
   */
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

  /** 让出同步控制但保留当前 MusicKit 队列和播放状态。 */
  const cancelSyncFollow = useCallback(
    (reset = true) => {
      syncGenerationRef.current += 1;
      syncingRef.current = false;
      setSyncing(false);
      if (reset) resetSyncSession();
      const inst = instanceRef.current;
      if (inst) {
        if (inst.volume === 0) inst.volume = 1;
        // 同步模式临时借用了 repeat one；退出后交还给普通播放器的默认模式。
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

  /** 让同步虚拟项随着主人换歌更新，但进度刷新不会制造无意义的新对象。 */
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

  /** listening-card 的唯一来源注册入口。 */
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

  /**
   * 拿 MusicKit 实例：
   * getMusicKit() 过了令牌半衰期会重新 configure，那会打断正在放的东西，
   * 所以只有 instanceRef.current 为空、或它 playbackState 不是 playing / loading / waiting / seeking 时
   * 才允许再调 getMusicKit()；否则直接复用手上的。
   */
  const getOrReuseMusicKit = useCallback(async (): Promise<MusicKitInstance> => {
    const existing = instanceRef.current;
    if (existing && isPlaybackActive(existing)) {
      setAuthorized(existing.isAuthorized);
      return existing;
    }
    const inst = await getMusicKit();
    instanceRef.current = inst;
    setInstance(inst);
    /*
     * 拿到手就对一次授权状态：MusicKit 把用户令牌存在本地，之前在「一起听」
     * 或上次访问登录过的话，configure 完 isAuthorized 直接是 true —— 事件
     * authorizationStatusDidChange 只在**变化**时来，初始值得自己读，否则登录
     * 过的访客打开播放器仍被画成试听。
     */
    setAuthorized(inst.isAuthorized);
    return inst;
  }, []);

  // 弹窗打开时后台校验/预热 MusicKit 实例，同步最新授权状态并就绪播放器，无需等待用户点击播放
  useEffect(() => {
    if (!open) return;
    void getOrReuseMusicKit().catch(() => {});
  }, [open, getOrReuseMusicKit]);

  /**
   * 把一张专辑 / 歌单的队列装进实例，**不出声**。调用方负责排他链，这里不再
   * 套一层 —— 调用方已经在链里，再进一次会等自己，死锁。
   *
   * 不带 startPlaying：打开卡片就装队列，是为了让曲目列表马上可见；出声那一下
   * 留给播放键。未授权的实例也装得出目录队列（只是放不了），所以登录前就能看
   * 到列表。
   *
   * 每次装队列前都把音量和循环模式归位：实例是和「一起听」共用的单例，它预切
   * 时会把音量压到 0、主人单曲循环时会开 repeat one，交接过来若不清掉，这边
   * 放出来的就是哑的或者一首歌转圈。
   */
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
      // setQueue 内部切换 PlaybackController 会重新挂载并可能触发 startAutoplay；
      // 装完队列后显式关掉 autoplayEnabled，触发 stopAutoplay 清除推荐曲目
      inst.autoplayEnabled = false;

      // 优先保留 Catalog API 获得的权威专辑曲目；若无则从实例队列中提取非 Autoplay 的真实曲目
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

  /**
   * 停止播放，清除 active 状态（页头的缩略播放器随之消失）。
   * 弹窗保持当前专辑和曲目列表可见，底栏播放键恢复为 Play，用户可随时重新开播。
   */
  const stop = useCallback(() => {
    // Stop 是用户主动控制，先立刻使所有排队中的同步任务失效。
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

  /**
   * 点了某张专辑：装入、打开弹窗，**不开播**。
   * 如果当前已经有正在播放的音乐，不会打断正在播放的音频流；
   * 通过只读 API / 缓存拉取目标专辑曲目，待用户真正点击播放时才切歌开播。
   *
   * 若之前已拿过歌单列表有缓存，在打开弹窗前就直接预设好列表，并配合 Dialog
   * 预先算好像素高度，消除弹窗打开时的高度跳动；无缓存且非当前专辑时清空旧数据。
   */
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

      // 若之前拿过歌单有缓存，弹窗打开前直接载入，消除弹窗首帧跳动与骨架屏闪烁
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

      // 如果已有曲目列表，无需再次请求
      if (cached && cached.length > 0) return;
      if (isLoaded && instanceRef.current?.queue?.items?.length) return;

      // 纯异步拉取曲目，不打断正在播放的音频
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
            // 若只读 API 未查到曲目，且当前没有正在播放的音乐，回退到 prepare (setQueue)
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

  /** 出过声就算 active：页头缩略播放器、底栏的 Stop 都看它 */
  const markActive = useCallback((inst: MusicKitInstance) => {
    setPlaybackState(inst.playbackState);
    setNowPlaying(inst.nowPlayingItem ?? null);
    setActive(true);
    activeRef.current = true;
  }, []);

  /**
   * 把 MusicKit 对齐到 listening-card 注册的 host 锚点。
   *
   * 这个函数只会从 runExclusive 里改播放器。每次来源刷新带一个 revision，用户
   * 操作带一个 generation；任意 await 之后都重新检查两者，保证旧的授权、换歌或
   * seek 完成后不会把控制权抢回去。
   */
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
            // 暂停来源仍要保持当前曲和后续队列，之后恢复播放可以无缝接上。
            clearSyncTimers();
          }

          const hostPosition = trackPositionMs(track, Date.now());
          let local = localSongId(inst);
          const joining = !syncHasFollowedRef.current;

          /*
           * MusicKit 可能已经沿预排队列自然切到下一首，而 host 的旧锚点晚到。
           * 只要本地确实在 host 锚点之后、旧锚点靠近歌尾，就保留本地下一首；
           * host 真拖回歌中间时由 hostRewoundIntoTrack 放行。
           */
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

            // 重复模式下清掉旧尾巴；普通模式下精确覆盖来源传来的顺序（含重复曲）。
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
              // setQueue 可能把暂停曲重新置为 loading，下面统一 seek 后再 pause。
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

  /** 来源变化只重新排队一轮同步任务；不会创建第二个 MusicKit 实例。 */
  useEffect(() => {
    if (!syncing) return;
    void syncReconcile(syncGenerationRef.current, syncRevisionRef.current);
  }, [syncReconcile, syncSource, syncing]);

  /**
   * 来源没有新事件时，播放器自己的缓冲仍可能慢慢落后。低频巡检只负责纠偏，
   * 换歌、暂停和首次加入仍由上面的来源 effect 处理。
   */
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

  /** 弹窗里的 Sign in：加载 MusicKit 并 authorize，只登录不开播 */
  const signIn = useCallback(() => {
    void runExclusive(async () => {
      setStatus("starting");
      setError(null);
      try {
        const inst = await getOrReuseMusicKit();
        /*
         * 已经授权过就不再弹窗 —— MusicKit 把用户令牌存在本地，「一起听」那边
         * 登录过的话这里 isAuthorized 直接是 true。访客自己关掉授权弹窗也会走到
         * catch：不是故障，但也不该假装成功，把原因摆出来让他再点一次。
         */
        if (!inst.isAuthorized) await inst.authorize();
        setAuthorized(inst.isAuthorized);
        setStatus("ready");
        /*
         * 登录前已经在试听：队列里装的是 30 秒预览，授权不会把它们换成整首。
         * 停掉、按同一张专辑重装、再从头放，这次出来的才是完整曲目。
         */
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

  /**
   * 播放键：队列没装时装队列开播，装了就是续播。未授权时放的是 30 秒试听。
   * 若查看的专辑与当前正在播放的不同，停旧播、装新队并开播。
   */
  const play = useCallback(() => {
    cancelSyncFollow();
    void runExclusive(async () => {
      // 关闭浏览中的专辑后，页头播放器必须继续操作 activeItem 对应的实际队列。
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

  /** 点队列里某一首：changeToMediaAtIndex 自己会开播，所以这里也要记 active */
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

  /** 停止并 unauthorize */
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

  /**
   * 监听 MusicKit 实例的各项事件变化。
   * 注意：不要在这里监听 playbackTimeDidChange，避免每秒触发 Provider 全树重渲染。
   */
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

      // 如果已有权威曲目列表（如 Catalog API 返回的专辑完整曲目），绝不让 Autoplay 推荐队列覆盖
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

  /** 页面/Hook 卸载时停止播放，避免音频遗留在后台 */
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
