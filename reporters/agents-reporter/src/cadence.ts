import { setTimeout as sleep } from "node:timers/promises";
import { config } from "./config.js";
import { failure, recovered } from "./log.js";

type Cadence = typeof config.cadence;

type Audience = { online: number; connections: number };

function count(body: Record<string, unknown>, field: keyof Audience): number {
  const value = body[field];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * api Worker 的 `GET /count` 一次回两个数：`online`（可见页面）与 `connections`（开着的页面）。
 * 读不到、超时、格式不对一律当没人，只会让节奏变慢；某一个字段不合法只降它自己。
 */
async function readAudience(url: string, timeoutMs: number, request: typeof fetch): Promise<Audience> {
  if (!url) return { online: 0, connections: 0 };
  const scope = "head-count";
  try {
    const response = await request(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`计数接口返回 ${response.status}`);
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") throw new Error("计数接口返回的不是对象");
    const audience = { online: count(body as Record<string, unknown>, "online"), connections: count(body as Record<string, unknown>, "connections") };
    recovered(scope);
    return audience;
  } catch (error) {
    failure(scope, error);
    return { online: 0, connections: 0 };
  }
}

export async function nextDelay(
  cadence: Cadence = config.cadence,
  request: typeof fetch = fetch,
): Promise<number> {
  const { online, connections } = await readAudience(cadence.countUrl, cadence.countTimeoutMs, request);
  if (online > 0) return cadence.liveIntervalMs;
  if (connections > 0) return cadence.openIntervalMs;
  return cadence.idleIntervalMs;
}

/** 长档每个快档重查一次，发现更快档立即采集；人数减少不延后已定的心跳。 */
export async function waitForNextRound(
  liveIntervalMs = config.cadence.liveIntervalMs,
  runtime = {
    nextDelay: () => nextDelay(),
    now: () => performance.now(),
    sleep: (ms: number): Promise<void> => sleep(ms),
  },
): Promise<void> {
  const delay = await runtime.nextDelay();
  const deadline = runtime.now() + delay;
  for (;;) {
    const left = deadline - runtime.now();
    if (left <= 0) return;
    await runtime.sleep(Math.min(liveIntervalMs, left));
    if (runtime.now() >= deadline) return;
    if (await runtime.nextDelay() < delay) return;
  }
}
