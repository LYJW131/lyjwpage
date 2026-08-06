import type { ChargerSample, ChargerStatus } from "@/lib/types";

/**
 * 充电头状态与总功率历史的进程内存储。
 *
 * 上线后数据是「推」进来的：那台机器每 30 秒把 a2687 的 /status 原样 POST
 * 过来。30 秒一个点，光靠客户端自己累积的话，页面一刷新曲线就没了、
 * 而且要攒半小时才有形状 —— 所以历史必须存在服务端。
 */

/** 历史点数上限。30 秒一个点 → 约 90 分钟 */
const HISTORY_LIMIT = 180;

/**
 * 两个采样点之间的最小间隔。
 * 推送模式下 30 秒一次，这个阈值不会触发；本地轮询模式是 1Hz，
 * 靠它把历史稀释成同一量级，否则 180 个点只够 3 分钟。
 */
const MIN_SAMPLE_GAP_MS = 5_000;

export type Source = "push" | "pull";

let latest: ChargerStatus | null = null;
let latestReceivedAt = 0;
/** 只记推送的到达时刻：轮询也会写 latest，不能用它判断有没有推送 */
let lastPushAt = 0;
const history: ChargerSample[] = [];

/** 记一条快照。同一个 updatedAt 重复推送不会产生重复采样点 */
export function recordStatus(
  status: ChargerStatus,
  source: Source,
  receivedAt = Date.now(),
) {
  const previous = latest;
  latest = status;
  latestReceivedAt = receivedAt;
  if (source === "push") lastPushAt = receivedAt;

  // 上游 12 秒才换一次 updated_at，同一帧被推两次时不重复记
  if (previous && status.updatedAt != null && previous.updatedAt === status.updatedAt) {
    return;
  }

  const last = history[history.length - 1];
  const at = status.updatedAt ?? receivedAt;

  if (last) {
    // 顺序很重要：时间倒流时 (at - last.t) 是负数，也会小于 MIN_SAMPLE_GAP_MS。
    // 先判倒流再判间隔，否则重置分支永远走不到，新数据会被一直丢掉。
    if (at < last.t) {
      // 对端改了时钟或换了数据源，旧历史已经没法和新的拼在一条时间轴上
      history.length = 0;
    } else if (at - last.t < MIN_SAMPLE_GAP_MS) {
      return;
    }
  }

  history.push({ t: at, w: status.totalPower });
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
}

export function getStored() {
  if (!latest) return null;
  return { status: latest, receivedAt: latestReceivedAt, history: [...history] };
}

/** 有没有收到过真正的推送 —— 用来决定是走推送还是回退到本地轮询 */
export function hasPushedData() {
  return lastPushAt > 0;
}

/** 最近一次推送的到达时刻，用来判断断流 */
export function lastPushReceivedAt() {
  return lastPushAt;
}

/** v2 heartbeat keeps liveness fresh without resending an unchanged charger snapshot. */
export function recordPushHeartbeat(receivedAt = Date.now()) {
  lastPushAt = receivedAt;
}
