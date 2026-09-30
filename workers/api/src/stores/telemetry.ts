import { recordCodingObservation } from "@api/stores/coding-pulse";
import { isCodingApp } from "@shared/coding-apps";
import { listeningObservation } from "@shared/pulse-listening";
import { chargerPushPayload } from "@/lib/anker";
import { readChargerState } from "@/lib/charger-store";
import { askSettlingAt, settlingDecision } from "@/lib/charging-settling";
import {
  getHomePodSnapshot,
  playableHomePod,
  type StoredHomePod,
} from "@/lib/homepod-store";
import { chargerActive, liveTrack, powerBankActive } from "@/lib/home-layout";
import { CHARGER_TAG, DESKTOP_TAG, NOW_LISTENING_TAG, POWERBANK_TAG } from "@/lib/live-events";
import type { PlayingQueueTrack } from "@/lib/playing-queue";
import { powerBankPushPayload } from "@/lib/powerbank";
import { readPowerBankState } from "@/lib/powerbank-store";
import { nextLiveness, readLiveness, type Liveness } from "@/lib/reporter-liveness";
import type {
  ChargerStatus,
  LocalNowPlaying,
  TimezoneActivity,
} from "@/lib/types";
import { fanout, type PendingEvent } from "@api/fanout";
import type { ListeningEffect } from "@api/ingest-effects";
import { recordChargingSample, recordStateObservation } from "@api/stores/pulse";
import { prepareHeartbeat, prepareStatus } from "@api/stores/charger-store";
import { writeSettlingAt } from "@api/stores/charging-settling";
import { prepareStatus as preparePowerBankStatus } from "@api/stores/powerbank-store";
import { writeLiveness } from "@api/stores/reporter-liveness";
import { prepareCodingActivity, readCodingActivities } from "@api/stores/coding-activity";
import { prepareCodingBuckets } from "@api/stores/coding-buckets";
import { prepareCodingUsage } from "@api/stores/coding-usage";
import type { PreparedTelemetryEnvelope } from "@shared/ingest/telemetry";
import type { StoredCodingActivity } from "@shared/coding-store";
import { isVisibleCodingModel } from "@shared/coding-models";
import { CODING_ACTIVE_MS, CODING_ACTIVITY_STALE_MS } from "@shared/coding-usage";
import { activeDesktop, DESKTOP_ICON_CACHE_LIMIT, desktopPayload, mirror, type PersistedTelemetry, type StoredDesktopActivity, syncTelemetryState, telemetryState } from "@shared/telemetry";

type TelemetryPatch = {
  desktop?: StoredDesktopActivity | null;
  desktopIconAssets?: [string, string][];
  timezone?: TimezoneActivity | null;
  music?: LocalNowPlaying | null;
  upcomingTracks?: PlayingQueueTrack[];
};

async function persistTelemetryState(
  receivedAt: number,
  patch: TelemetryPatch,
  activeModules: string[],
) {
  const incoming: PersistedTelemetry = {
    desktop: "desktop" in patch ? (patch.desktop ?? null) : telemetryState.desktop,
    desktopIconAssets:
      patch.desktopIconAssets ?? [...telemetryState.desktopIconAssets],
    timezone: "timezone" in patch ? (patch.timezone ?? null) : telemetryState.timezone,
    music: "music" in patch ? (patch.music ?? null) : telemetryState.music,
    upcomingTracks:
      "upcomingTracks" in patch ? (patch.upcomingTracks ?? []) : telemetryState.upcomingTracks,
    activityReceivedAt:
      "desktop" in patch || "music" in patch
        ? receivedAt
        : telemetryState.activityReceivedAt,
    timezoneReceivedAt: "timezone" in patch ? receivedAt : telemetryState.timezoneReceivedAt,
    telemetryReceivedAt: receivedAt,
    activeModules,
  };

  const fields: (keyof PersistedTelemetry & string)[] = ["telemetryReceivedAt", "activeModules"];
  if ("desktop" in patch) fields.push("desktop", "desktopIconAssets", "activityReceivedAt");
  else if ("desktopIconAssets" in patch) fields.push("desktopIconAssets");
  if ("timezone" in patch) fields.push("timezone", "timezoneReceivedAt");
  if ("music" in patch) fields.push("music", "upcomingTracks", "activityReceivedAt");

  await mirror.merge(incoming, fields);
}

function rememberDesktopIcon(hash: string, objectKey: string) {
  telemetryState.desktopIconAssets.delete(hash);
  telemetryState.desktopIconAssets.set(hash, objectKey);
  if (telemetryState.desktopIconAssets.size > DESKTOP_ICON_CACHE_LIMIT) {
    const oldest = telemetryState.desktopIconAssets.keys().next().value;
    if (oldest !== undefined) telemetryState.desktopIconAssets.delete(oldest);
  }
}

export async function commitPreparedTelemetryEnvelope(command: PreparedTelemetryEnvelope) {
  const { receivedAt, presence, activeModules: nextActiveModules, modules } = command;

  // 差分必须读取提交前状态；所有基线读取须早于本封的任何写入。
  const hasChargingDevices = "chargingDevices" in modules;
  const wantsCharger = hasChargingDevices || nextActiveModules.includes("charger");
  const charger = wantsCharger ? readChargerState() : null;
  const settling = hasChargingDevices
    ? { charger: askSettlingAt("charger"), powerbank: askSettlingAt("powerbank") }
    : null;
  const powerBank = hasChargingDevices ? readPowerBankState() : null;
  const homePod = getHomePodSnapshot();
  const storedCodingActivity = modules.codingActivity
    ? null
    : readCodingActivities().then((activities) => activities.mac ?? null, () => null);
  const [, previousLiveness] = await Promise.all([syncTelemetryState(), readLiveness()]);

  // syncTelemetryState 会覆盖工作副本，activeModules 必须在同步后设置。
  telemetryState.activeModules = new Set(nextActiveModules);
  const { next: liveness, flipped: presenceFlipped } = nextLiveness(previousLiveness, {
    offline: presence === "offline",
    at: receivedAt,
  });

  const writes: Promise<unknown>[] = [];
  const events: PendingEvent[] = [];
  const notify: PendingEvent[] = [];
  const listening: ListeningEffect[] = [];
  const tags: string[] = [];
  // 这些效果依赖 telemetry 字段落库；较晚模块失败时不能推送未持久化状态。
  const telemetryEvents: PendingEvent[] = [];
  const telemetryListening: ListeningEffect[] = [];
  const telemetryTags: string[] = [];

  let accepted = 0;
  let desktopIconAvailable: boolean | undefined;
  let chargerCoverIconAvailable: boolean | undefined;
  const patch: TelemetryPatch = {};

  // 模块失败不代表上报器离线，存活写入必须独立于模块处理。
  writes.push(writeLiveness(liveness));

  if (presenceFlipped) {
    notify.push({ type: "presence", payload: null });
    tags.push(DESKTOP_TAG);
    tags.push(NOW_LISTENING_TAG, CHARGER_TAG);
  }

  // finally 必须等待已启动的写入，后续模块抛错不能让此前接受的数据失去落库确认。
  try {
    if (command.failure?.stage === "beforeCharging") {
      throw new Error(command.failure.message);
    }
    let chargerWritten = false;
    if ("chargingDevices" in modules) {
      const device = modules.chargingDevices?.charger ?? null;
      if (device) {
        let status = device;
        if (status.cover?.iconHash && status.cover.iconObjectKey) {
          rememberDesktopIcon(status.cover.iconHash, status.cover.iconObjectKey);
        }
        if (status.cover?.iconHash) {
          const storedKey = telemetryState.desktopIconAssets.get(status.cover.iconHash) ?? null;
          if (storedKey) rememberDesktopIcon(status.cover.iconHash, storedKey);
          status = {
            ...status,
            cover: { ...status.cover, iconObjectKey: storedKey },
          };
        }
        chargerCoverIconAvailable =
          status.cover?.iconHash == null || status.cover.iconObjectKey != null;
        if (status.cover?.iconHash) {
          patch.desktopIconAssets = [...telemetryState.desktopIconAssets];
        }
        const chargerState = await (charger ?? readChargerState());
        const landing = prepareStatus(status, receivedAt, chargerState);
        writes.push(landing.commit());
        writes.push(recordChargingPulse(receivedAt, status));
        chargerWritten = true;
        const window = settlingDecision(
          landing.structuralChanged,
          receivedAt,
          await (settling?.charger ?? askSettlingAt("charger")),
        );
        if (window.restart) writes.push(writeSettlingAt("charger", receivedAt));
        if (window.publish) {
          events.push({
            type: "charger",
            payload: chargerPushPayload({
              status,
              receivedAt,
              historyCount: landing.historyCount,
              liveness,
            }),
          });
        }
        if (chargerActive(chargerState.previous?.status) !== chargerActive(status)) tags.push(CHARGER_TAG);
      }

      if (modules.chargingDevices?.failureAfterCharger) {
        throw new Error(modules.chargingDevices.failureAfterCharger);
      }

      const bank = modules.chargingDevices?.powerBank ?? null;
      if (bank) {
        const status = bank;
        const previousBank = await (powerBank ?? readPowerBankState());
        const landing = preparePowerBankStatus(status, receivedAt, previousBank);
        writes.push(landing.commit());
        const window = settlingDecision(
          landing.structuralChanged,
          receivedAt,
          await (settling?.powerbank ?? askSettlingAt("powerbank")),
        );
        if (window.restart) writes.push(writeSettlingAt("powerbank", receivedAt));
        if (window.publish) {
          events.push({
            type: "powerbank",
            payload: powerBankPushPayload({ status, receivedAt, liveness }),
          });
        }
        if (powerBankActive(previousBank?.status) !== powerBankActive(status)) tags.push(POWERBANK_TAG);
      }
      accepted += 1;
    }
    if (!chargerWritten && charger && nextActiveModules.includes("charger")) {
      const state = await charger;
      writes.push(prepareHeartbeat(receivedAt, state).commit());
      if (state.previous) writes.push(recordChargingPulse(receivedAt, state.previous.status));
    }

    if (command.failure?.stage === "beforeDesktop") {
      throw new Error(command.failure.message);
    }

    if ("desktop" in modules) {
      const normalized = modules.desktop!;
      if (normalized.iconObjectKey && normalized.iconHash) {
        rememberDesktopIcon(normalized.iconHash, normalized.iconObjectKey);
      }
      const storedIconObjectKey = normalized.iconHash
        ? (telemetryState.desktopIconAssets.get(normalized.iconHash) ?? null)
        : null;
      if (normalized.iconHash && storedIconObjectKey) {
        rememberDesktopIcon(normalized.iconHash, storedIconObjectKey);
      }
      const activity = normalized.activity
        ? { ...normalized.activity, iconObjectKey: storedIconObjectKey }
        : null;
      desktopIconAvailable = normalized.iconHash == null || storedIconObjectKey != null;
      telemetryState.desktop = activity;
      telemetryState.activityReceivedAt = receivedAt;
      patch.desktop = activity;
      patch.desktopIconAssets = [...telemetryState.desktopIconAssets];
      accepted += 1;
      telemetryEvents.push({ type: "desktop", payload: desktopPayload(liveness) });
    }

    if (command.failure?.stage === "beforeTimezone") {
      throw new Error(command.failure.message);
    }

    if ("timezone" in modules) {
      accepted += 1;
    }

    if (command.failure?.stage === "beforeAppleMusic") {
      throw new Error(command.failure.message);
    }

    if ("appleMusic" in modules) {
      const { music, upcomingTracks } = modules.appleMusic!;
      const wasLive = liveTrack(telemetryState.music) != null;
      telemetryState.music = music;
      telemetryState.upcomingTracks = upcomingTracks;
      telemetryState.activityReceivedAt = receivedAt;
      patch.music = music;
      patch.upcomingTracks = upcomingTracks;
      accepted += 1;
      // 后台目录查询只能使用本次提交快照，重读当前曲目可能串到下一封上报。
      telemetryListening.push(
        listeningEffect(liveness, playableHomePod(await homePod), {
          music,
          receivedAt,
          upcomingTracks,
        }),
      );
      if (wasLive !== (liveTrack(music) != null)) telemetryTags.push(NOW_LISTENING_TAG);
    }

    if (command.failure?.stage === "beforeAppleMusicCredentials") {
      throw new Error(command.failure.message);
    }

    if ("appleMusicCredentials" in modules) {
      accepted += 1;
    }

    if (modules.codingUsage) {
      const landing = await prepareCodingUsage("mac", modules.codingUsage, receivedAt);
      writes.push(landing.commit());
      tags.push(...landing.tags);
      accepted += 1;
    }

    let codingActivity: StoredCodingActivity | null = null;
    if (modules.codingActivity) {
      const landing = await prepareCodingActivity("mac", modules.codingActivity, receivedAt, liveness);
      if (landing.accepted) writes.push(landing.commit());
      codingActivity = landing.accepted ? { ...modules.codingActivity, receivedAt } : landing.previous;
      if (landing.event) events.push(landing.event);
      accepted += 1;
    }

    if (modules.codingTokenBuckets) {
      const landing = await prepareCodingBuckets("mac", modules.codingTokenBuckets, receivedAt);
      if (landing.accepted) writes.push(landing.commit());
      accepted += 1;
    }

    // 模块缺席表示未变化；纯心跳也须续观测，否则稳定播放或 coding 会出现假断流。
    writes.push(recordListeningPulse(receivedAt, liveness, homePod));
    writes.push(recordCodingPulse(receivedAt, codingActivity ?? storedCodingActivity, presence === "online"));

    // 仅 patch 本封字段；整包 SET 会让并发心跳把新曲目覆盖成旧快照。
    writes.push(persistTelemetryState(receivedAt, patch, nextActiveModules));
    events.push(...telemetryEvents);
    listening.push(...telemetryListening);
    tags.push(...telemetryTags);
  } finally {
    await fanout({ writes, events, notify, listening, tags });
  }

  return { accepted, heartbeat: true, desktopIconAvailable, chargerCoverIconAvailable };
}

function listeningEffect(
  liveness: Liveness,
  homePod: StoredHomePod | null,
  mac?: {
    music: LocalNowPlaying | null;
    receivedAt: number;
    upcomingTracks?: PlayingQueueTrack[];
  },
): ListeningEffect {
  const source = mac ?? {
    music: telemetryState.music,
    receivedAt: telemetryState.activityReceivedAt,
    upcomingTracks: telemetryState.upcomingTracks,
  };
  return {
    kind: "listening",
    liveness,
    activeModules: [...telemetryState.activeModules],
    homePod,
    mac: {
      music: source.music,
      receivedAt: source.receivedAt,
      upcomingTracks: source.upcomingTracks ?? [],
    },
  };
}

async function recordListeningPulse(
  receivedAt: number,
  liveness: Liveness,
  homePod: Promise<StoredHomePod | null>,
): Promise<void> {
  try {
    const observed = listeningObservation({
      mac: telemetryState.music,
      macObserved: telemetryState.activeModules.has("appleMusic"),
      homePod: await homePod,
    }, liveness, receivedAt);
    await recordStateObservation("listening", receivedAt, observed?.facts ?? null, observed?.hold);
  } catch (error) {
    console.error("[pulse]", error instanceof Error ? error.message : String(error));
  }
}

async function recordCodingPulse(
  receivedAt: number,
  activity: StoredCodingActivity | null | Promise<StoredCodingActivity | null>,
  online: boolean,
): Promise<void> {
  try {
    // Mac 心跳不能担保 coding 采集器存活，模块开启与采集时刻必须独立验证。
    const report = await activity;
    const usable = report !== null && telemetryState.activeModules.has("coding")
      && receivedAt - report.collectedAt <= CODING_ACTIVITY_STALE_MS;
    const agents = usable
      ? report.agents.map((agent) => ({
        id: agent.id,
        model: isVisibleCodingModel(agent.model) ? agent.model.slice(0, 80) : null,
        active: agent.lastActivityAt != null && agent.lastActivityAt <= receivedAt + 60_000 && receivedAt - agent.lastActivityAt <= CODING_ACTIVE_MS,
      }))
      : null;
    const desktop = activeDesktop();
    await recordCodingObservation({
      t: receivedAt,
      available: online && (desktop !== null || agents !== null),
      desktop: desktop ? { application: desktop.applicationName.slice(0, 80), coding: isCodingApp(desktop.bundleIdentifier, desktop.applicationName) } : null,
      agents,
    });
  } catch (error) {
    console.error("[pulse]", error instanceof Error ? error.message : String(error));
  }
}

async function recordChargingPulse(receivedAt: number, status: ChargerStatus): Promise<void> {
  const device = status.cover?.name ?? status.ports.find((port) => port.active)?.device ?? null;
  await recordChargingSample(receivedAt, status.connected ? status.totalPower : 0, device);
}

export function homePodListening(stored: StoredHomePod): {
  effect: Promise<ListeningEffect>;
  pulse: Promise<void>;
} {
  const ready = Promise.all([syncTelemetryState(), readLiveness()]);
  return {
    effect: ready.then(([, liveness]) =>
      listeningEffect(liveness, playableHomePod(stored)),
    ),
    pulse: ready.then(
      ([, liveness]) =>
        recordListeningPulse(
          stored.receivedAt,
          liveness,
          Promise.resolve(stored),
        ),
      (error) => {
        console.error("[pulse]", error instanceof Error ? error.message : String(error));
      },
    ),
  };
}
