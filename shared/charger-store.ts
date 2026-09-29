import { key } from "@/lib/storage";
import type { ChargerSample, ChargerStatus } from "@/lib/types";

/** 连续断联满这么久，旧曲线不再属于下一次连接。 */
export const DISCONNECTED_HISTORY_AFTER_MS = 30 * 60 * 1000;

export const K_LATEST = key("charger", "latest");

export const K_HISTORY = key("charger", "history");

export const K_LAST_PUSH = key("charger", "lastPush");

/**
 * SQLite 不可达时的退路。规则和 lib/storage 的 mirrorKey 一致，这里手写是因为
 * 充电头是两个 string 键加一条 list，套不进单键那个工厂。Worker 的存储驱动在持久化失败时抛错、
 * 不会走到退路，只有 Node 测试驱动会。
 *
 * `persisted` 记的是内存这份有没有真落进 SQLite：没落进去时它就是唯一真相，
 * SQLite 说「没有」不能当成「被删了」。
 */
export const fallback = {
  latest: null as ChargerStatus | null,
  receivedAt: 0,
  disconnectedAt: 0,
  lastPushAt: 0,
  history: [] as ChargerSample[],
  persisted: false,
};

export type Stored = {
  status: ChargerStatus;
  receivedAt: number;
  /** 首次收到 connected=false 的时刻；缺省或 null 时按 receivedAt 算。 */
  disconnectedAt?: number | null;
};

export type ChargerState = {
  previous: Stored | null;
  history: ChargerSample[];
};

export function disconnectedHistoryExpired(stored: Stored, now: number) {
  if (stored.status.connected) return false;
  const disconnectedAt = stored.disconnectedAt ?? stored.receivedAt;
  return now - disconnectedAt >= DISCONNECTED_HISTORY_AFTER_MS;
}

export type ChargerLanding = {
  /**
   * 需要即时通知的内容变没变。这个 diff 必须服务端自己做：充电时采集端每个上报
   * 周期都会带 charger 模块（功率两位小数必变），收到就推的话推送会退化成定时
   * 广播，「插拔即时」也就没了意义。
   */
  structuralChanged: boolean;
  /** 落库之后服务端还留着几个采样点。推送靠它决定发空增量还是发整份 */
  historyCount: number;
  /** 把这一帧写下去。交给 fanout 的 `writes`：落库确认之后才派发推送（workers/api/src/fanout.ts） */
  commit: () => Promise<void>;
};
