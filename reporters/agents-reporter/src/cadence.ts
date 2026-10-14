import { setTimeout as sleep } from "node:timers/promises";
import { config, type AgentId } from "./config.js";
import { failure, recovered } from "./log.js";

type Cadence = typeof config.cadence;
type Intervals = Pick<Cadence, "activeIntervalMs" | "idleIntervalMs">;

// 留出用户停下来想一想、Mac 攒批上报的空档；最后一次使用后还会再跑几轮，收到用完时的限额。
export const ACTIVE_WINDOW_MS = 15 * 60_000;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function activeAgentIds(body: unknown, agentIds: readonly string[], now: number): Set<string> {
  const agents = record(record(body)?.data)?.agents;
  if (!Array.isArray(agents)) throw new Error("活动接口返回的不是 agents 列表");
  const active = new Set<string>();
  for (const agent of agents) {
    const row = record(agent);
    if (!row || typeof row.id !== "string" || !agentIds.includes(row.id) || !Array.isArray(row.activity)) continue;
    for (const entry of row.activity) {
      const at = record(entry)?.lastActivityAt;
      if (typeof at === "number" && Number.isFinite(at) && now - at <= ACTIVE_WINDOW_MS) active.add(row.id);
    }
  }
  return active;
}

export async function readActiveAgents(
  cadence: Cadence = config.cadence,
  request: typeof fetch = fetch,
  now = Date.now(),
): Promise<ReadonlySet<string>> {
  if (!cadence.activityUrl) return new Set();
  const scope = "agent-activity";
  try {
    const response = await request(cadence.activityUrl, { signal: AbortSignal.timeout(cadence.activityTimeoutMs) });
    if (!response.ok) throw new Error(`活动接口返回 ${response.status}`);
    const active = activeAgentIds(await response.json(), config.agentIds, now);
    recovered(scope);
    return active;
  } catch (error) {
    failure(scope, error);
    return new Set();
  }
}

// 每家各排各的：在用的按快档取限额，其余按闲档。看到在用只会把那一家的下一轮提前，停用不推迟已经排好的轮次，
// 活动接口偶尔读不到也就不会把在用的那家拖到闲档。
export class Schedule {
  private readonly collectedAt = new Map<AgentId, number>();
  private readonly nextAt = new Map<AgentId, number>();
  private active: ReadonlySet<string> = new Set();

  constructor(
    private readonly agentIds: readonly AgentId[],
    private readonly intervals: Intervals = config.cadence,
  ) {}

  observe(active: ReadonlySet<string>): void {
    this.active = active;
    for (const [id, at] of this.collectedAt) {
      if (!active.has(id)) continue;
      const soon = at + this.intervals.activeIntervalMs;
      if (soon < (this.nextAt.get(id) ?? Infinity)) this.nextAt.set(id, soon);
    }
  }

  collected(ids: readonly AgentId[], at: number): void {
    for (const id of ids) {
      this.collectedAt.set(id, at);
      this.nextAt.set(id, at + (this.active.has(id) ? this.intervals.activeIntervalMs : this.intervals.idleIntervalMs));
    }
  }

  // 快要到期的几家顺带进这一轮，免得前后差几毫秒各发一封、各拉一遍 Cursor 与 Devin 用量。
  due(now: number): AgentId[] {
    const horizon = now + this.intervals.activeIntervalMs / 10;
    return this.agentIds.filter((id) => (this.nextAt.get(id) ?? -Infinity) <= horizon);
  }

  delay(now: number): number {
    let soonest = Infinity;
    for (const id of this.agentIds) soonest = Math.min(soonest, this.nextAt.get(id) ?? -Infinity);
    return Math.max(0, soonest - now);
  }
}

export async function waitForNextRound(
  schedule: Schedule,
  activeIntervalMs = config.cadence.activeIntervalMs,
  runtime = {
    readActive: () => readActiveAgents(),
    now: () => performance.now(),
    sleep: (ms: number): Promise<void> => sleep(ms),
  },
): Promise<void> {
  for (;;) {
    schedule.observe(await runtime.readActive());
    const delay = schedule.delay(runtime.now());
    if (delay <= 0) return;
    await runtime.sleep(Math.min(activeIntervalMs, delay));
  }
}
