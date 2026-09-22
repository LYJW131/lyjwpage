import { setTimeout as sleep } from "node:timers/promises";

import { nextDelay } from "./cadence.js";
import { config } from "./config.js";
import { postPage, sessionFromAccessToken } from "./cursor-usage.js";
import { failure, recovered } from "./log.js";
import { readCursorAccessToken } from "./providers/cursor.js";
import { push } from "./site.js";

/**
 * Cursor「此刻在不在用」。
 *
 * Cursor 没有会话级的活动状态可查，但每条请求几秒内就会出现在用量事件里（实测不到
 * 8 秒），而且 IDE、CLI、云端 agent、Bugbot / Grok Bot 都走这一处，不管在哪台机器上。
 * 所以这里只取最近一条事件的时刻和模型，交给站点；在不在用由浏览器按时刻现算，
 * 跟 Mac 那几家的 5 分钟口径一致。Bot 也算在用。
 *
 * 跟限额主循环分开跑：那条最快 5 分钟一轮，而且每轮要拉完整历史；这条只拉一页、几条。
 * 时刻或模型变了才发，没变不发 —— 灯灭不需要通知，浏览器自己会算。
 */

export type CursorNow = { lastActivityAt: string; currentModel: string | null };

/** 只看最近这么久的事件。超过 5 分钟的本来就不亮灯，再往前查没有意义。 */
const LOOKBACK_MS = 10 * 60_000;
/** 容器钟和 Cursor 的钟对不齐时，别因为一条「未来」的事件整页判坏 */
const CLOCK_SKEW_MS = 5 * 60_000;
const PAGE_SIZE = 5;

/**
 * 一页用量事件里最新的那条。只认时刻和模型：拉历史那边的 parseUsagePage 要校验
 * token 分列，一条缺项就整页判坏；这里用不着那些，不能因为一条怪事件让灯永远不亮。
 * 窗口外的时刻不认。
 */
export function latestActivity(body: unknown, lower: number, upper: number): CursorNow | null {
  const root = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const rows = root?.usageEventsDisplay;
  if (!Array.isArray(rows)) throw new Error("Cursor usage events missing");
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

export async function runCursorNowLoop(): Promise<never> {
  let lastSent: string | null = null;
  for (;;) {
    try {
      const current = await fetchCursorNow();
      const key = current ? `${current.lastActivityAt}|${current.currentModel ?? ""}` : null;
      if (current && key !== lastSent) {
        await push({ collectedAt: new Date().toISOString(), cursorNow: current });
        lastSent = key;
      }
      recovered("cursor-now");
    } catch (error) {
      failure("cursor-now", error);
    }
    await sleep(await nextDelay({ ...config.cadence, ...config.cursorNow }));
  }
}
