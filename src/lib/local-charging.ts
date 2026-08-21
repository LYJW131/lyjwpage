/**
 * 本机 Mac Telemetry Hub 的充电设备 SSE。
 *
 * 页面挂载时试着连 `http://127.0.0.1:8787/sse/{charger,powerbank}`。
 * 连上说明浏览的就是这台 Mac，卡片改用这条 1 Hz 推流，不再用远端那份。
 * 连不上（别人的电脑、浏览器拦了混合内容）立刻关掉，不重试，远端照旧。
 *
 * EventSource 默认失败会无限重连 —— 访客机器上没有这个端口，必须在第一次
 * error 且从未 open 时 close，否则控制台会一直刷。
 */

import { assetUrl } from "./asset-url.ts";
import {
  emptyChargerStatus,
  emptyPowerBankStatus,
  normalizeChargingDevice,
  normalizePowerBank,
  type RawChargingDevice,
} from "./charging-device.ts";
import { object } from "./json.ts";
import { CHARGER_HISTORY_LIMIT } from "./limits.ts";
import type {
  ChargerPayload,
  ChargerSample,
  PowerBankPayload,
  ReporterPresence,
} from "./types.ts";

/** 本机 SSE 约 1 Hz。20 分钟窗口要 1200 点，不能再用远端 5 秒一格的 400。 */
const LOCAL_HISTORY_LIMIT = Math.max(CHARGER_HISTORY_LIMIT, 20 * 60);

const LOCAL_ORIGIN = "http://127.0.0.1:8787";
/** SSE 约 1 Hz。十几秒没帧才算这条流死了，别跟远端 90 秒窗口混。 */
const LOCAL_STALE_MS = 15_000;

export type LocalCharging = {
  charger: ChargerPayload | null;
  powerBank: PowerBankPayload | null;
};

const EMPTY: LocalCharging = { charger: null, powerBank: null };

let snapshot: LocalCharging = EMPTY;
const listeners = new Set<() => void>();

let chargerHistory: ChargerSample[] = [];
let chargerHistorySeeded = false;
/** 第一条 SSE 起只记 1 Hz 活点，丢掉首屏那份远端 30 秒一格的种子。 */
let liveStream = false;
let started = false;
let chargerSource: EventSource | null = null;
let powerBankSource: EventSource | null = null;

function emit(next: LocalCharging) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function presence(now: number): ReporterPresence {
  return {
    lastSeenAt: now,
    declaredOffline: false,
    heartbeatWindowMs: LOCAL_STALE_MS,
    offlineAtSource: false,
  };
}

function parseDevice(value: unknown): RawChargingDevice | null {
  return object(value);
}

function appendChargerSample(power: number, now: number) {
  chargerHistory = [...chargerHistory, { t: now, w: power }].slice(-LOCAL_HISTORY_LIMIT);
}

function localCoverIconUrl(objectKey: string | null | undefined): string | null {
  if (!objectKey || typeof document === "undefined") return null;
  const base = document.querySelector<HTMLMetaElement>("meta[name='asset-base-url']")?.content;
  return base ? assetUrl(base, objectKey) : null;
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
  if (!liveStream) {
    liveStream = true;
    chargerHistory = [];
  }
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

function connect(
  path: string,
  onEvent: (event: Record<string, unknown>) => void,
  onClosed: () => void,
): EventSource {
  const source = new EventSource(`${LOCAL_ORIGIN}${path}`);
  let opened = false;
  source.onopen = () => {
    opened = true;
  };
  source.onmessage = (message) => {
    opened = true;
    try {
      const row = object(JSON.parse(message.data) as unknown);
      if (row) onEvent(row);
    } catch {
      // 坏帧丢掉，等下一帧
    }
  };
  source.onerror = () => {
    if (!opened) {
      source.close();
      onClosed();
    }
  };
  return source;
}

function start() {
  if (started || typeof EventSource === "undefined") return;
  started = true;
  chargerSource = connect(
    "/sse/charger",
    (event) => emit({ ...snapshot, charger: chargerFromEvent(event) }),
    () => {
      chargerSource = null;
    },
  );
  powerBankSource = connect(
    "/sse/powerbank",
    (event) => emit({ ...snapshot, powerBank: powerBankFromEvent(event) }),
    () => {
      powerBankSource = null;
    },
  );
}

function stop() {
  chargerSource?.close();
  powerBankSource?.close();
  chargerSource = null;
  powerBankSource = null;
  started = false;
  liveStream = false;
  chargerHistory = [];
  chargerHistorySeeded = false;
  emit(EMPTY);
}

export function seedLocalChargerHistory(payload: { history: ChargerSample[] } | undefined) {
  if (liveStream || chargerHistorySeeded || !payload?.history.length) return;
  chargerHistory = payload.history.slice(-LOCAL_HISTORY_LIMIT);
  chargerHistorySeeded = true;
}

export function subscribeLocalCharging(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  start();
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0) stop();
  };
}

export function getLocalCharging(): LocalCharging {
  return snapshot;
}

export function getLocalChargingServerSnapshot(): LocalCharging {
  return EMPTY;
}
