import { key, withRedis } from "@/lib/redis";

/**
 * Emby 正在播放的状态，由 webhook 推进来。
 *
 * 以前是轮询 /emby/Sessions，现在改成 Emby 主动通知：开始/暂停/继续/停止
 * 各来一条，本站不再定时去问。
 */

/** Emby 的 tick 是 100 纳秒，1 毫秒 = 10000 tick */
const TICKS_PER_MS = 10_000;

/** 事件之间可能隔很久（一部电影两小时只有首尾两条），保留时间要足够宽 */
const TTL_MS = 6 * 60 * 60 * 1000;

const K_NOW_PLAYING = key("emby", "nowPlaying");

export type EmbyNowPlaying = {
  itemId: string;
  paused: boolean;
  /** 事件发生时的播放位置 */
  positionTicks: number;
  /** 该条目总时长，0 表示未知 */
  runTimeTicks: number;
  device: string;
  /** 事件到达时刻，毫秒 */
  at: number;
};

let fallback: EmbyNowPlaying | null = null;

export async function setNowPlaying(state: EmbyNowPlaying) {
  fallback = state;
  await withRedis(
    async (redis) => redis.set(K_NOW_PLAYING, JSON.stringify(state), "PX", TTL_MS),
    null,
  );
}

export async function clearNowPlaying() {
  fallback = null;
  await withRedis(async (redis) => redis.del(K_NOW_PLAYING), null);
}

async function readNowPlaying(): Promise<EmbyNowPlaying | null> {
  const raw = await withRedis(async (redis) => redis.get(K_NOW_PLAYING), null);
  if (raw) {
    try {
      return JSON.parse(raw) as EmbyNowPlaying;
    } catch {
      // 脏数据当作没有
    }
  }
  return fallback;
}

export type ResolvedNowPlaying = {
  itemId: string;
  paused: boolean;
  /** 推算到此刻的进度，0–100；时长未知时为 null */
  progress: number | null;
  device: string;
};

/**
 * 取当前播放状态，并把进度推算到「此刻」。
 *
 * webhook 只在开始/暂停/继续/停止时来一条，中间没有消息。但我们知道事件
 * 发生时的位置和总时长，未暂停时按真实时间往前推即可 —— 进度条不用轮询
 * 也能走。
 *
 * 同时兼作兜底：如果推算位置已经超过总时长，说明播完了而「停止」那条事件
 * 没收到（客户端崩了、网络断了），此时按已结束处理，不会一直挂着。
 */
export async function getNowPlaying(): Promise<ResolvedNowPlaying | null> {
  const state = await readNowPlaying();
  if (!state) return null;

  if (state.paused) {
    return {
      itemId: state.itemId,
      paused: true,
      progress: state.runTimeTicks
        ? clampPercent((state.positionTicks / state.runTimeTicks) * 100)
        : null,
      device: state.device,
    };
  }

  const elapsedTicks = (Date.now() - state.at) * TICKS_PER_MS;
  const projected = state.positionTicks + elapsedTicks;

  if (state.runTimeTicks && projected >= state.runTimeTicks) {
    // 早该播完了却没收到停止事件，当作已结束
    return null;
  }

  return {
    itemId: state.itemId,
    paused: false,
    progress: state.runTimeTicks
      ? clampPercent((projected / state.runTimeTicks) * 100)
      : null,
    device: state.device,
  };
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}
