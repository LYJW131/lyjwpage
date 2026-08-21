/**
 * 本机 Mac Telemetry Hub 的充电设备 SSE。
 *
 * 页面挂载时试着连 `http://127.0.0.1:8787/sse/{charger,powerbank}`。
 * 连上说明浏览的就是这台 Mac，卡片改用这条 1 Hz 推流，不再用远端那份。
 * 连不上（别人的电脑、浏览器拦了混合内容）立刻关掉，不重试，远端照旧。
 *
 * EventSource 默认失败会无限重连 —— 访客机器上没有这个端口，必须在第一次
 * error 且从未 open 时 close，否则控制台会一直刷。出过声的流断掉（上报器
 * 退出）也一样：靠看门狗关掉并清空本机快照，卡片自动落回远端轮询，而不是
 * 顶着断流前的最后一帧一直装连着。恢复直连要刷新页面 —— 不自动重连，
 * 理由同上，本机端口没起来时重连就是刷屏。
 */

import { assetUrl, pageAssetBase } from "./asset-url.ts";
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

/** 只攒 sparkline 会画的那一窗（1 Hz × 2 分钟），多攒的每帧都白复制一遍。 */
const LOCAL_HISTORY_LIMIT = Math.round(LIVE_WINDOW_MS / LIVE_INTERVAL_MS);

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
  if (!objectKey) return null;
  const base = pageAssetBase();
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

  /**
   * 断流看门狗。后台标签页的定时器会被推迟，到点先核对真实间隔：
   * 没超说明只是醒得晚，接着睡剩下的，别把刚恢复的流误杀。
   */
  const check = () => {
    const idleMs = Date.now() - lastFrameAt;
    if (idleMs < LOCAL_STALE_MS) {
      watchdog = window.setTimeout(check, LOCAL_STALE_MS - idleMs);
      return;
    }
    close();
  };

  source.onopen = () => {
    opened = true;
  };
  source.onmessage = (message) => {
    opened = true;
    lastFrameAt = Date.now();
    if (watchdog == null) watchdog = window.setTimeout(check, LOCAL_STALE_MS);
    try {
      const row = object(JSON.parse(message.data) as unknown);
      if (row) onEvent(row);
    } catch {
      // 坏帧丢掉，等下一帧
    }
  };
  source.onerror = () => {
    if (!opened) close();
  };
  return { close };
}

function start() {
  if (started || typeof EventSource === "undefined") return;
  started = true;
  chargerSource = connect(
    "/sse/charger",
    (event) => emit({ ...snapshot, charger: chargerFromEvent(event) }),
    () => {
      chargerSource = null;
      // 清掉本机那半，charger-card 的 local 变 null，远端轮询自己就复活了
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
