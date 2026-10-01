import { requestState } from "@shared/request-state";
import { candidateFrom, type TrackEnrichment } from "@/lib/track-enrichment";
import {
  type StoredHomePod
} from "@/lib/homepod-store";
import { type NowListeningSnapshot } from "@/lib/now-listening";
import {
  type PlayingQueueTrack
} from "@/lib/playing-queue";
import { IMAGE_OBJECT_KEY, publicAssetPath } from "@/lib/asset-url";
import { fieldMirror } from "@/lib/storage";
import { withPresence, type Liveness } from "@/lib/reporter-liveness";
import type {
  DesktopActivity,
  DesktopPayload,
  LocalNowPlaying,
  TimezoneActivity
} from "@/lib/types";

export const DESKTOP_ICON_CACHE_LIMIT = 64;

export type StoredDesktopActivity = Omit<DesktopActivity, "iconUrl"> & {
  iconObjectKey: string | null;
};

export type TelemetryState = {
  desktop: StoredDesktopActivity | null;
  desktopIconAssets: Map<string, string>;
  timezone: TimezoneActivity | null;
  music: LocalNowPlaying | null;
  musicEnrichment: TrackEnrichment | null;
  upcomingTracks: PlayingQueueTrack[];
  activityReceivedAt: number;
  timezoneReceivedAt: number;
  activeModules: Set<string>;
};

function state(): TelemetryState {
  return requestState("telemetry", () => ({ desktop: null, desktopIconAssets: new Map(), timezone: null,
    music: null, musicEnrichment: null, upcomingTracks: [], activityReceivedAt: 0, timezoneReceivedAt: 0, activeModules: new Set<string>() }));
}
export const telemetryState = new Proxy({} as TelemetryState, {
  get(_target, property) { return Reflect.get(state(), property); },
  set(_target, property, value) { return Reflect.set(state(), property, value); },
});

export type PersistedTelemetry = {
  desktop: StoredDesktopActivity | null;
  desktopIconAssets?: [string, string][];
  timezone: TimezoneActivity | null;
  music: LocalNowPlaying | null;
  musicEnrichment?: TrackEnrichment | null;
  upcomingTracks?: PlayingQueueTrack[];
  activityReceivedAt: number;
  timezoneReceivedAt: number;
  telemetryReceivedAt: number;
  activeModules: string[];
};

export const mirror = fieldMirror<PersistedTelemetry>(
  ["telemetry", "fields"],
  (state) => state.telemetryReceivedAt,
);

export async function syncTelemetryState() {
  const stored = await mirror.get();
  if (!stored) {
    telemetryState.desktop = null;
    telemetryState.desktopIconAssets = new Map();
    telemetryState.timezone = null;
    telemetryState.music = null;
    telemetryState.musicEnrichment = null;
    telemetryState.upcomingTracks = [];
    telemetryState.activityReceivedAt = 0;
    telemetryState.timezoneReceivedAt = 0;
    telemetryState.activeModules = new Set();
    return;
  }
  telemetryState.desktop = stored.desktop ?? null;
  telemetryState.desktopIconAssets = new Map(
    (stored.desktopIconAssets ?? [])
      .filter((entry): entry is [string, string] =>
        Array.isArray(entry) &&
        typeof entry[0] === "string" &&
        typeof entry[1] === "string" &&
        IMAGE_OBJECT_KEY.test(entry[1]),
      )
      .slice(-DESKTOP_ICON_CACHE_LIMIT),
  );
  telemetryState.timezone = stored.timezone ?? null;
  telemetryState.music = stored.music ?? null;
  telemetryState.musicEnrichment = stored.musicEnrichment ?? null;
  telemetryState.upcomingTracks = stored.upcomingTracks ?? [];
  telemetryState.activityReceivedAt = stored.activityReceivedAt ?? 0;
  telemetryState.timezoneReceivedAt = stored.timezoneReceivedAt ?? 0;
  telemetryState.activeModules = new Set(stored.activeModules ?? []);
}

// 关闭模块后仍保留最后快照，必须按 activeModules 过滤，避免旧活动继续生效。
export function activeDesktop(): StoredDesktopActivity | null {
  return telemetryState.activeModules.has("desktop") ? telemetryState.desktop : null;
}

// 上报提交期间不能再次同步：持久层旧值会覆盖尚未落库的工作副本。
export function desktopPayload(liveness: Liveness): DesktopPayload {
  const stored = activeDesktop();
  const desktop: DesktopActivity | null = stored
    ? {
      applicationName: stored.applicationName,
      bundleIdentifier: stored.bundleIdentifier,
      windowTitle: stored.windowTitle ?? null,
      iconUrl: stored.iconObjectKey ? publicAssetPath(stored.iconObjectKey) : null,
      observedAt: stored.observedAt,
    }
    : null;
  return withPresence(
    {
      desktop,
      receivedAt: telemetryState.activityReceivedAt || liveness.lastSeenAt || null,
    },
    liveness,
  );
}

function macSnapshotInput(mac?: {
  music: LocalNowPlaying | null;
  receivedAt: number;
  enrichment?: TrackEnrichment | null;
}) {
  return (
    mac ?? {
      music: telemetryState.music,
      receivedAt: telemetryState.activityReceivedAt,
      enrichment: telemetryState.musicEnrichment,
    }
  );
}

export function snapshotFrom(
  homePodStored: StoredHomePod | null,
  mac?: {
    music: LocalNowPlaying | null;
    receivedAt: number;
    enrichment?: TrackEnrichment | null;
  },
  activeModules: ReadonlySet<string> | readonly string[] = telemetryState.activeModules,
): NowListeningSnapshot {
  const source = macSnapshotInput(mac);
  const musicEnabled = new Set(activeModules).has("appleMusic");
  const macCandidate = musicEnabled ? candidateFrom(source.music, source.receivedAt, source.enrichment) : null;
  const homePod = homePodStored ? candidateFrom(homePodStored.music, homePodStored.receivedAt, homePodStored.enrichment) : null;
  return {
    mac: macCandidate,
    homePod,
    macReceivedAt: source.receivedAt,
  };
}

