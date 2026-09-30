// EventSource 默认无限重连；未提供本机服务的访客必须在失败时关闭连接。

import { publicAssetPath } from "./asset-url.ts";
import {
  LOCAL_CHARGING_STORAGE_KEY,
  readLocalChargingArmed,
} from "./local-charging-arm.ts";
import {
  emptyChargerStatus,
  emptyPowerBankStatus,
  normalizeChargingDevice,
  normalizePowerBank,
  type RawChargingDevice,
} from "./charging-device.ts";
import { object } from "./json.ts";
import { LIVE_INTERVAL_MS, LIVE_WINDOW_MS } from "./limits.ts";
import type {
  ChargerPayload,
  ChargerSample,
  PowerBankPayload,
  ReporterPresence,
} from "./types.ts";

const LOCAL_HISTORY_LIMIT = Math.round(LIVE_WINDOW_MS / LIVE_INTERVAL_MS);

const LOCAL_ORIGIN = "http://127.0.0.1:8787";
const LOCAL_STALE_MS = 15_000;

export type LocalCharging = {
  charger: ChargerPayload | null;
  powerBank: PowerBankPayload | null;
};

const EMPTY: LocalCharging = { charger: null, powerBank: null };

let snapshot: LocalCharging = EMPTY;
const listeners = new Set<() => void>();

let chargerHistory: ChargerSample[] = [];
let started = false;
let chargerSource: LocalSource | null = null;
let powerBankSource: LocalSource | null = null;

function emit(next: LocalCharging) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function presence(now: number): ReporterPresence {
  return {
    lastSeenAt: now,
    declaredOffline: false,
    heartbeatWindowMs: LOCAL_STALE_MS,
  };
}

function parseDevice(value: unknown): RawChargingDevice | null {
  return object(value);
}

function appendChargerSample(power: number, now: number) {
  chargerHistory = [...chargerHistory, { t: now, w: power }].slice(-LOCAL_HISTORY_LIMIT);
}

function localCoverIconUrl(objectKey: string | null | undefined): string | null {
  return objectKey ? publicAssetPath(objectKey) : null;
}

function chargerFromEvent(event: Record<string, unknown>): ChargerPayload {
  const now = Date.now();
  const bleConnected = event.connected === true;
  const device = parseDevice(event.device);
  const status = device ? normalizeChargingDevice(device) : emptyChargerStatus(bleConnected);
  const connected = bleConnected && status.connected;
  const cover = status.cover
    ? { ...status.cover, iconUrl: localCoverIconUrl(status.cover.iconObjectKey) }
    : null;
  appendChargerSample(connected ? status.totalPower : 0, now);
  return {
    ...status,
    cover,
    connected,
    history: chargerHistory,
    historyPartial: false,
    pushedAt: now,
    staleAfterMs: LOCAL_STALE_MS,
    ...presence(now),
  };
}

function powerBankFromEvent(event: Record<string, unknown>): PowerBankPayload {
  const now = Date.now();
  const bleConnected = event.connected === true;
  const device = parseDevice(event.device);
  const status = device ? normalizePowerBank(device) : emptyPowerBankStatus(bleConnected);
  return {
    ...status,
    connected: bleConnected && status.connected,
    pushedAt: now,
    staleAfterMs: LOCAL_STALE_MS,
    ...presence(now),
  };
}

type LocalSource = { close: () => void };

function connect(
  path: string,
  onEvent: (event: Record<string, unknown>) => void,
  onClosed: () => void,
): LocalSource {
  const source = new EventSource(`${LOCAL_ORIGIN}${path}`);
  let opened = false;
  let closed = false;
  let lastFrameAt = 0;
  let watchdog: number | null = null;

  const close = () => {
    if (closed) return;
    closed = true;
    if (watchdog != null) window.clearTimeout(watchdog);
    source.close();
    onClosed();
  };

  // 后台定时器会被延迟，关闭流之前重新核对真实间隔，避免误杀已恢复的流。
  const check = () => {
    const idleMs = Date.now() - lastFrameAt;
    if (idleMs < LOCAL_STALE_MS) {
      watchdog = window.setTimeout(check, LOCAL_STALE_MS - idleMs);
      return;
    }
    close();
  };

  // 连上却不出首帧也必须触发看门狗，否则会绕过首次失败关闭逻辑。
  source.onopen = () => {
    opened = true;
    lastFrameAt = Date.now();
    if (watchdog == null) watchdog = window.setTimeout(check, LOCAL_STALE_MS);
  };
  source.onmessage = (message) => {
    opened = true;
    lastFrameAt = Date.now();
    if (watchdog == null) watchdog = window.setTimeout(check, LOCAL_STALE_MS);
    try {
      const row = object(JSON.parse(message.data) as unknown);
      if (row) onEvent(row);
    } catch {
    }
  };
  source.onerror = () => {
    if (!opened) close();
  };
  return { close };
}

function armed(): boolean {
  if (typeof window === "undefined") return false;
  return readLocalChargingArmed();
}

function onStorage(event: StorageEvent) {
  if (event.key === LOCAL_CHARGING_STORAGE_KEY && event.newValue === "1") start();
}

function start() {
  if (started || typeof EventSource === "undefined" || !armed()) return;
  started = true;
  chargerSource = connect(
    "/sse/charger",
    (event) => emit({ ...snapshot, charger: chargerFromEvent(event) }),
    () => {
      chargerSource = null;
      if (snapshot.charger) emit({ ...snapshot, charger: null });
    },
  );
  powerBankSource = connect(
    "/sse/powerbank",
    (event) => emit({ ...snapshot, powerBank: powerBankFromEvent(event) }),
    () => {
      powerBankSource = null;
      if (snapshot.powerBank) emit({ ...snapshot, powerBank: null });
    },
  );
}

function stop() {
  chargerSource?.close();
  powerBankSource?.close();
  chargerSource = null;
  powerBankSource = null;
  started = false;
  chargerHistory = [];
  emit(EMPTY);
}

export function subscribeLocalCharging(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  start();
  if (listeners.size === 1) {
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", start);
    document.addEventListener("visibilitychange", start);
  }
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0) {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", start);
      document.removeEventListener("visibilitychange", start);
      stop();
    }
  };
}

export function getLocalCharging(): LocalCharging {
  return snapshot;
}

export function getLocalChargingServerSnapshot(): LocalCharging {
  return EMPTY;
}
