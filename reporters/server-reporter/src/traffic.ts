/**
 * 计费周期的流量累计，和最近 12 小时的 CPU 窗口，存在同一个状态文件里。
 *
 * `/proc/net/dev` 的计数器只从开机算起，一重启就归零，「这个计费周期用了多少」
 * 得自己攒。每轮把两次读数之差累加进当前周期，连同游标原子写回状态文件：进程
 * 重启、机器重启都接着上次数下去，不从头再来。
 *
 * 计数器归零的判据是「这次比游标小」—— 重启后网卡从 0 开始，那一段就是当前读数
 * 本身。而从没攒过的那一轮只记游标、不计流量：一台开机 200 天的机器第一次跑起
 * 来，计数器里那几个 T 是过去几个月的，不该一股脑算进这个周期。
 *
 * 那一轮有个例外：开机时刻**落在这个周期之内**时，计数器里的每一个字节都是这个
 * 周期走的，整份接管过来就是准的。
 *
 * 周期是 UTC 的自然月，起始日由 `TRAFFIC_CYCLE_DAY` 定（跟着套餐的账单日）。跨周期
 * 那一轮的增量整段算进新周期 —— 边界上最多差一个上报间隔。
 *
 * 攒得住才报：状态文件一次都没写成功过就报 null，卡片上少一块，好过默默显示一个
 * 只从本次进程算起的小数。文件格式和从前 Python 版一致，换实现不丢这个周期的累计。
 */
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname } from "node:path";

import { config } from "./config.js";
import { failure, recovered } from "./log.js";

export const TRAFFIC_STATE_VERSION = 1;
/** 12 小时 CPU 窗口，和站点卡片里 Vercel / Workers 的窗口同长 */
export const WINDOW_MS = 12 * 3_600_000;

/** [时刻, 这份占用覆盖的时长, CPU%] */
export type WindowSample = [number, number, number];

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
  window?: WindowSample[];
};

export type TrafficReport = {
  cycleStart: number;
  cycleEnd: number;
  rxBytes: number;
  txBytes: number;
  quotaBytes: number | null;
};

export type WindowReport = { start: number; end: number; cpuAvgPercent: number | null };

/** 同一个「几号」往前后挪几个月。日 ≤ 28，落在哪个月都存在 */
export function shiftMonth(moment: Date, months: number): Date {
  const index = moment.getUTCFullYear() * 12 + moment.getUTCMonth() + months;
  return new Date(Date.UTC(Math.floor(index / 12), index % 12, moment.getUTCDate(),
    moment.getUTCHours(), moment.getUTCMinutes(), moment.getUTCSeconds()));
}

/** 当前计费周期的 [起, 止)，epoch 毫秒。止就是下一周期的起 */
export function cycleBounds(nowMs: number, day: number): [number, number] {
  const now = new Date(nowMs);
  const anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day));
  const start = nowMs >= anchor.getTime() ? anchor : shiftMonth(anchor, -1);
  return [start.getTime(), shiftMonth(start, 1).getTime()];
}

/** 把这一轮的增量并进周期累计，返回新状态（不带 window）。纯函数 */
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
  // 换网卡：新计数器和上一块无关，累计和游标一起作废，从这一轮重新数
  const carry = sameIface && state.cycleStart === start;
  let rxTotal = carry ? state.rxBytes ?? 0 : 0;
  let txTotal = carry ? state.txBytes ?? 0 : 0;
  const { rxCursor, txCursor } = state;
  if (sameIface && Number.isInteger(rxCursor) && Number.isInteger(txCursor)) {
    rxTotal += rx >= rxCursor! ? rx - rxCursor! : rx;
    txTotal += tx >= txCursor! ? tx - txCursor! : tx;
  } else if (Object.keys(state).length === 0 && bootMs != null && bootMs >= start) {
    // 头一回攒，而这台机器是这个周期之内开的：计数器里的字节全是这个周期的，整份接管。
    // 只认「一份状态都没有」—— 换网卡时旧卡那段已经数过了，再接管一次就是重复计数
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

/** 追加这一轮、丢掉窗口外的。纯函数 */
export function recordWindow(samples: unknown, nowMs: number, dtMs: number, cpuPct: number): WindowSample[] {
  const kept = (Array.isArray(samples) ? samples : []).filter(
    (s): s is WindowSample => Array.isArray(s) && s.length === 3 && s.every(Number.isFinite) && s[0] > nowMs - WINDOW_MS,
  );
  return [...kept, [nowMs, dtMs, Math.round(cpuPct * 10) / 10]];
}

/** 窗口内按时长加权的平均 CPU。起点取最早那一段的开头，但不早于 12 小时前。纯函数 */
export function summarizeWindow(samples: WindowSample[], nowMs: number): WindowReport | null {
  const kept = samples.filter((s) => s[0] > nowMs - WINDOW_MS);
  if (!kept.length) return null;
  const totalDt = kept.reduce((sum, s) => sum + s[1], 0);
  return {
    start: Math.max(nowMs - WINDOW_MS, Math.min(...kept.map((s) => s[0] - s[1]))),
    end: nowMs,
    cpuAvgPercent: totalDt > 0 ? Math.round((kept.reduce((sum, s) => sum + s[2] * s[1], 0) / totalDt) * 10) / 10 : null,
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
    // 第一次跑还没有这个文件，等这一轮写出来；读坏了这个周期从零数
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") failure("traffic-state", `读不出 ${path}，这个周期从零开始数：${String(error)}`);
    return;
  }
  if (!parsed || typeof parsed !== "object" || (parsed as TrafficState).version !== TRAFFIC_STATE_VERSION) {
    failure("traffic-state", `${path} 不是这一版的状态，丢掉重新数`);
    return;
  }
  store.state = parsed as TrafficState;
  // 读得出上次那份就说明这条路是通的，攒的数能接着用
  store.durable = true;
}

/** 原子写回：先落临时文件、fsync，再 rename，断电不会留下半截 JSON */
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

/** 周期累计和 12 小时窗口一起算、一起落盘；攒不住时两份都报 null */
export async function trafficAndWindow(
  iface: string,
  rx: number,
  tx: number,
  nowMs: number,
  bootMs: number,
  cpuPct: number,
  elapsedMs: number,
): Promise<{ traffic: TrafficReport | null; window: WindowReport | null }> {
  if (!store.loaded) await loadState();
  const previous = store.state;
  const state: TrafficState = {
    ...accumulate(previous, iface, rx, tx, nowMs, config.cycleDay, bootMs),
    window: recordWindow(previous.window, nowMs, Math.round(elapsedMs), cpuPct),
  };
  store.state = state;
  if (await saveState(state)) store.durable = true;
  if (!store.durable) return { traffic: null, window: null };
  return {
    traffic: {
      cycleStart: state.cycleStart,
      cycleEnd: state.cycleEnd,
      rxBytes: state.rxBytes,
      txBytes: state.txBytes,
      quotaBytes: config.quotaBytes,
    },
    window: summarizeWindow(state.window ?? [], nowMs),
  };
}
