import type { DiscordPlaying, DiscordPresencePayload } from "@/lib/types";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as Record<string, unknown>;
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function timestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
function imageUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password &&
      ["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname) ? url.href : null;
  } catch { return null; }
}
export function normalizeDiscordReport(input: unknown): DiscordPresencePayload {
  const envelope = record(input);
  if (envelope.version !== 1) throw new Error("Discord report version must be 1");
  const presence = record(envelope.presence);
  const observedAt = timestamp(presence.observedAt);
  const discordStatus = text(presence.discordStatus);
  if (!observedAt || !discordStatus || !("playing" in presence)) throw new Error("Invalid Discord presence");
  let playing: DiscordPlaying | null = null;
  if (presence.playing !== null) {
    const game = record(presence.playing);
    if (game.platform !== "meta_quest") throw new Error("Only Meta Quest activities are accepted");
    const name = text(game.name);
    if (!name) throw new Error("Missing Quest game name");
    const id = text(game.applicationId);
    playing = {
      name, platform: "meta_quest", details: text(game.details), state: text(game.state),
      startedAt: timestamp(game.startedAt), applicationId: id && /^\d+$/.test(id) ? id : null,
      largeImageUrl: imageUrl(game.largeImageUrl),
    };
  }
  return { observedAt, discordStatus, playing: discordStatus === "offline" ? null : playing };
}
