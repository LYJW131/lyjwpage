// discord.js drops the Gateway activity's platform field, so Quest detection uses raw packets.
export type RawActivity = {
  name?: unknown;
  type?: unknown;
  platform?: unknown;
  details?: unknown;
  state?: unknown;
  timestamps?: { start?: unknown } | null;
  created_at?: unknown;
  application_id?: unknown;
  parent_application_id?: unknown;
  assets?: { large_image?: unknown } | null;
};

export type RawPresence = {
  status?: unknown;
  activities?: RawActivity[] | null;
};

export type PlayingReport = {
  name: string;
  platform: "meta_quest";
  details: string | null;
  state: string | null;
  startedAt: number | null;
  applicationId: string | null;
  parentApplicationId: string | null;
  largeImageUrl: string | null;
};

export type PresenceReport = {
  observedAt: number;
  discordStatus: "online" | "idle" | "dnd" | "offline";
  playing: PlayingReport | null;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function epochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function startedAtOf(activity: RawActivity): number | null {
  return epochMs(activity.timestamps?.start);
}

export function largeImageUrlOf(activity: RawActivity): string | null {
  const image = text(activity.assets?.large_image);
  if (!image) return null;
  if (image.startsWith("mp:") && image.length > 3) {
    return `https://media.discordapp.net/${image.slice(3)}`;
  }
  if (image.includes(":")) return null;
  const applicationId = text(activity.application_id);
  return applicationId
    ? `https://cdn.discordapp.com/app-assets/${applicationId}/${image}.png?size=256`
    : null;
}

export function pickPlaying(presence: RawPresence): PlayingReport | null {
  if (presence.status === "offline" || !Array.isArray(presence.activities)) return null;
  let best: PlayingReport | null = null;
  let bestRecency = Number.NEGATIVE_INFINITY;
  for (const activity of presence.activities) {
    if (!activity || typeof activity !== "object") continue;
    if (activity.type !== 0 || activity.platform !== "meta_quest") continue;
    const name = text(activity.name);
    if (!name) continue;
    const recency = startedAtOf(activity) ?? epochMs(activity.created_at) ?? Number.NEGATIVE_INFINITY;
    if (best && recency < bestRecency) continue;
    bestRecency = recency;
    best = {
      name,
      platform: "meta_quest",
      details: text(activity.details),
      state: text(activity.state),
      startedAt: startedAtOf(activity),
      applicationId: text(activity.application_id),
      parentApplicationId: text(activity.parent_application_id),
      largeImageUrl: largeImageUrlOf(activity),
    };
  }
  return best;
}

export function reportFrom(presence: RawPresence | null | undefined, observedAt = Date.now()): PresenceReport | null {
  if (!presence) return null;
  const discordStatus = presence.status;
  if (discordStatus !== "online" && discordStatus !== "idle" && discordStatus !== "dnd" && discordStatus !== "offline") return null;
  if (discordStatus !== "offline" && !Array.isArray(presence?.activities)) return null;
  return { observedAt, discordStatus, playing: pickPlaying(presence) };
}
