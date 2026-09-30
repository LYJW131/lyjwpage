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

async function syncForRead(): Promise<Liveness> {
  const [, liveness] = await Promise.all([syncTelemetryState(), readLiveness()]);
  return liveness;
}

export async function getDesktopPayload(): Promise<DesktopPayload> {
  return desktopPayload(await syncForRead());
}

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
