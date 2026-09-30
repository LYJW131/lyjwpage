import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname } from "node:path";

import { config } from "./config.js";
import { failure, recovered } from "./log.js";

export const TRAFFIC_STATE_VERSION = 1;

export type TrafficState = {
  version: number;
  interface: string;
  cycleStart: number;
  cycleEnd: number;
  rxBytes: number;
  txBytes: number;
  rxCursor: number;
  txCursor: number;
  updatedAt: number;
};

export type TrafficReport = {
  cycleStart: number;
  cycleEnd: number;
  rxBytes: number;
  txBytes: number;
  quotaBytes: number | null;
};

export function shiftMonth(moment: Date, months: number): Date {
  const index = moment.getUTCFullYear() * 12 + moment.getUTCMonth() + months;
  return new Date(Date.UTC(Math.floor(index / 12), index % 12, moment.getUTCDate(),
    moment.getUTCHours(), moment.getUTCMinutes(), moment.getUTCSeconds()));
}

export function cycleBounds(nowMs: number, day: number): [number, number] {
  const now = new Date(nowMs);
  const anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day));
  const start = nowMs >= anchor.getTime() ? anchor : shiftMonth(anchor, -1);
  return [start.getTime(), shiftMonth(start, 1).getTime()];
}

export function accumulate(
  state: Partial<TrafficState>,
  iface: string,
  rx: number,
  tx: number,
  nowMs: number,
  day: number,
  bootMs: number | null = null,
): TrafficState {
  const [start, end] = cycleBounds(nowMs, day);
  const sameIface = state.interface === iface;
  const carry = sameIface && state.cycleStart === start;
  let rxTotal = carry ? state.rxBytes ?? 0 : 0;
  let txTotal = carry ? state.txBytes ?? 0 : 0;
  const { rxCursor, txCursor } = state;
  if (sameIface && Number.isInteger(rxCursor) && Number.isInteger(txCursor)) {
    rxTotal += rx >= rxCursor! ? rx - rxCursor! : rx;
    txTotal += tx >= txCursor! ? tx - txCursor! : tx;
  } else if (Object.keys(state).length === 0 && bootMs != null && bootMs >= start) {
    // 只在没有旧状态且开机在本周期内时接管计数器；换网卡时接管会把旧卡用量重复计入。
    rxTotal = rx;
    txTotal = tx;
  }
  return {
    version: TRAFFIC_STATE_VERSION,
    interface: iface,
    cycleStart: start,
    cycleEnd: end,
    rxBytes: rxTotal,
    txBytes: txTotal,
    rxCursor: rx,
    txCursor: tx,
    updatedAt: nowMs,
  };
}

const store: { state: Partial<TrafficState>; loaded: boolean; durable: boolean } = { state: {}, loaded: false, durable: false };

async function loadState(): Promise<void> {
  store.loaded = true;
  const path = config.trafficStatePath;
  if (!path) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") failure("traffic-state", `读不出 ${path}，这个周期从零开始数：${String(error)}`);
    return;
  }
  if (!parsed || typeof parsed !== "object" || (parsed as TrafficState).version !== TRAFFIC_STATE_VERSION) {
    failure("traffic-state", `${path} 不是这一版的状态，丢掉重新数`);
    return;
  }
  store.state = parsed as TrafficState;
  store.durable = true;
}

async function saveState(state: TrafficState): Promise<boolean> {
  const path = config.trafficStatePath;
  if (!path) return false;
  const temp = `${path}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true });
    const handle = await open(temp, "w");
    try {
      await handle.writeFile(JSON.stringify(state));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
    recovered("traffic-state");
    return true;
  } catch (error) {
    failure("traffic-state", `写不进 ${path}，这一份不报流量：${String(error)}`);
    return false;
  }
}

export async function traffic(
  iface: string,
  rx: number,
  tx: number,
  nowMs: number,
  bootMs: number,
): Promise<TrafficReport | null> {
  if (!store.loaded) await loadState();
  const state = accumulate(store.state, iface, rx, tx, nowMs, config.cycleDay, bootMs);
  store.state = state;
  if (await saveState(state)) store.durable = true;
  if (!store.durable) return null;
  return {
    cycleStart: state.cycleStart,
    cycleEnd: state.cycleEnd,
    rxBytes: state.rxBytes,
    txBytes: state.txBytes,
    quotaBytes: config.quotaBytes,
  };
}
