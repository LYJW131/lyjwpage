import { setTimeout as sleep } from "node:timers/promises";

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


const ACTIVE_WINDOW_MS = 5 * 60_000;
const RECENT_MS = 15 * 60_000;
const CLOCK_SKEW_MS = 5 * 60_000;

let lastEventAt = 0;
let wake: (() => void) | null = null;

export function observeCursorActivity(latestAt: number | null, now = Date.now()): void {
  if (latestAt == null) return;
  if (latestAt > lastEventAt) lastEventAt = latestAt;
  if (now - latestAt <= ACTIVE_WINDOW_MS) wake?.();
}

export function nextActivityInterval(previous: number, sawNewEvent: boolean): number {
  const { fastIntervalMs, maxIntervalMs } = config.cursorNow;
  return sawNewEvent ? fastIntervalMs : Math.min(previous * 2, maxIntervalMs);
}

export type CursorRecent = {
  activity: CodingActivityReport;
  buckets: CodingTokenBucketReport;
  latestAt: number | null;
};

export function recentReports(rows: RecentRow[], from: number, now: number): CursorRecent {
  const events = rows.flatMap((row): UsageEvent[] => (row.event ? [row.event] : []));
  const latest = latestOf(rows);
  return {
    activity: cursorActivityReport(now, latest),
    buckets: cursorBucketReport(events, { from, to: now }, now, events.length < rows.length),
    latestAt: latest?.at ?? null,
  };
}

export function recentPayload(recent: CursorRecent, at = new Date()): PushPayload {
  return { collectedAt: at.toISOString(), codingActivity: recent.activity, codingTokenBuckets: recent.buckets };
}

// 查询必须从完整桶边界开始；部分首桶会覆盖站点已有的完整计数。
export async function fetchCursorRecent(now = Date.now(), fetchPage?: typeof fetch): Promise<CursorRecent | null> {
  const accessToken = await readCursorAccessToken();
  if (!accessToken) return null;
  const { cookie } = sessionFromAccessToken(accessToken);
  const from = bucketStart(now - RECENT_MS);
  const rows = await fetchRecentRows(cookie, from, now + CLOCK_SKEW_MS, fetchPage);
  return recentReports(rows, from, now);
}

async function track(): Promise<string> {
  let interval = config.cursorNow.fastIntervalMs;
  for (;;) {
    await sleep(interval);
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

// track 返回到重新挂 wake 之间允许漏一次唤醒；下一轮限额采集会再次唤醒。
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
