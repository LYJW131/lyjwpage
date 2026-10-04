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
import { pulseListeningTracesKey } from "@/lib/pulse-keys";
import { withStorage } from "@/lib/storage";
import { LAG_KEYS } from "@shared/lag";
import { playingContainer } from "@shared/apple-music-store";
import { NEXT_LOOP_MAX, parseListeningTrace, type ListeningTrace } from "@shared/pulse-listening";
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

const ELSEWHERE_TRACES = Math.max(40, 2 * NEXT_LOOP_MAX);

export async function readRecentListeningTraces(): Promise<ListeningTrace[]> {
  const rows: unknown[] = await withStorage((storage) => storage.listRange(pulseListeningTracesKey(), -ELSEWHERE_TRACES, -1), []);
  return rows.flatMap((raw) => {
    const trace = typeof raw === "string" ? parseListeningTrace(raw) : null;
    return trace ? [trace] : [];
  });
}

export async function getNowListeningSnapshot(): Promise<NowListeningSnapshot> {
  const [, homePod, traces, playing] = await Promise.all([
    syncTelemetryState(),
    getHomePodSnapshot(),
    readRecentListeningTraces(),
    playingContainer.get(),
  ]);
  return { ...snapshotFrom(homePod), traces, container: playing?.container ?? null };
}

export async function getNowListening(): Promise<NowListeningPayload> {
  const [snapshot, liveness] = await Promise.all([
    getNowListeningSnapshot(),
    readLiveness(),
  ]);
  return pickNowListening(snapshot, liveness);
}
