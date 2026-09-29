import { setTimeout as sleep } from "node:timers/promises";

import { nextDelay } from "./cadence.js";
import { bucketStart, type CodingActivityReport, type CodingTokenBucketReport } from "./coding-usage.js";
import { config } from "./config.js";
import {
  cursorActivityReport,
  cursorBucketReport,
  fetchRecentRows,
  latestOf,
  sessionFromAccessToken,
  type RecentRow,
  type UsageEvent,
} from "./cursor-usage.js";
import { failure, info, recovered } from "./log.js";
import { readCursorAccessToken } from "./providers/cursor.js";
import { push, type PushPayload } from "./site.js";

/**
 * Cursor「此刻在不在用」，以及此刻的 token 速率。
 *
 * Cursor 没有会话级的活动状态可查，但每条请求几秒内就会出现在用量事件里（实测不到
 * 8 秒），而且 IDE、CLI、云端 agent、Bugbot / Grok Bot 都走这一处，不管在哪台机器上。
 * 所以快循环每次取最近一段（RECENT_MS）的全部事件，同时产出两份事实交给站点：
 * - `codingActivity`：最近一条事件的时刻和模型。在不在用由浏览器按时刻现算（5 分钟，
 *   跟 Mac 那几家同一个口径）。Bot 也算在用。
 * - `codingTokenBuckets`：同一批事件按时刻落 5 分钟桶，Pulse 才看得到 Cursor 的此刻速率。
 *
 * 节奏是动态的：
 * - 闲着时不单独查。限额那一轮本来就要拉用量，顺手看最新一条（observeCursorActivity）。
 * - 看到 `ACTIVE_WINDOW_MS` 内有事件才起快循环：间隔由 `nextActivityInterval` 按 `config.cursorNow` 决定，
 *   超过 `ACTIVE_WINDOW_MS` 没新事件、或者没人开着页面，就停，交回限额那一轮。
 * 循环里每次查完都发，内容没变也发：活动的 collectedAt 前进就是「采集器还活着」，
 * 桶范围里没有事件也是一句有用的话（那一段确认没用）。
 *
 * 快循环宽松解析：一条缺 token 分列的怪事件只丢它自己（桶报告里该 agent 标 partial），
 * 活动和别的事件照出。拉历史那条路（cursor-usage.ts）仍然整页严格。
 */

const ACTIVE_WINDOW_MS = 5 * 60_000;
/** 每次取多久以内的事件，也是桶报告的范围。比灯的窗口长，桶才盖得住迟到的事件 */
const RECENT_MS = 15 * 60_000;
/** 容器钟和 Cursor 的钟对不齐时，别因为一条「未来」的事件被当成窗口外 */
const CLOCK_SKEW_MS = 5 * 60_000;

/** 两条路（限额那一轮、快循环）共用：见过的最新一条事件是什么时候，快循环靠它判断有没有新事件 */
let lastEventAt = 0;
let wake: (() => void) | null = null;

/**
 * 限额那一轮拉完用量后调这个：记下最新一条，近 5 分钟内的话叫醒快循环。
 * 那一轮自己的活动和桶随限额那封发出去，这里只管快循环。
 */
export function observeCursorActivity(latestAt: number | null, now = Date.now()): void {
  if (latestAt == null) return;
  if (latestAt > lastEventAt) lastEventAt = latestAt;
  if (now - latestAt <= ACTIVE_WINDOW_MS) wake?.();
}

/** 下一次隔多久查：刚看到新事件就回到快档，否则翻倍，封顶 */
export function nextActivityInterval(previous: number, sawNewEvent: boolean): number {
  const { fastIntervalMs, maxIntervalMs } = config.cursorNow;
  return sawNewEvent ? fastIntervalMs : Math.min(previous * 2, maxIntervalMs);
}

export type CursorRecent = {
  activity: CodingActivityReport;
  buckets: CodingTokenBucketReport;
  /** 最近一条事件的时刻，窗口里一条都没有为 null */
  latestAt: number | null;
};

/**
 * 一次快循环取到的全部行 → 活动 + 桶。纯函数，单测直接喂录制页。
 *
 * 活动认所有时刻合法的行（token 分列坏了也算用过）；桶只收 token 分列合规的事件，丢掉几条就在桶报告里
 * 标 partial。桶范围是 [from, now)：晚于 now 的事件（钟差）留给下一封。
 */
export function recentReports(rows: RecentRow[], from: number, now: number): CursorRecent {
  const events = rows.flatMap((row): UsageEvent[] => (row.event ? [row.event] : []));
  const latest = latestOf(rows);
  return {
    activity: cursorActivityReport(now, latest),
    buckets: cursorBucketReport(events, { from, to: now }, now, events.length < rows.length),
    latestAt: latest?.at ?? null,
  };
}

/** 快循环发的那封小信封：只带活动与桶，不带限额，站点就不碰限额镜像 */
export function recentPayload(recent: CursorRecent, at = new Date()): PushPayload {
  return { collectedAt: at.toISOString(), codingActivity: recent.activity, codingTokenBuckets: recent.buckets };
}

/**
 * 没配 Cursor 凭据时返回 null。桶范围的起点向下对齐到桶边界，并且从这个起点起把事件取全，
 * 首桶因此是完整的，不会被范围截断。
 */
export async function fetchCursorRecent(now = Date.now(), fetchPage?: typeof fetch): Promise<CursorRecent | null> {
  const accessToken = await readCursorAccessToken();
  if (!accessToken) return null;
  const { cookie } = sessionFromAccessToken(accessToken);
  const from = bucketStart(now - RECENT_MS);
  const rows = await fetchRecentRows(cookie, from, now + CLOCK_SKEW_MS, fetchPage);
  return recentReports(rows, from, now);
}

/** 没人开着页面时灯亮不亮没人看，不值得每分钟打 Cursor */
async function anyoneWatching(): Promise<boolean> {
  return (await nextDelay()) < config.cadence.idleIntervalMs;
}

async function track(): Promise<string> {
  let interval = config.cursorNow.fastIntervalMs;
  for (;;) {
    await sleep(interval);
    if (!(await anyoneWatching())) return "没人开着页面";
    let sawNewEvent = false;
    try {
      const recent = await fetchCursorRecent();
      if (recent) {
        const { latestAt } = recent;
        if (latestAt != null && latestAt > lastEventAt) {
          sawNewEvent = true;
          lastEventAt = latestAt;
        }
        await push(recentPayload(recent));
      }
      recovered("cursor-now");
    } catch (error) {
      failure("cursor-now", error);
    }
    if (Date.now() - lastEventAt > ACTIVE_WINDOW_MS) return "5 分钟没有新事件";
    interval = nextActivityInterval(interval, sawNewEvent);
  }
}

/**
 * track() 返回到下一次挂上 wake 之间有一瞬 wake 是 null，这时限额那一轮叫不醒它。
 * 漏了也只是等下一轮限额，间隔由 `config.cadence` 决定，不值得为它加锁。
 */
export async function runCursorNowLoop(): Promise<never> {
  for (;;) {
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
    wake = null;
    info("Cursor 在用，活动轮询改为每分钟");
    info(`Cursor 活动轮询停下，交回限额那一轮：${await track()}`);
  }
}
