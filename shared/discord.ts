import { mirrorKey } from "@/lib/storage";
import type { DiscordPresencePayload } from "@/lib/types";

export const discordMirror = mirrorKey<DiscordPresencePayload>(
  ["discord", "presence"],
  (value) => value.observedAt,
  { ttlMs: 7 * 86400_000 },
);
