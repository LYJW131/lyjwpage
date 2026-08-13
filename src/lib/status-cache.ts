import { cacheLife, cacheTag } from "next/cache";

import { getChargerSnapshot, withChargerFreshness } from "@/lib/anker";
import { statusEnvelope } from "@/lib/api";
import { getRecentlyPlayed } from "@/lib/apple-music-store";
import { getNowWatching, getWatching } from "@/lib/emby";
import {
  CHARGER_TAG,
  DESKTOP_TAG,
  LISTENING_TAG,
  NOW_LISTENING_TAG,
  NOW_WATCHING_TAG,
  TIMEZONE_TAG,
  VIBECODING_TAG,
  WATCHING_TAG,
} from "@/lib/live-events";
import { getDesktopPayload, getNowListening, getTimezonePayload } from "@/lib/telemetry";
import { getVibeCodingSnapshot } from "@/lib/vibecoding";

/**
 * 首屏那八份数据的缓存层。状态路由除 listening/now 外也读这里。
 *
 * listening/now 仍走现算：来源选择和 expiresInMs 是时间函数，不能冻。
 * 其余七条的快照进缓存；Mac 存活（lastSeenAt / declaredOffline）以及充电头
 * 的 pushedAt 在路由里现盖一层，因为心跳不触发 tag 失效。
 *
 * 一个主题一个缓存条目、一个 tag：充电头插拔只让充电头那份重算，不牵连另外七份。
 *
 * 为什么不能写成 `cached(tag, loader)` 这样一个泛用壳子：`use cache` 的缓存键由
 * 参数算出来，而参数必须可序列化 —— 函数不行。所以只能一个主题写一遍。
 */

/**
 * stale 5 分钟 / revalidate 1 分钟 / expire 1 小时。
 *
 * 主力失效手段是 tag。1 分钟兜底留给首屏 HTML：上报器悄无声息死掉不会触发
 * tag，存活窗口 45 秒，首屏那份 lastSeenAt 最多冻一分钟。API 路径会现读存活。
 *
 * 不能再短：revalidate 为 0 或 expire 短于 5 分钟的缓存会被排除在预渲染之外、
 * 退化成请求时的动态洞，那就等于没缓存。
 */
const STATUS_LIFE = "minutes";
const CHARGER_FALLBACK_WINDOW_MS = 20 * 60_000;

/**
 * 首屏曲线只画最近 20 分钟；保留窗口左边界之前的一个点，SVG 才能把跨界线段
 * 连续地裁到边缘。完整 400 点仍留在 Redis 和状态端点，挂载后继续从最新游标
 * 增量同步，这里只缩小 RSC/HTML 里的首屏投影。
 */
async function getChargerFallback() {
  const payload = withChargerFreshness(await getChargerSnapshot());
  const { history } = payload;
  if (history.length < 2) return payload;

  const end = history[history.length - 1].t;
  const firstInside = history.findIndex(
    (sample) => sample.t >= end - CHARGER_FALLBACK_WINDOW_MS,
  );
  if (firstInside <= 0) return payload;

  return { ...payload, history: history.slice(firstInside - 1) };
}

export async function cachedDesktop() {
  "use cache";
  cacheLife(STATUS_LIFE);
  cacheTag(DESKTOP_TAG);
  return statusEnvelope(getDesktopPayload);
}

export async function cachedTimezone() {
  "use cache";
  cacheLife(STATUS_LIFE);
  cacheTag(TIMEZONE_TAG);
  return statusEnvelope(getTimezonePayload);
}

/** 曲线不带游标：服务端手上没有客户端已有的序列，只能发全量 */
export async function cachedCharger() {
  "use cache";
  cacheLife(STATUS_LIFE);
  cacheTag(CHARGER_TAG);
  return statusEnvelope(getChargerFallback);
}

/** 状态端点用的完整 400 点。和首屏那份同 tag，插拔时一起失效。 */
export async function cachedChargerSnapshot() {
  "use cache";
  cacheLife(STATUS_LIFE);
  cacheTag(CHARGER_TAG);
  return statusEnvelope(getChargerSnapshot);
}

/** 同上，活动曲线也发全量 */
export async function cachedVibeCoding() {
  "use cache";
  cacheLife(STATUS_LIFE);
  cacheTag(VIBECODING_TAG);
  return statusEnvelope(getVibeCodingSnapshot);
}

export async function cachedListening() {
  "use cache";
  cacheLife(STATUS_LIFE);
  cacheTag(LISTENING_TAG);
  return statusEnvelope(getRecentlyPlayed);
}

export async function cachedNowListening() {
  "use cache";
  cacheLife(STATUS_LIFE);
  cacheTag(NOW_LISTENING_TAG);
  return statusEnvelope(getNowListening);
}

/** 条数用 getWatching 自己的默认值，理由同 /api/status/watching：别在两处各写一遍 */
export async function cachedWatching() {
  "use cache";
  cacheLife(STATUS_LIFE);
  cacheTag(WATCHING_TAG);
  return statusEnvelope(getWatching);
}

export async function cachedNowWatching() {
  "use cache";
  cacheLife(STATUS_LIFE);
  cacheTag(NOW_WATCHING_TAG);
  return statusEnvelope(getNowWatching);
}
