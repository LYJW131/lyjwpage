import {
  getHomePodSnapshot
} from "@/lib/homepod-store";
import { pickNowListening, type NowListeningSnapshot } from "@/lib/now-listening";
import { readLiveness, type Liveness } from "@/lib/reporter-liveness";
import { LagResult } from "@/lib/lag-result";
import { readLagEntry } from "@/lib/lag-store";
import type {
  DesktopPayload,
  NowListeningPayload,
  TimezoneActivity,
  TimezonePayload
} from "@/lib/types";
import { LAG_KEYS } from "@shared/lag";
import { desktopPayload, snapshotFrom, syncTelemetryState } from "@shared/telemetry";

/**
 * 取数路径上先把状态和存活各读一次。
 *
 * 存活是另一个 SQLite key，两者都要，所以一起读 —— 各自 await 一次的话同一个
 * 请求里会多一趟往返。「上报器整体是否已超过心跳窗口」只影响 Mac 来的东西，
 * HomePod 走自己的路径。
 */
async function syncForRead(): Promise<Liveness> {
  const [, liveness] = await Promise.all([syncTelemetryState(), readLiveness()]);
  return liveness;
}

export async function getDesktopPayload(): Promise<DesktopPayload> {
  return desktopPayload(await syncForRead());
}

/**
 * Mac 此刻所在的时区，由上报入口写进可滞后层（模块关掉时写成 null）。
 * `snapshotAt` 是这次读取的时刻：首屏 HTML 冻住的是生成那一刻，时间卡首帧拿它画钟。
 */
export async function getTimezonePayload(): Promise<TimezonePayload | LagResult<TimezonePayload>> {
  const entry = await readLagEntry<{ timezone: TimezoneActivity | null }>(LAG_KEYS.timezone);
  const payload = { timezone: entry?.data.timezone ?? null, snapshotAt: Date.now() };
  return entry ? new LagResult(payload, entry.updatedAt) : payload;
}

export async function getNowListeningSnapshot(): Promise<NowListeningSnapshot> {
  await syncTelemetryState();
  return snapshotFrom(await getHomePodSnapshot());
}

export async function getNowListening(): Promise<NowListeningPayload> {
  const [snapshot, liveness] = await Promise.all([
    getNowListeningSnapshot(),
    readLiveness(),
  ]);
  return pickNowListening(snapshot, liveness);
}
