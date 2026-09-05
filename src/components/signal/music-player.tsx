"use client";

import { createPortal } from "react-dom";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type Ref,
} from "react";
import {
  Headphones,
  LoaderCircle,
  LogIn,
  LogOut,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { ListenAlong } from "@/hooks/use-listen-along";
import { useMusicPlayer } from "@/hooks/use-music-player";
import {
  boundedSeek,
  mediaTitle,
  playerQueue,
  playerTime,
  type PlayerRecord,
} from "@/lib/music-player";
import {
  MUSICKIT_TOKEN_ENDPOINT,
  PLAYBACK_STATE,
  REPEAT_MODE,
} from "@/lib/musickit";
import "./music-player.css";

const subscribeSlot = () => () => {};
const readSlot = () => document.getElementById("signal-player-slot");
const serverSlot = () => null;

export type MusicPlayerHandle = {
  play: (record: PlayerRecord) => void;
  enqueue: (record: PlayerRecord) => void;
  follow: () => void;
};

export function MusicPlayer({
  selection,
  listen,
  ref,
}: {
  selection: PlayerRecord | null;
  listen: ListenAlong;
  ref?: Ref<MusicPlayerHandle>;
}) {
  const player = useMusicPlayer(listen);
  const slot = useSyncExternalStore(subscribeSlot, readSlot, serverSlot);
  const [queueOpen, setQueueOpen] = useState(false);
  const [seekValue, setSeekValue] = useState<number | null>(null);
  const [seekItem, setSeekItem] = useState<string | undefined>(undefined);
  const queueButton = useRef<HTMLButtonElement>(null);
  const queuePanel = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const lastVolume = useRef(1);
  const { playRecord, enqueue, follow } = player;
  useImperativeHandle(
    ref,
    () => ({
      play: (record) => {
        void playRecord(record);
        setQueueOpen(true);
      },
      enqueue: (record) => {
        void enqueue(record);
        setQueueOpen(true);
      },
      follow: () => {
        void follow();
        setQueueOpen(true);
      },
    }),
    [playRecord, enqueue, follow],
  );

  useEffect(() => {
    if (!queueOpen) return;
    queuePanel.current?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setQueueOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [queueOpen]);

  const closeQueue = () => {
    setQueueOpen(false);
    queueButton.current?.focus({ preventScroll: true });
  };
  const following = player.mode === "follow";
  const current = player.item?.attributes;
  const fallback = player.record ?? selection;
  const title = player.item
    ? mediaTitle(player.item, player.index)
    : (fallback?.title ?? "选择一张专辑");
  const artist = current?.artistName ?? fallback?.artist ?? "Apple Music";
  const playing = player.state === PLAYBACK_STATE.playing;
  const buffering =
    player.busy ||
    [
      PLAYBACK_STATE.loading,
      PLAYBACK_STATE.waiting,
      PLAYBACK_STATE.stalled,
      PLAYBACK_STATE.seeking,
    ].includes(player.state as 1 | 6 | 8 | 9);
  const enabled = Boolean(MUSICKIT_TOKEN_ENDPOINT);
  const hasQueue = player.queue.length > 0;
  const canControl = enabled && !player.busy && !following;
  const canPlay =
    enabled &&
    !player.busy &&
    Boolean(player.item || (selection && playerQueue(selection)));
  const shownTime =
    seekValue != null && seekItem === player.item?.id ? seekValue : player.time;
  const repeatLabel =
    player.repeat === REPEAT_MODE.one
      ? "单曲循环"
      : player.repeat === REPEAT_MODE.all
        ? "列表循环"
        : "顺序播放";
  const status = !enabled
    ? "播放服务暂不可用"
    : player.busy
      ? player.authorized
        ? "正在准备播放…"
        : "正在连接 Apple Music…"
      : following
        ? player.waiting
          ? "一起听 · 等待播放"
          : player.audible
            ? "一起听 · 已同步"
            : "一起听 · 正在对齐"
        : player.item
          ? playing
            ? "自主播放"
            : "已暂停"
          : player.authorized
            ? "已连接 Apple Music"
            : "登录自己的 Apple Music 订阅即可播放";

  const commitSeek = (value: number) => {
    const item = player.item?.id;
    if (seekItem && seekItem !== item) {
      setSeekValue(null);
      return;
    }
    setSeekValue(null);
    void player.seek(boundedSeek(value, player.duration));
  };
  const mute = () => {
    if (player.volume > 0) {
      lastVolume.current = player.volume;
      player.setVolume(0);
    } else player.setVolume(lastVolume.current || 1);
  };

  if (!slot) return null;
  return createPortal(
    <section className="music-player" aria-label="音乐播放器" ref={root}>
      <div className="player-transmission">
        <button
          className={`player-frequency ${playing || (following && player.audible) ? "active" : ""}`}
          aria-label={
            player.busy
              ? "取消连接"
              : following
                ? "停止一起听"
                : playing
                  ? "暂停播放"
                  : "播放"
          }
          title={status}
          disabled={!enabled || (!following && !player.busy && !canPlay)}
          onClick={() =>
            void (following || player.busy
              ? player.stop()
              : player.toggle(selection))
          }
        >
          <span className="frequency" aria-hidden="true">
            {Array.from({ length: 64 }, (_, index) => (
              <i
                key={index}
                style={
                  {
                    "--height": `${5 + ((index * 11) % 15)}px`,
                    "--delay": `${-index * 0.067}s`,
                  } as CSSProperties
                }
              />
            ))}
          </span>
        </button>
        <button
          className="player-caption"
          ref={queueButton}
          aria-label={`播放器：${title}`}
          aria-expanded={queueOpen}
          aria-controls="player-dropdown"
          onClick={() => setQueueOpen(!queueOpen)}
        >
          <span>{title}</span>
          <span className="corner-marks" aria-hidden="true" />
        </button>
      </div>
      {queueOpen && (
        <div
          id="player-dropdown"
          className="player-dropdown"
          ref={queuePanel}
          role="dialog"
          aria-label="播放队列与控制"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              closeQueue();
            }
          }}
        >
          <header className="player-identity">
            <div>
              <strong>{title}</strong>
              <span>{artist}</span>
            </div>
            <button onClick={closeQueue} aria-label="收起播放器">
              <X size={16} />
            </button>
          </header>
          <p className="player-status">{status}</p>
          <div className="player-queue" aria-label="播放队列">
            <div className="player-queue-heading">
              <span>播放队列</span>
              <small>{player.queue.length} 首</small>
            </div>
            {!hasQueue ? (
              <p className="queue-empty">
                打开专辑详情，选择“播放”或“加入队列”。
              </p>
            ) : (
              <ol>
                {player.queue.map((item, index) => (
                  <li key={`${item.id ?? "track"}:${index}`}>
                    <button
                      aria-current={index === player.index ? "true" : undefined}
                      disabled={following || player.busy}
                      onClick={() => void player.changeItem(index)}
                    >
                      <span>
                        {index === player.index && playing ? (
                          <Volume2 size={15} />
                        ) : (
                          String(index + 1).padStart(2, "0")
                        )}
                      </span>
                      <span>
                        <b>{mediaTitle(item, index)}</b>
                        <small>{item.attributes?.artistName ?? ""}</small>
                      </span>
                      <time>
                        {item.attributes?.durationInMillis
                          ? playerTime(item.attributes.durationInMillis / 1000)
                          : "—"}
                      </time>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="player-dock">
            <div className="player-transport">
              <button
                aria-label="上一首"
                disabled={
                  !canControl ||
                  !hasQueue ||
                  (player.index <= 0 && player.time <= 3)
                }
                onClick={() => void player.previous()}
              >
                <SkipBack size={20} />
              </button>
              <button
                className="player-play"
                aria-label={
                  player.busy
                    ? "取消连接"
                    : following
                      ? "停止一起听"
                      : playing
                        ? "暂停播放"
                        : "播放"
                }
                disabled={!enabled || (!following && !player.busy && !canPlay)}
                onClick={() =>
                  void (following || player.busy
                    ? player.stop()
                    : player.toggle(selection))
                }
              >
                {buffering ? (
                  <LoaderCircle size={23} className="player-loading" />
                ) : following ? (
                  <Square size={19} />
                ) : playing ? (
                  <Pause size={23} fill="currentColor" />
                ) : (
                  <Play size={23} fill="currentColor" />
                )}
              </button>
              <button
                aria-label="下一首"
                disabled={
                  !canControl ||
                  player.index < 0 ||
                  player.index >= player.queue.length - 1
                }
                onClick={() => void player.next()}
              >
                <SkipForward size={20} />
              </button>
            </div>
            <div className="player-progress">
              <time>{playerTime(shownTime)}</time>
              <input
                aria-label="播放进度"
                aria-valuetext={`${playerTime(shownTime)} / ${playerTime(player.duration)}`}
                type="range"
                min="0"
                max={player.duration || 1}
                step="0.1"
                value={boundedSeek(shownTime, player.duration)}
                disabled={!canControl || !player.item || player.duration <= 0}
                onChange={(event) => {
                  setSeekItem(player.item?.id);
                  setSeekValue(Number(event.target.value));
                }}
                onPointerUp={(event) =>
                  commitSeek(Number(event.currentTarget.value))
                }
                onPointerCancel={() => setSeekValue(null)}
                onKeyUp={(event) => {
                  if (
                    [
                      "ArrowLeft",
                      "ArrowRight",
                      "ArrowUp",
                      "ArrowDown",
                      "Home",
                      "End",
                      "PageUp",
                      "PageDown",
                    ].includes(event.key)
                  )
                    commitSeek(Number(event.currentTarget.value));
                }}
              />
              <time>{playerTime(player.duration)}</time>
            </div>
            <div className="player-extras">
              <button
                aria-label={player.shuffle ? "关闭随机播放" : "开启随机播放"}
                aria-pressed={player.shuffle}
                disabled={!canControl || !hasQueue}
                onClick={() => void player.toggleShuffle()}
              >
                <Shuffle size={18} />
              </button>
              <button
                aria-label={`播放模式：${repeatLabel}`}
                title={repeatLabel}
                aria-pressed={player.repeat !== REPEAT_MODE.none}
                disabled={!canControl || !hasQueue}
                onClick={() => void player.cycleRepeat()}
              >
                {player.repeat === REPEAT_MODE.one ? (
                  <Repeat1 size={19} />
                ) : (
                  <Repeat size={19} />
                )}
              </button>
              <button
                aria-label={player.volume === 0 ? "取消静音" : "静音"}
                onClick={mute}
              >
                {player.volume === 0 ? (
                  <VolumeX size={19} />
                ) : (
                  <Volume2 size={19} />
                )}
              </button>
              <input
                className="player-volume"
                aria-label="音量"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={player.volume}
                onChange={(event) =>
                  player.setVolume(Number(event.target.value))
                }
              />
              <button
                aria-label={following ? "停止一起听" : "一起听"}
                title={
                  following ? "停止一起听" : "一起听：同步站主正在播放的歌曲"
                }
                aria-pressed={following}
                disabled={!enabled || (!following && player.busy)}
                onClick={() =>
                  void (following ? player.stop() : player.follow())
                }
              >
                <Headphones size={20} />
              </button>
              <button
                aria-label={
                  player.authorized ? "退出 Apple Music" : "登录 Apple Music"
                }
                title={
                  player.authorized ? "退出 Apple Music" : "登录 Apple Music"
                }
                disabled={!enabled || player.busy}
                onClick={() =>
                  void (player.authorized ? player.logout() : player.login())
                }
              >
                {player.authorized ? <LogOut size={19} /> : <LogIn size={19} />}
              </button>
            </div>
          </div>
        </div>
      )}
      {player.error && (
        <div className="player-error" role="alert">
          <span>{player.error}</span>
          <button aria-label="关闭播放错误" onClick={player.dismissError}>
            <X size={18} />
          </button>
        </div>
      )}
    </section>,
    slot,
  );
}
