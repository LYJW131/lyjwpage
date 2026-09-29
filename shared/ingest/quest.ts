import { object } from "@/lib/json";
import type { QuestPlaying, QuestPresence } from "@shared/quest";

export type PreparedQuestReport = { source: "quest"; receivedAt: number; presence: QuestPresence };

function text(value: unknown, max = 512): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function timestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function id(value: unknown): string | null {
  const valueText = text(value, 32);
  return valueText && /^\d{1,32}$/.test(valueText) ? valueText : null;
}

function image(value: unknown): string | null {
  const raw = text(value, 2048);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && ["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname) ? url.href : null;
  } catch { return null; }
}

export function prepareQuestReport(input: unknown, receivedAt = Date.now()): PreparedQuestReport {
  const envelope = object(input);
  const presence = object(envelope?.presence);
  const observedAt = timestamp(presence?.observedAt);
  if (envelope?.version !== 1 || !presence || !observedAt || observedAt > receivedAt + 60_000 || !("playing" in presence)) {
    throw new Error("Invalid Quest presence envelope");
  }
  const discordStatus = presence.discordStatus;
  if (discordStatus !== "online" && discordStatus !== "idle" && discordStatus !== "dnd" && discordStatus !== "offline") {
    throw new Error("Invalid Discord status");
  }
  let playing: QuestPlaying | null = null;
  if (presence.playing !== null) {
    const game = object(presence.playing);
    const name = text(game?.name, 256);
    if (!game || !name || game.platform !== "meta_quest") throw new Error("Only Meta Quest games are accepted");
    playing = {
      name, platform: "meta_quest", details: text(game.details), state: text(game.state),
      startedAt: timestamp(game.startedAt), applicationId: id(game.applicationId),
      parentApplicationId: id(game.parentApplicationId), largeImageUrl: image(game.largeImageUrl),
    };
  }
  return { source: "quest", receivedAt, presence: { observedAt, receivedAt, discordStatus, playing: discordStatus === "offline" ? null : playing } };
}
