import { cacheLife, cacheTag } from "next/cache";

import { getChargerPayload } from "@/lib/anker";
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
import { getVibeCodingPayload } from "@/lib/vibecoding";

/**
 * 首屏那八份数据的缓存层。
 *
 * 页面服务端渲染时读的是这里，不是 /api/status/* —— 那八条路由是客户端轮询和
 * 挂载回源走的活路径，一律现算、no-store，别把它们和这里搞混。同一个取数函数
 * 两边共用，信封形状也共用（statusEnvelope），只是这一侧多了一层缓存。
 *
 * 一个主题一个缓存条目、一个 tag：充电头插拔只让充电头那份重算，不牵连另外七份。
 * 合成一个条目的话，任何一条上报都会把整页的 Redis 读全部重来。
 *
 * 为什么不能写成 `cached(tag, loader)` 这样一个泛用壳子：`use cache` 的缓存键由
 * 参数算出来，而参数必须可序列化 —— 函数不行。所以只能一个主题写一遍。
 */

/**
 * stale 5 分钟 / revalidate 1 分钟 / expire 1 小时。
 *
 * 主力失效手段是 tag，这个时长是兜底：payload 里的 stale 是「上报器多久没露面」
 * 算出来的，而上报器悄无声息地死掉（崩溃、断网、拔电）不会产生任何一次上报，
 * 也就没有任何 tag 会因此失效。存活窗口是 45 秒（lib/reporter-liveness），
 * 1 分钟重算一次正好接得上。
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
  const payload = await getChargerPayload();
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

/** 同上，活动曲线也发全量 */
export async function cachedVibeCoding() {
  "use cache";
  cacheLife(STATUS_LIFE);
  cacheTag(VIBECODING_TAG);
  return statusEnvelope(getVibeCodingPayload);
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
