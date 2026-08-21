/**
 * 充电设备负载的类型收敛。纯函数，客户端和 ingest 共用。
 *
 * 上报器 `chargingDevices.devices[]` 和本机 SSE 的 `device` 是同一形状：
 * 公共字段在顶层，设备特有的收在子对象。这里不碰 Redis。
 */

import type { ChargerPort, ChargerStatus, PowerBankPort, PowerBankStatus } from "./types";

const CHARGER_PORTS = ["C1", "C2", "C3"] as const;
const POWER_BANK_PORTS = ["C1", "C2", "A", "B"] as const;

/** Anker Prime 充电头额定总功率 */
export const CHARGER_MAX_POWER = 160;
/** 充电宝额定总输出，用来算功率条比例 */
export const POWER_BANK_MAX_OUTPUT = 220;

type RawDevicePort = {
  name?: string;
  active?: boolean;
  direction?: string | null;
  voltageV?: number | null;
  currentA?: number | null;
  powerW?: number | null;
  attached?: boolean | null;
  cable?: string | null;
  chargingInfo?: string | null;
  attachedDevice?: { model?: string | null; vendor?: string | null } | null;
};

export type RawChargingDevice = {
  id?: string;
  /** "charger" / "powerBank" */
  kind?: string;
  model?: string | null;
  connected?: boolean;
  updatedAt?: number;
  firmware?: string | null;
  totalInputW?: number | null;
  totalOutputW?: number | null;
  battery?: {
    percent?: number | null;
    charging?: boolean | null;
    timeToFullMinutes?: number | null;
    thermalLimited?: boolean | null;
    healthPercent?: number | null;
  } | null;
  temperaturesC?: number[] | null;
  ports?: RawDevicePort[];
};

export type RawChargingDevices = {
  devices?: RawChargingDevice[];
};

export type RawPowerBank = RawChargingDevice;

/** 空串和纯空白都当没有。上报器那边取不到值时给的就是 null，不再有 "N/A" 占位符 */
function displayText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

/** 上游给的是秒（带小数），转成 JS 毫秒 */
function toMillis(updatedAt: number | undefined): number | null {
  if (updatedAt == null || Number.isNaN(Number(updatedAt))) return null;
  const value = Number(updatedAt);
  return value > 1e12 ? value : value * 1000;
}

function normalizeChargerPort(id: string, port: RawDevicePort = {}): ChargerPort {
  const active = Boolean(port.active);
  return {
    id,
    active,
    voltage: active ? Number(port.voltageV) || 0 : null,
    current: active ? Number(port.currentA) || 0 : null,
    power: active ? Number(port.powerW) || 0 : null,
    device: displayText(port.attachedDevice?.model) ?? displayText(port.attachedDevice?.vendor),
    protocol: displayText(port.chargingInfo),
    cable: displayText(port.cable),
  };
}

function normalizePowerBankPort(id: string, port: RawDevicePort = {}): PowerBankPort {
  const active = Boolean(port.active);
  const direction = port.direction === "in" || port.direction === "out" ? port.direction : null;
  return {
    id,
    active,
    direction: active ? direction : null,
    attached: Boolean(port.attached),
    power: active ? Number(port.powerW) || 0 : null,
    voltage: active ? Number(port.voltageV) || 0 : null,
    current: active ? Number(port.currentA) || 0 : null,
  };
}

/**
 * 从多设备负载里挑出充电头。用 `kind` 认，不要靠数组顺序。
 * 一台都没有就返回 null，调用方按「这次没带充电头」处理。
 */
export function pickCharger(raw: RawChargingDevices): RawChargingDevice | null {
  return raw.devices?.find((device) => device.kind === "charger") ?? null;
}

export function pickPowerBank(devices: unknown): RawPowerBank | null {
  if (!devices || typeof devices !== "object") return null;
  const list = (devices as { devices?: unknown }).devices;
  if (!Array.isArray(list)) return null;
  return (list as RawPowerBank[]).find((device) => device?.kind === "powerBank") ?? null;
}

export function normalizeChargingDevice(raw: RawChargingDevice): ChargerStatus {
  const byName = new Map(
    (raw.ports ?? []).map((port) => [String(port.name ?? "").toUpperCase(), port]),
  );
  return {
    connected: Boolean(raw.connected),
    totalPower: Number(raw.totalOutputW) || 0,
    maxPower: CHARGER_MAX_POWER,
    ports: CHARGER_PORTS.map((key) => normalizeChargerPort(key, byName.get(key))),
    device: {
      serialNumber: displayText(raw.id),
      firmwareVersion: displayText(raw.firmware),
    },
    updatedAt: toMillis(raw.updatedAt),
  } satisfies ChargerStatus;
}

export function normalizePowerBank(raw: RawPowerBank): PowerBankStatus {
  const byName = new Map(
    (raw.ports ?? []).map((port) => [String(port.name ?? "").toUpperCase().trim(), port]),
  );
  const temperatures = (raw.temperaturesC ?? []).filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  return {
    connected: Boolean(raw.connected),
    battery: raw.battery?.percent ?? null,
    charging: Boolean(raw.battery?.charging),
    timeToFullMinutes: raw.battery?.timeToFullMinutes ?? null,
    thermalLimited: Boolean(raw.battery?.thermalLimited),
    batteryHealth: raw.battery?.healthPercent ?? null,
    inputPower: Number(raw.totalInputW) || 0,
    outputPower: Number(raw.totalOutputW) || 0,
    temperatures,
    ports: POWER_BANK_PORTS.map((id) => normalizePowerBankPort(id, byName.get(id))),
    device: {
      serialNumber: displayText(raw.id),
      firmwareVersion: displayText(raw.firmware),
    },
    updatedAt: toMillis(raw.updatedAt),
  } satisfies PowerBankStatus;
}

export function emptyChargerStatus(connected: boolean): ChargerStatus {
  return {
    connected,
    totalPower: 0,
    maxPower: CHARGER_MAX_POWER,
    ports: CHARGER_PORTS.map((id) => normalizeChargerPort(id)),
    device: { serialNumber: null, firmwareVersion: null },
    updatedAt: null,
  };
}

export function emptyPowerBankStatus(connected: boolean): PowerBankStatus {
  return {
    connected,
    battery: null,
    charging: false,
    timeToFullMinutes: null,
    thermalLimited: false,
    batteryHealth: null,
    inputPower: 0,
    outputPower: 0,
    temperatures: [],
    ports: POWER_BANK_PORTS.map((id) => normalizePowerBankPort(id)),
    device: { serialNumber: null, firmwareVersion: null },
    updatedAt: null,
  };
}
