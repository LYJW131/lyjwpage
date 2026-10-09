
import { IMAGE_OBJECT_KEY } from "./asset-url.ts";
import { text } from "./json.ts";
import type {
  ChargerPort,
  ChargerStatus,
  PowerBankPort,
  PowerBankStatus,
  ReportedChargerStatus,
  ReportedChargingDeviceInfo,
  ReportedPowerBankStatus,
} from "./types";

const CHARGER_PORTS = ["C1", "C2", "C3"] as const;
const POWER_BANK_PORTS = ["C1", "C2", "A", "B"] as const;

export const CHARGER_MAX_POWER = 160;
export const CHARGER_MODEL = "A2687";
export const POWER_BANK_MODEL = "A110G";

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
  cover?: {
    name?: string | null;
    iconHash?: string | null;
    iconObjectKey?: string | null;
  } | null;
};

export type RawChargingDevices = {
  devices?: RawChargingDevice[];
};

export type RawPowerBank = RawChargingDevice;

function displayText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function deviceInfo(raw: RawChargingDevice): ReportedChargingDeviceInfo {
  return {
    serialNumber: displayText(raw.id),
    firmwareVersion: displayText(raw.firmware),
    model: displayText(raw.model),
  };
}

export function ankerModelLabel(model: string | null | undefined, fallback: string): string {
  const sku = displayText(model) ?? fallback;
  return /^anker\b/i.test(sku) ? sku : `Anker ${sku}`;
}

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

export function pickCharger(raw: RawChargingDevices): RawChargingDevice | null {
  return raw.devices?.find((device) => device.kind === "charger") ?? null;
}

export function pickPowerBank(devices: unknown): RawPowerBank | null {
  if (!devices || typeof devices !== "object") return null;
  const list = (devices as { devices?: unknown }).devices;
  if (!Array.isArray(list)) return null;
  return (list as RawPowerBank[]).find((device) => device?.kind === "powerBank") ?? null;
}

export function normalizeChargingDevice(raw: RawChargingDevice): ReportedChargerStatus {
  const byName = new Map(
    (raw.ports ?? []).map((port) => [String(port.name ?? "").toUpperCase(), port]),
  );
  return {
    connected: Boolean(raw.connected),
    totalPower: Number(raw.totalOutputW) || 0,
    maxPower: CHARGER_MAX_POWER,
    ports: CHARGER_PORTS.map((key) => normalizeChargerPort(key, byName.get(key))),
    device: deviceInfo(raw),
    cover: readCover(raw.cover),
    updatedAt: toMillis(raw.updatedAt),
  } satisfies ReportedChargerStatus;
}

const HASH = /^[a-f0-9]{64}$/;

export function readCover(raw: unknown): ChargerStatus["cover"] {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("chargingDevices.cover 必须是对象");
  }
  const row = raw as Record<string, unknown>;
  const name = text(row.name);
  if (!name) throw new Error("chargingDevices.cover 缺少 name");
  const iconHash = text(row.iconHash);
  if (iconHash != null && !HASH.test(iconHash)) {
    throw new Error("chargingDevices.cover.iconHash 必须是 SHA-256 十六进制字符串");
  }
  const iconObjectKey = text(row.iconObjectKey);
  if (iconObjectKey != null && !IMAGE_OBJECT_KEY.test(iconObjectKey)) {
    throw new Error("chargingDevices.cover.iconObjectKey 必须是 <sha256>.png / .webp / .jpg");
  }
  if (iconObjectKey != null && iconHash == null) {
    throw new Error("chargingDevices.cover.iconObjectKey 必须和 iconHash 一起上报");
  }
  return { name, iconHash, iconObjectKey, iconUrl: null };
}

export function normalizePowerBank(raw: RawPowerBank): ReportedPowerBankStatus {
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
    device: deviceInfo(raw),
    updatedAt: toMillis(raw.updatedAt),
  } satisfies ReportedPowerBankStatus;
}

export function emptyChargerStatus(connected: boolean): ChargerStatus {
  return {
    connected,
    totalPower: 0,
    maxPower: CHARGER_MAX_POWER,
    ports: CHARGER_PORTS.map((id) => normalizeChargerPort(id)),
    device: { firmwareVersion: null, model: null },
    cover: null,
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
    device: { firmwareVersion: null, model: null },
    updatedAt: null,
  };
}
