import { setTimeout as sleep } from "node:timers/promises";
import { config } from "./config.js";
import { failure, recovered } from "./log.js";

type Cadence = typeof config.cadence;

// 留出用户停下来想一想、Mac 攒批上报的空档；最后一次使用后还会再跑几轮，收到用完时的限额。
export const ACTIVE_WINDOW_MS = 15 * 60_000;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function latestActivityAt(body: unknown, agentIds: readonly string[]): number | null {
  const agents = record(record(body)?.data)?.agents;
  if (!Array.isArray(agents)) throw new Error("活动接口返回的不是 agents 列表");
  let latest: number | null = null;
  for (const agent of agents) {
    const row = record(agent);
    if (!row || typeof row.id !== "string" || !agentIds.includes(row.id) || !Array.isArray(row.activity)) continue;
    for (const entry of row.activity) {
      const at = record(entry)?.lastActivityAt;
      if (typeof at === "number" && Number.isFinite(at) && (latest == null || at > latest)) latest = at;
    }
  }
  return latest;
}

async function readLatestActivity(cadence: Cadence, request: typeof fetch): Promise<number | null> {
  if (!cadence.activityUrl) return null;
  const scope = "agent-activity";
  try {
    const response = await request(cadence.activityUrl, { signal: AbortSignal.timeout(cadence.activityTimeoutMs) });
    if (!response.ok) throw new Error(`活动接口返回 ${response.status}`);
    const latest = latestActivityAt(await response.json(), config.agentIds);
    recovered(scope);
    return latest;
  } catch (error) {
    failure(scope, error);
    return null;
  }
}

export async function nextDelay(
  cadence: Cadence = config.cadence,
  request: typeof fetch = fetch,
  now = Date.now(),
): Promise<number> {
  const latest = await readLatestActivity(cadence, request);
  return latest != null && now - latest <= ACTIVE_WINDOW_MS ? cadence.activeIntervalMs : cadence.idleIntervalMs;
}

export async function waitForNextRound(
  activeIntervalMs = config.cadence.activeIntervalMs,
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
    await runtime.sleep(Math.min(activeIntervalMs, left));
    if (runtime.now() >= deadline) return;
    if (await runtime.nextDelay() < delay) return;
  }
}
