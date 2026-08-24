import { cacheLife, cacheTag } from "next/cache";

import { getActivitySnapshot } from "@/lib/activity";
import { getChargerSnapshot, withChargerFreshness } from "@/lib/anker";
import { getPowerBankSnapshot, withPowerBankFreshness } from "@/lib/powerbank";
import { statusEnvelope, statusSource } from "@/lib/api";
import { getRecentlyPlayed } from "@/lib/apple-music-store";
import { getNowWatching, getWatching } from "@/lib/emby";
import { getGithubChart } from "@/lib/github-chart";
import {
  ACTIVITY_TAG,
  CHARGER_TAG,
  POWERBANK_TAG,
  DESKTOP_TAG,
  LISTENING_TAG,
  NOW_LISTENING_TAG,
  NOW_PLAYING_TAG,
  NOW_WATCHING_TAG,
  PLAYING_TAG,
  TIMEZONE_TAG,
  VIBECODING_TAG,
  VIBECODING_YEAR_TAG,
  WATCHING_TAG,
} from "@/lib/live-events";
import { pickNowListening } from "@/lib/now-listening";
import { getPlaying, getPlayingNow } from "@/lib/playstation";
import { readLiveness } from "@/lib/reporter-liveness";
import { getDesktopPayload, getNowListeningSnapshot, getTimezonePayload } from "@/lib/telemetry";
import { getVibeCodingSnapshot } from "@/lib/vibecoding";
import { getVibeCodingYear } from "@/lib/vibecoding-year-store";

/**
 * 首屏那几份数据的缓存层。`app/api/status/` 下的状态路由（时区除外，它只给首屏）
 * 也读这里 —— 但只在 STATUS_CACHE 没被关掉时读：关掉的部署上端点走文件末尾那几对
 * 里的 `live` 那半，每次直读 Redis，见 lib/api 的 STATUS_CACHE。首屏不受那个开关管。
 *
 * tag 只失效本实例那一套（Vercel 之外没有共享的 tag 存储，见 lib/live-events 的
 * expireStatus）—— 上报会被原样转给对端，对端自己跑一遍同一个 handler、
 * 自己走到 expireStatus，见 lib/ingest-relay。
 * Mac 存活（lastSeenAt / declaredOffline）以及充电头的 pushedAt 也在路由里
 * 现盖一层，因为心跳不触发 tag 失效。时区不看存活，只在 timezone 模块上报时失效。
 *
 * 一个主题一个缓存条目、一个 tag：充电头插拔只让充电头那份重算，不牵连另外七份。
 *
 * 为什么不能写成 `cached(tag, loader)` 这样一个泛用壳子：`use cache` 的缓存键由
 * 参数算出来，而参数必须可序列化 —— 函数不行。所以只能一个主题写一遍。
 */

/**
 * stale 5 分钟 / revalidate 10 分钟 / expire 2 小时。
 *
 * 主力失效手段是 tag。10 分钟兜底留给首屏 HTML：上报器悄无声息死掉不会触发
 * tag，存活窗口默认 5 分钟（HEARTBEAT_WINDOW_MS），首屏那份 lastSeenAt 最多冻
 * 这 10 分钟。API 路径会现读存活。
 *
 * 不能再短：revalidate 为 0 或 expire 短于 5 分钟的缓存会被排除在预渲染之外、
 * 退化成请求时的动态洞，那就等于没缓存。
 */
const STATUS_LIFE = {
  stale: 5 * 60,
  revalidate: 10 * 60,
  expire: 2 * 60 * 60,
};
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

/**
 * 充电宝首屏。
 *
 * 不需要像充电头那样裁历史窗口 —— 这张卡没有曲线，快照本身就是全部内容。
 */
export async function cachedPowerBank() {
  "use cache";
  cacheLife(STATUS_LIFE);
  cacheTag(POWERBANK_TAG);
  return statusEnvelope(async () => withPowerBankFreshness(await getPowerBankSnapshot()));
}

/** 状态端点用的完整 400 点。和首屏那份同 tag，插拔时一起失效。 */
export async function cachedChargerSnapshot() {
  "use cache";
  cacheLife(STATUS_LIFE);
  cacheTag(CHARGER_TAG);
  return statusEnvelope(getChargerSnapshot);
}

export async function cachedPowerBankSnapshot() {
  "use cache";
  cacheLife(STATUS_LIFE);
  cacheTag(POWERBANK_TAG);
  return statusEnvelope(getPowerBankSnapshot);
}

/**
 * 活动圆环。一份缓存同时喂首屏和状态端点 —— 这份没有充电头那种「首屏裁一段、
 * 端点给全量」的分歧，圈就那六个数。
 *
 * 「跨没跨过午夜」在这里会被冻住（最长 10 分钟），端点那侧每次请求重新盖一遍，
 * 见 app/api/status/activity 和 lib/activity 的 withActivityFreshness。
 */
export async function cachedActivity() {
  "use cache";
  cacheLife(STATUS_LIFE);
  cacheTag(ACTIVITY_TAG);
  return statusEnvelope(getActivitySnapshot);
}

export async function cachedVibeCoding() {
  "use cache";
  cacheLife(STATUS_LIFE);
  cacheTag(VIBECODING_TAG);
  return statusEnvelope(getVibeCodingSnapshot);
}

export async function cachedVibeCodingYear() {
  "use cache";
  cacheLife(STATUS_LIFE);
  cacheTag(VIBECODING_YEAR_TAG);
  return statusEnvelope(getVibeCodingYear);
}

export async function cachedListening() {
  "use cache";
  cacheLife(STATUS_LIFE);
  cacheTag(LISTENING_TAG);
  return statusEnvelope(getRecentlyPlayed);
}

/** 两个候选。首屏和 `/api/status/listening/now` 共用这一份，各自现选 Hero。 */
export async function cachedNowListeningSnapshot() {
  "use cache";
  cacheLife(STATUS_LIFE);
  cacheTag(NOW_LISTENING_TAG);
  return statusEnvelope(getNowListeningSnapshot);
}

export async function cachedNowListening() {
  "use cache";
  cacheLife(STATUS_LIFE);
  cacheTag(NOW_LISTENING_TAG);
  // 首屏冻住选好的 Hero，避免 LCP 闪。挂载后 SWR 打 listening/now 现选。
  const envelope = await cachedNowListeningSnapshot();
  if (!envelope.ok) return envelope;
  return statusEnvelope(async () =>
    pickNowListening(envelope.data, await readLiveness()),
  );
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

export async function cachedPlaying() {
  "use cache";
  cacheLife(STATUS_LIFE);
  cacheTag(PLAYING_TAG);
  return statusEnvelope(getPlaying);
}

export async function cachedPlayingNow() {
  "use cache";
  cacheLife(STATUS_LIFE);
  cacheTag(NOW_PLAYING_TAG);
  return statusEnvelope(getPlayingNow);
}

export async function cachedGithubChart() {
  "use cache";
  cacheLife(STATUS_LIFE);
  return statusEnvelope(getGithubChart);
}

/**
 * `app/api/status/` 下每条端点各自的两种取法，一条一对，见 lib/api 的
 * `StatusSource`：冻起来那份走上面的 `'use cache'`，直读那份走同一个 loader，
 * 由 STATUS_CACHE 选。
 *
 * 配对摆在这里而不是各条路由里：这个文件本来就同时拿着 tag 和 loader，而路由那边
 * 每加一处「哪份缓存对应哪个 loader」的知识，就多一处能对不上的地方。
 *
 * 充电头和充电宝给端点的是**完整快照**，首屏那两份（cachedCharger /
 * cachedPowerBank）裁过历史窗口，两者不是同一份。
 */
export const desktopStatus = statusSource(cachedDesktop, getDesktopPayload);
export const chargerStatus = statusSource(cachedChargerSnapshot, getChargerSnapshot);
export const powerBankStatus = statusSource(cachedPowerBankSnapshot, getPowerBankSnapshot);
export const activityStatus = statusSource(cachedActivity, getActivitySnapshot);
export const vibeCodingStatus = statusSource(cachedVibeCoding, getVibeCodingSnapshot);
export const vibeCodingYearStatus = statusSource(cachedVibeCodingYear, getVibeCodingYear);
export const listeningStatus = statusSource(cachedListening, getRecentlyPlayed);
export const nowListeningStatus = statusSource(
  cachedNowListeningSnapshot,
  getNowListeningSnapshot,
);
export const watchingStatus = statusSource(cachedWatching, getWatching);
export const nowWatchingStatus = statusSource(cachedNowWatching, getNowWatching);
export const playingStatus = statusSource(cachedPlaying, getPlaying);
export const playingNowStatus = statusSource(cachedPlayingNow, getPlayingNow);
export const githubChartStatus = statusSource(cachedGithubChart, getGithubChart);
