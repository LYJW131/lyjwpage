import { CHARGER_HISTORY_LIMIT } from "@/lib/limits";
import { tellStorage, withStorage } from "@/lib/storage";
import type { ChargerSample, ChargerStatus } from "@/lib/types";
import { type ChargerLanding, type ChargerState, DISCONNECTED_HISTORY_AFTER_MS, K_HISTORY, K_LAST_PUSH, K_LATEST, type Stored, disconnectedHistoryExpired, fallback } from "@shared/charger-store";


const MIN_SAMPLE_GAP_MS = 5_000;

const TTL_MS = 24 * 60 * 60 * 1000;

type HistoryPlan =
  | { kind: "keep" }
  | { kind: "clear" }
  | { kind: "append"; sample: ChargerSample; reset: boolean };

// 端口 active 不能从功率推断：插线但未取电时仍是开启状态。
function structuralKey(status: ChargerStatus) {
  return JSON.stringify([
    status.connected,
    status.totalPower > 1,
    status.device.serialNumber,
    status.device.firmwareVersion,
    status.ports.map((port) => [port.id, port.active, port.device]),
    status.cover?.name ?? null,
    status.cover?.iconHash ?? null,
  ]);
}

function planHistory(
  previous: Stored | null,
  status: ChargerStatus,
  receivedAt: number,
  stored: ChargerSample[],
  resetAfterDisconnect: boolean,
): HistoryPlan {
  const clear = resetAfterDisconnect && stored.length > 0;
  const nothing: HistoryPlan = clear ? { kind: "clear" } : { kind: "keep" };
  if (resetAfterDisconnect && !status.connected) return nothing;
  const history = resetAfterDisconnect ? [] : stored;

  if (previous && status.updatedAt != null && previous.status.updatedAt === status.updatedAt) {
    return nothing;
  }

  const last = history[history.length - 1];
  const at = status.updatedAt ?? receivedAt;
  let reset = false;

  if (last) {
    // 必须先判时钟倒流；负间隔也小于最短采样间隔，会遮住重置分支。
    if (at < last.t) {
      reset = true;
    } else if (at - last.t < MIN_SAMPLE_GAP_MS) {
      return nothing;
    }
  }

  return { kind: "append", sample: { t: at, w: status.totalPower }, reset: reset || clear };
}

export function prepareStatus(
  status: ChargerStatus,
  receivedAt: number,
  { previous, history }: ChargerState,
): ChargerLanding {
  const previousDisconnectedAt =
    previous && !previous.status.connected
      ? previous.disconnectedAt ?? previous.receivedAt
      : null;
  const disconnectedAt = status.connected ? 0 : previousDisconnectedAt ?? receivedAt;
  const resetAfterDisconnect =
    previousDisconnectedAt != null &&
    receivedAt - previousDisconnectedAt >= DISCONNECTED_HISTORY_AFTER_MS;
  const structuralChanged =
    !previous || structuralKey(previous.status) !== structuralKey(status);

  const plan = planHistory(previous, status, receivedAt, history, resetAfterDisconnect);

  const kept =
    plan.kind === "keep" ? history.length : plan.kind === "clear" ? 0 : plan.reset ? 0 : history.length;
  const historyCount = Math.min(
    kept + (plan.kind === "append" ? 1 : 0),
    CHARGER_HISTORY_LIMIT,
  );

  return {
    structuralChanged,
    historyCount,
    commit: async () => {
      fallback.persisted = await tellStorage(async (storage) => {
        const pipe = storage.batch();
        pipe.set(
          K_LATEST,
          JSON.stringify({ status, receivedAt, disconnectedAt: disconnectedAt || null }),
          { ttlMs: TTL_MS },
        );
        pipe.set(K_LAST_PUSH, String(receivedAt), { ttlMs: TTL_MS });
        if (plan.kind === "clear" || (plan.kind === "append" && plan.reset)) pipe.remove(K_HISTORY);
        if (plan.kind === "append") {
          pipe.append(K_HISTORY, JSON.stringify(plan.sample));
          pipe.trim(K_HISTORY, -CHARGER_HISTORY_LIMIT, -1);
          pipe.expire(K_HISTORY, TTL_MS);
        }
        return pipe.execute();
      });
      fallback.latest = status;
      fallback.receivedAt = receivedAt;
      fallback.disconnectedAt = disconnectedAt;
      fallback.lastPushAt = receivedAt;
      if (plan.kind !== "keep") {
        if (plan.kind === "clear" || plan.reset) fallback.history.length = 0;
        if (plan.kind === "append") fallback.history.push(plan.sample);
        if (fallback.history.length > CHARGER_HISTORY_LIMIT) {
          fallback.history.splice(0, fallback.history.length - CHARGER_HISTORY_LIMIT);
        }
      }
    },
  };
}

export function prepareHeartbeat(
  receivedAt: number,
  { previous, history }: ChargerState,
): { commit: () => Promise<void> } {
  const expired =
    previous != null &&
    disconnectedHistoryExpired(previous, receivedAt) &&
    history.length > 0;

  return {
    commit: async () => {
      fallback.lastPushAt = receivedAt;
      if (expired) fallback.history.length = 0;
      // 心跳写入不能翻转快照的 persisted 标志，两者不是同一份数据。
      await withStorage(async (storage) => {
        const pipe = storage.batch();
        pipe.set(K_LAST_PUSH, String(receivedAt), { ttlMs: TTL_MS });
        if (expired) pipe.remove(K_HISTORY);
        return pipe.execute();
      }, null);
    },
  };
}
