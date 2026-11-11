import type { PlayerDevice, StoredPlayer } from "@shared/player-store";
import type { LocalNowPlaying } from "@shared/types";

import type { OtlpLogRecord, OtlpValue } from "./otlp-logs";

// 播放器（Ringo 的 internal/telemetry/plays.go）每次开始、暂停或结束、跳转各发一条 OTLP 日志事件。
export const PLAYER_EVENT_NAMES: ReadonlySet<string> = new Set(["ringo.play.start", "ringo.play.end", "ringo.play.seek"]);

export type PlayerEvent = {
  timeUnixNano: string;
  event: string;
  trackId: string;
  occurredAt: number;
  trackName: string | null;
  artistName: string | null;
  albumName: string | null;
  durationMs: number | null;
  positionMs: number | null;
  heardMs: number | null;
  serviceName: string | null;
  serviceVersion: string | null;
  attributes: Record<string, OtlpValue>;
};

export type PreparedPlayerEvents = {
  source: "player";
  device: PlayerDevice;
  stored: StoredPlayer;
  events: PlayerEvent[];
};

function str(value: OtlpValue | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function int(value: OtlpValue | undefined): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value))) return Number(value);
  return null;
}

export function playerEvent(record: OtlpLogRecord): PlayerEvent | null {
  if (!PLAYER_EVENT_NAMES.has(record.eventName)) return null;
  const trackId = str(record.attributes["music.track.id"]);
  const timeUnixNano = record.timeUnixNano !== "0" ? record.timeUnixNano : record.observedTimeUnixNano;
  if (!trackId || timeUnixNano === "0") return null;
  return {
    timeUnixNano,
    event: record.eventName,
    trackId,
    occurredAt: Number(BigInt(timeUnixNano) / 1_000_000n),
    trackName: str(record.attributes["music.track.name"]),
    artistName: str(record.attributes["music.artist.name"]),
    albumName: str(record.attributes["music.album.name"]),
    durationMs: int(record.attributes["music.track.duration_ms"]),
    positionMs: int(record.attributes["music.position_ms"]),
    heardMs: int(record.attributes["music.play.heard_ms"]),
    serviceName: str(record.resource["service.name"]),
    serviceVersion: str(record.resource["service.version"]),
    attributes: record.attributes,
  };
}

// 暂停之外的结束（放完、切歌、退出）都算停下：切歌时下一首的开始紧跟着来，通常在同一批里。
function stateOf(event: PlayerEvent): LocalNowPlaying["state"] {
  if (event.event !== "ringo.play.end") return "playing";
  return event.attributes["music.stop.reason"] === "paused" ? "paused" : "stopped";
}

// 一批里只有最后一条决定此刻的状态；每一条都原样归档。没有可用的播放事件时返回 null。
export function preparePlayerEvents(records: OtlpLogRecord[], device: PlayerDevice, receivedAt: number): PreparedPlayerEvents | null {
  const events = records.map(playerEvent).filter((event): event is PlayerEvent => event !== null);
  if (!events.length) return null;
  const latest = events.reduce((last, event) => (BigInt(event.timeUnixNano) >= BigInt(last.timeUnixNano) ? event : last));
  const music: LocalNowPlaying = {
    source: device,
    state: stateOf(latest),
    title: latest.trackName,
    artist: latest.artistName,
    album: latest.albumName,
    trackId: latest.trackId,
    artworkUrl: null,
    positionMs: Math.max(0, latest.positionMs ?? 0),
    durationMs: Math.max(0, latest.durationMs ?? 0),
    repeatOne: latest.attributes["music.mode.repeat"] === "one",
    observedAt: Math.min(latest.occurredAt, receivedAt),
  };
  return { source: "player", device, stored: { music, receivedAt }, events };
}
