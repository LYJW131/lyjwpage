import { getStored, lastPushReceivedAt } from "@/lib/charger-store";
import { reporterOffline } from "@/lib/reporter-liveness";
import type { ChargerPayload, ChargerPort, ChargerStatus } from "@/lib/types";

/**
 * Anker Prime 160W (A2687) 遥测。
 *
 * 数据只有一条来路：那台机器把 a2687-telemetry 的 /status 原样 POST 到
 * /api/ingest/charger。本站不主动轮询 —— 遥测服务在对方机器上，
 * 只在 Tailscale 内可达，本来也拉不到。
 */

const PORT_KEYS = ["C1", "C2", "C3"] as const;
/** Anker Prime 的额定总功率 */
const MAX_POWER = 160;

type RawPort = {
  mode?: boolean;
  voltageV?: number;
  currentA?: number;
  powerW?: number;
  cable?: string | null;
  chargingInfo?: string | null;
  model?: string | null;
  vendor?: string | null;
};

export type RawStatus = {
  connected?: boolean;
  updatedAt?: number;
  totalOutputPowerW?: number;
  device?: {
    serialNumber?: string | null;
    firmwareVersion?: string | null;
    macAddress?: string | null;
  };
  ports?: Record<string, RawPort>;
};

/** 空串和纯空白都当没有。上报器那边取不到值时给的就是 null，不再有 "N/A" 占位符 */
function displayText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizePort(id: string, port: RawPort = {}): ChargerPort {
  const active = Boolean(port.mode);
  return {
    id,
    active,
    // 没在输出的口，读数没有意义 —— 统一置 null 交给 UI 显示 “闲置”
    voltage: active ? Number(port.voltageV) || 0 : null,
    current: active ? Number(port.currentA) || 0 : null,
    power: active ? Number(port.powerW) || 0 : null,
    device: displayText(port.model) ?? displayText(port.vendor),
    protocol: displayText(port.chargingInfo),
    cable: displayText(port.cable),
  };
}

/** 上游给的是秒（带小数），转成 JS 毫秒 */
function toMillis(updatedAt: number | undefined): number | null {
  if (updatedAt == null || Number.isNaN(Number(updatedAt))) return null;
  const value = Number(updatedAt);
  return value > 1e12 ? value : value * 1000;
}

/** 把 a2687 的 /status 原样 JSON 规范化 */
export function normalizeRawStatus(raw: RawStatus): ChargerStatus {
  return {
    connected: Boolean(raw.connected),
    totalPower: Number(raw.totalOutputPowerW) || 0,
    maxPower: MAX_POWER,
    // ports 的 key 顺序不保证，必须按 key 取
    ports: PORT_KEYS.map((key) => normalizePort(key, raw.ports?.[key])),
    device: {
      serialNumber: displayText(raw.device?.serialNumber),
      firmwareVersion: displayText(raw.device?.firmwareVersion),
    },
    updatedAt: toMillis(raw.updatedAt),
  } satisfies ChargerStatus;
}

/**
 * 太久没收到推送就认为数据不新鲜。
 * 按上报间隔的 3 倍算，默认间隔 30 秒 → 90 秒没消息就标记为 stale。
 */
function staleAfterMs() {
  const interval = Number(process.env.CHARGER_PUSH_INTERVAL_MS) || 30_000;
  return Math.max(90_000, interval * 3);
}

/**
 * `since` 是客户端已有的最新采样点时刻，只回传比它更新的部分。
 *
 * 曲线有 400 个点、约 15KB，而前端 5 秒取一次、每次实际只多出一两个点 ——
 * 整份重传的话 99% 是重复数据。
 */
export async function getChargerPayload(
  { since }: { since?: number } = {},
): Promise<ChargerPayload> {
  const stored = await getStored();
  // 还没收到过任何推送。交给 statusRoute 变成降级信封，前端显示提示
  if (!stored) throw new Error("尚未收到充电头遥测推送");

  // 存活走全站统一判据；再叠上「充电器数据本身太旧」这层各自的口径。
  // 从前这里只看后者（90 秒），和 desktop/music 的 45 秒错开，同一台 Mac 掉线时
  // 两张卡先后变灰。
  const stale =
    reporterOffline() || Date.now() - (await lastPushReceivedAt()) > staleAfterMs();

  const all = stored.history;
  const oldest = all[0]?.t;
  /**
   * 只有「客户端手上最新的点」不早于「服务端还留着的最旧的点」时，增量才是
   * 连续的。客户端离开太久的话中间那段已经被裁掉了，拼出来会是断的曲线，
   * 这种情况只能整份重发。
   */
  const historyPartial = since != null && oldest != null && since >= oldest;

  return {
    ...stored.status,
    // 推送断了就不能再声称充电器在线，否则页面会一直显示旧的瓦数
    connected: stale ? false : stored.status.connected,
    history: historyPartial ? all.filter((sample) => sample.t > since) : all,
    historyPartial,
    stale,
  };
}
