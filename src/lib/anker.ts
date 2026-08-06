import { cached } from "@/lib/cache";
import {
  getStored,
  hasPushedData,
  lastPushReceivedAt,
  recordStatus,
} from "@/lib/charger-store";
import type { ChargerPayload, ChargerPort, ChargerStatus } from "@/lib/types";

/**
 * Anker Prime 160W (A2687) 实时遥测。
 *
 * 上游是本机常驻的 a2687-telemetry 服务，它通过 BLE 读充电器、以 HTTP 暴露快照。
 * BLE 上游本身就是 ~1Hz 推流，所以再快的轮询也拿不到新数据。
 */

const PORT_KEYS = ["C1", "C2", "C3"] as const;
/** 与 BLE 推流速率对齐 */
const STATUS_TTL_MS = 900;
/** 上游在本机，超时给短一点，别让页面卡着 */
const TIMEOUT_MS = 2_500;
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

/**
 * 把 a2687 的 /status 原样 JSON 规范化。
 * 推送进来的和本地轮询到的是同一份格式，共用这一个函数。
 */
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

/** 本地轮询遥测服务。上线走推送后这条路就不用了，本地开发还留着 */
export async function pullChargerStatus(): Promise<ChargerStatus> {
  const base = (process.env.ANKER_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");

  return cached("anker:status", STATUS_TTL_MS, async () => {
    const response = await fetch(`${base}/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`充电头遥测服务返回 ${response.status}`);
    }

    return normalizeRawStatus((await response.json()) as RawStatus);
  });
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
 * 对外的取数入口。
 *
 * 只要收到过一次推送，就以推送为准，不再去轮询本地服务 ——
 * 上线后那台机器根本不在同一台主机上，轮询必然失败。
 * 一次推送都没收到过（本地开发）才回退到轮询。
 */
export async function getChargerPayload(): Promise<ChargerPayload> {
  if (hasPushedData()) {
    const stored = getStored()!;
    // 断流看的是「最后一次推送到达」，不是 latest 的写入时刻
    const stale = Date.now() - lastPushReceivedAt() > staleAfterMs();
    return {
      ...stored.status,
      // 推送断了就不能再声称充电器在线，否则页面会一直显示旧的瓦数
      connected: stale ? false : stored.status.connected,
      history: stored.history,
      source: "push",
      stale,
    };
  }

  const status = await pullChargerStatus();
  recordStatus(status, "pull");
  const stored = getStored();
  return {
    ...status,
    history: stored?.history ?? [],
    source: "pull",
    stale: false,
  };
}
