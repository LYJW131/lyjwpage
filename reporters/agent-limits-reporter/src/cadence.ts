import { setTimeout as sleep } from "node:timers/promises";
import { config } from "./config.js";
import { failure, recovered } from "./log.js";

type Cadence = typeof config.cadence;

/** 公开计数口不带 ingest 凭据；读不到只向慢档退，不影响限额采集和心跳。 */
async function headCount(
  origin: string,
  field: "online" | "connections",
  timeoutMs: number,
  request: typeof fetch,
): Promise<number> {
  if (!origin) return 0;
  const scope = `${field}-count`;
  try {
    const response = await request(`${origin}/count`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`计数接口返回 ${response.status}`);
    const body: unknown = await response.json();
    const value = body && typeof body === "object"
      ? (body as Record<string, unknown>)[field]
      : undefined;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      throw new Error(`计数接口缺少合法 ${field}`);
    }
    recovered(scope);
    return value;
  } catch (error) {
    failure(scope, error);
    return 0;
  }
}

export async function nextDelay(
  cadence: Cadence = config.cadence,
  request: typeof fetch = fetch,
): Promise<number> {
  if (await headCount(cadence.onlineCounterUrl, "online", cadence.countTimeoutMs, request) > 0) {
    return cadence.liveIntervalMs;
  }
  if (await headCount(cadence.livePushUrl, "connections", cadence.countTimeoutMs, request) > 0) {
    return cadence.openIntervalMs;
  }
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
