import { mirrorKey } from "@/lib/redis";
import type { WatchingItem } from "@/lib/types";

/**
 * Emby 的全部状态，一律由 NAS 上的推送代理送进来（reporters/emby-reporter）。
 * 本站一个 Emby 请求都不发 —— 站点将来要跑在 Vercel 上，
 * 那时根本够不着内网里的 Emby。
 */

/** Emby 的 tick 是 100 纳秒，1 毫秒 = 10000 tick */
export const TICKS_PER_MS = 10_000;

/** 事件之间可能隔很久（一部电影两小时只有首尾两条），保留时间要足够宽 */
const TTL_MS = 6 * 60 * 60 * 1000;

/**
 * 续播列表和图片映射留得久一些。
 *
 * 它们只在代理有变化时才推，一部剧看完到下一次开播中间可能好几天都没有新推送；
 * 按会话那档 6 小时算的话，页面会在没人看片的日子里空掉。
 */
const LIBRARY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 播放中的位置状态。
 *
 * 代理有两个触发源：Emby 转发过来的播放事件（开始/暂停/继续/停止），以及它自己
 * 每 2 秒查一次会话 —— 拖动进度条 Emby 不发任何通知，只能查出来。
 */
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

/** Redis 为主、进程内存为辅，规则见 lib/redis 的 mirrorKey */
const mirror = mirrorKey<EmbyNowPlaying>(["emby", "nowPlaying"], (state) => state.at, {
  ttlMs: TTL_MS,
});

export async function setNowPlaying(state: EmbyNowPlaying) {
  await mirror.put(state);
}

export async function clearNowPlaying() {
  await mirror.drop();
}

export type ResolvedNowPlaying = {
  itemId: string;
  paused: boolean;
  /** 推算到「响应发出时」的进度，0–100；时长未知时为 null */
  progress: number | null;
  device: string;
  /**
   * 响应发出时的播放位置与总时长（毫秒）。给客户端本地继续推算用 ——
   * 播放中途 Emby 不发任何事件，光靠轮询进度条是一跳一跳的。
   * 客户端以「收到这份数据的时刻」为锚点往前走，就不用管两边时钟差。
   */
  positionMs: number | null;
  durationMs: number | null;
};

/**
 * 取当前播放状态，并把进度推算到「此刻」。
 *
 * 推送只在开始/暂停/继续/停止、以及代理发现拖了进度条时才来，中间没有消息。
 * 但我们知道推送发生时的位置和总时长，未暂停时按真实时间往前推即可 ——
 * 进度条不用轮询也能走。
 *
 * 同时兼作兜底：如果推算位置已经超过总时长，说明播完了而「停止」那条事件
 * 没收到（客户端崩了、网络断了），此时按已结束处理，不会一直挂着。
 */
export async function getNowPlaying(): Promise<ResolvedNowPlaying | null> {
  return resolveNowPlaying(await mirror.get());
}

/**
 * 推算部分单拎出来，不带取数。
 *
 * 上报那条路上刚写下去的那份就在手上，用不着等它落库再从 Redis 读回来 ——
 * 读回来的还可能是写之前的那份。
 */
export function resolveNowPlaying(state: EmbyNowPlaying | null): ResolvedNowPlaying | null {
  if (!state) return null;

  if (state.paused) {
    return {
      itemId: state.itemId,
      paused: true,
      progress: state.runTimeTicks
        ? clampPercent((state.positionTicks / state.runTimeTicks) * 100)
        : null,
      device: state.device,
      positionMs: state.positionTicks / TICKS_PER_MS,
      durationMs: state.runTimeTicks ? state.runTimeTicks / TICKS_PER_MS : null,
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
    positionMs: projected / TICKS_PER_MS,
    durationMs: state.runTimeTicks ? state.runTimeTicks / TICKS_PER_MS : null,
  };
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

/**
 * 存下来的一项，图片位上放的是「图片键」而不是地址。
 *
 * 键到地址的映射单独存（见下面的 images 镜像），落地时不把地址烧进条目里 ——
 * 图片和列表是分两次推来的：列表先到、图片可能还在路上，或者 Redis 被清空后
 * 只需补推图片。地址在读取时才解析，晚到的那批图能把已经存着的列表一起点亮，
 * 不用把整个列表重推一遍。
 */
export type StoredWatchingItem = Omit<WatchingItem, "poster" | "backdrop"> & {
  posterKey: string | null;
  backdropKey: string | null;
};

const resumeMirror = mirrorKey<{ items: StoredWatchingItem[]; at: number }>(
  ["emby", "resume"],
  (state) => state.at,
  { ttlMs: LIBRARY_TTL_MS },
);

export async function setResume(items: StoredWatchingItem[]) {
  await resumeMirror.put({ items, at: Date.now() });
}

export async function getResume() {
  return resumeMirror.get();
}

/**
 * 播放中那一项的详情，和 nowPlaying 分开存。
 *
 * 合在一起的话，Emby 的 webhook（它只知道 id、位置和设备）每来一条暂停/继续
 * 就会把代理推来的详情覆盖掉。两份各写各的，读的时候按 itemId 对上即可。
 */
const currentMirror = mirrorKey<{ item: StoredWatchingItem; at: number }>(
  ["emby", "current"],
  (state) => state.at,
  { ttlMs: TTL_MS },
);

export async function setCurrentItem(item: StoredWatchingItem) {
  await currentMirror.put({ item, at: Date.now() });
}

export async function getCurrentItem() {
  return currentMirror.get();
}

/**
 * 图片键 → 本站资产地址。
 *
 * 键由代理按 Emby 的 ImageTag 拼出来，图换了键就换，所以映射只增不改。
 * 有上限是因为它只是「代理不必重复上传」的备忘：条目掉出去了，代理下一次
 * 推送会从响应里的 missingImages 得知，把图再传一遍。
 */
const IMAGE_LIMIT = 96;

const imagesMirror = mirrorKey<{ urls: Record<string, string>; at: number }>(
  ["emby", "images"],
  (state) => state.at,
  { ttlMs: LIBRARY_TTL_MS },
);

export async function getImageUrls(): Promise<Record<string, string>> {
  return (await imagesMirror.get())?.urls ?? {};
}

export async function setImageUrls(urls: Record<string, string>) {
  // 对象的键保持插入顺序，超了就从最早的开始丢
  const entries = Object.entries(urls).slice(-IMAGE_LIMIT);
  await imagesMirror.put({ urls: Object.fromEntries(entries), at: Date.now() });
}
