import { getStored, lastPushReceivedAt } from "@/lib/charger-store";
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
  voltage_v?: number;
  current_a?: number;
  power_w?: number;
  cable?: string | null;
  charging_info?: string | null;
  model?: string | null;
  vendor?: string | null;
};

export type RawStatus = {
  connected?: boolean;
  updated_at?: number;
  total_output_power_w?: number;
  device?: {
    serial_number?: string | null;
    firmware_version?: string | null;
    mac_address?: string | null;
  };
  ports?: Record<string, RawPort>;
};

/**
 * 上游把 "N/A" 当占位符大量返回，不过滤 UI 上会出现一堆 N/A。
 */
function displayText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || text.toUpperCase() === "N/A") return null;
  return text;
}

function normalizePort(id: string, port: RawPort = {}): ChargerPort {
  const active = Boolean(port.mode);
  return {
    id,
    active,
    // 没在输出的口，读数没有意义 —— 统一置 null 交给 UI 显示 “闲置”
    voltage: active ? Number(port.voltage_v) || 0 : null,
    current: active ? Number(port.current_a) || 0 : null,
    power: active ? Number(port.power_w) || 0 : null,
    device: displayText(port.model) ?? displayText(port.vendor),
    protocol: displayText(port.charging_info),
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
    totalPower: Number(raw.total_output_power_w) || 0,
    maxPower: MAX_POWER,
    // ports 的 key 顺序不保证，必须按 key 取
    ports: PORT_KEYS.map((key) => normalizePort(key, raw.ports?.[key])),
    device: {
      serialNumber: displayText(raw.device?.serial_number),
      firmwareVersion: displayText(raw.device?.firmware_version),
    },
    updatedAt: toMillis(raw.updated_at),
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

export async function getChargerPayload(): Promise<ChargerPayload> {
  const stored = await getStored();
  // 还没收到过任何推送。交给 statusRoute 变成降级信封，前端显示提示
  if (!stored) throw new Error("尚未收到充电头遥测推送");

  const stale = Date.now() - (await lastPushReceivedAt()) > staleAfterMs();

  return {
    ...stored.status,
    // 推送断了就不能再声称充电器在线，否则页面会一直显示旧的瓦数
    connected: stale ? false : stored.status.connected,
    history: stored.history,
    stale,
  };
}
