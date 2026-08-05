import { cached } from "@/lib/cache";
import type { ChargerPort, ChargerStatus } from "@/lib/types";

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

type RawStatus = {
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

export async function getChargerStatus(): Promise<ChargerStatus> {
  const base = (process.env.ANKER_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");

  return cached("anker:status", STATUS_TTL_MS, async () => {
    const response = await fetch(`${base}/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`充电头遥测服务返回 ${response.status}`);
    }

    const raw = (await response.json()) as RawStatus;

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
  });
}
