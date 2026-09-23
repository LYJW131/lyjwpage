import { setTimeout as sleep } from "node:timers/promises";

import { nextDelay } from "./cadence.js";
import { config } from "./config.js";
import { postPage, sessionFromAccessToken } from "./cursor-usage.js";
import { failure, info, recovered } from "./log.js";
import { readCursorAccessToken } from "./providers/cursor.js";
import { push } from "./site.js";

/**
 * Cursor「此刻在不在用」。
 *
 * Cursor 没有会话级的活动状态可查，但每条请求几秒内就会出现在用量事件里（实测不到
 * 8 秒），而且 IDE、CLI、云端 agent、Bugbot / Grok Bot 都走这一处，不管在哪台机器上。
 * 所以只取最近一条事件的时刻和模型，交给站点；在不在用由浏览器按时刻现算（5 分钟，
 * 跟 Mac 那几家同一个口径）。Bot 也算在用。
 *
 * 节奏是动态的：
 * - 闲着时不单独查。限额那一轮本来就要拉用量，顺手看最新一条（observeCursorActivity）。
 * - 看到 5 分钟内有事件才起快循环：有新事件就 1 分钟查一次；没有就 1 → 2 → 4 分钟拉长，
 *   超过 5 分钟没新事件（灯已经灭了）、或者没人开着页面，就停，交回限额那一轮。
 * 时刻或模型变了才发，没变不发 —— 灯灭不需要通知，浏览器自己会算。
 */

export type CursorNow = { lastActivityAt: string; currentModel: string | null };

const ACTIVE_WINDOW_MS = 5 * 60_000;
/** 只看最近这么久的事件。超过灯的窗口就不亮了，再往前查没有意义。 */
const LOOKBACK_MS = 10 * 60_000;
/** 容器钟和 Cursor 的钟对不齐时，别因为一条「未来」的事件被当成窗口外 */
const CLOCK_SKEW_MS = 5 * 60_000;
const PAGE_SIZE = 5;

/** 两条路（限额那一轮、快循环）共用：上一封成功发出去的是哪条、最新一条是什么时候 */
let lastSentKey: string | null = null;
let lastEventAt = 0;
let wake: (() => void) | null = null;

function keyOf(now: CursorNow): string {
  return `${now.lastActivityAt}|${now.currentModel ?? ""}`;
}

/**
 * 一页用量事件里最新的那条。只认时刻和模型：拉历史那边的 parseUsagePage 要校验
 * token 分列，一条缺项就整页判坏；这里用不着那些，不能因为一条怪事件让灯永远不亮。
 * 窗口外的时刻不认。
 */
export function latestActivity(body: unknown, lower: number, upper: number): CursorNow | null {
  const root = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (!root) throw new Error("Cursor usage events missing");
  // 窗口里一条都没有时 Cursor 连这个字段都省掉（protobuf 的空数组不出现在 JSON 里）
  const rows = root.usageEventsDisplay ?? [];
  if (!Array.isArray(rows)) throw new Error("Cursor usage events malformed");
  let latest: { at: number; model: string | null } | null = null;
  for (const value of rows) {
    const row = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
    const at = Number(row?.timestamp);
    if (!Number.isSafeInteger(at) || at < lower || at > upper) continue;
    const model = typeof row?.model === "string" && row.model.trim() ? row.model.trim().slice(0, 200) : null;
    if (!latest || at > latest.at) latest = { at, model };
  }
  return latest ? { lastActivityAt: new Date(latest.at).toISOString(), currentModel: latest.model } : null;
}

/**
 * 限额那一轮拉完用量后调这个：记下最新一条，近 5 分钟内的话叫醒快循环。
 * 返回这一封该不该带上 cursorNow —— 跟上次发出去的一样就不带。
 */
export function observeCursorActivity(latest: CursorNow | null, now = Date.now()): CursorNow | null {
  if (!latest) return null;
  const at = Date.parse(latest.lastActivityAt);
  if (at > lastEventAt) lastEventAt = at;
  if (now - at <= ACTIVE_WINDOW_MS) wake?.();
  return keyOf(latest) === lastSentKey ? null : latest;
}

/** 那一封发成功之后再记，发失败下一轮还会带上 */
export function markCursorNowSent(sent: CursorNow): void {
  lastSentKey = keyOf(sent);
}

/** 下一次隔多久查：刚看到新事件就回到快档，否则翻倍，封顶 */
export function nextActivityInterval(previous: number, sawNewEvent: boolean): number {
  const { fastIntervalMs, maxIntervalMs } = config.cursorNow;
  return sawNewEvent ? fastIntervalMs : Math.min(previous * 2, maxIntervalMs);
}

/** 没配 Cursor 凭据、或最近 10 分钟没有事件时返回 null */
export async function fetchCursorNow(now = Date.now()): Promise<CursorNow | null> {
  const accessToken = await readCursorAccessToken();
  if (!accessToken) return null;
  const { cookie } = sessionFromAccessToken(accessToken);
  const lower = now - LOOKBACK_MS;
  const upper = now + CLOCK_SKEW_MS;
  const response = await postPage(cookie, 1, lower, upper, fetch, PAGE_SIZE);
  return latestActivity(response.body, lower, upper);
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
      const current = await fetchCursorNow();
      if (current) {
        const at = Date.parse(current.lastActivityAt);
        sawNewEvent = at > lastEventAt;
        if (sawNewEvent) lastEventAt = at;
        if (keyOf(current) !== lastSentKey) {
          await push({ collectedAt: new Date().toISOString(), cursorNow: current });
          markCursorNowSent(current);
        }
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
 * 漏了也只是等下一轮限额（最多几分钟）再叫，不值得为它加锁。
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
