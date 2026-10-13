import {
  getHomePodSnapshot
} from "@shared/homepod-store";
import { pickNowListening, type NowListeningSnapshot } from "@shared/now-listening";
import { readLiveness, type Liveness } from "@shared/reporter-liveness";
import type {
  DesktopPayload,
  NowListeningPayload
} from "@shared/types";
import { pulseListeningTracesKey } from "./pulse-keys";
import { getStorage } from "@shared/storage";
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

const ELSEWHERE_TRACES = Math.max(40, 2 * NEXT_LOOP_MAX);

export async function readRecentListeningTraces(): Promise<ListeningTrace[]> {
  const rows: unknown[] = await getStorage().listRange(pulseListeningTracesKey(), -ELSEWHERE_TRACES, -1);
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
