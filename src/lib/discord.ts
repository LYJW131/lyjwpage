import { AwaitingReport } from "@/lib/awaiting-report";
import { DISCORD_STALE_MS, isStale } from "@/lib/freshness";
import type { DiscordNowPayload, DiscordPresencePayload } from "@/lib/types";
import { discordMirror } from "@shared/discord";

export function discordPayload(presence: DiscordPresencePayload, now = Date.now()): DiscordNowPayload {
  return {
    ...presence,
    staleAfterMs: DISCORD_STALE_MS,
    staleAtSource: isStale({ now, at: presence.observedAt, windowMs: DISCORD_STALE_MS }),
  };
}

export async function getDiscordNow(): Promise<DiscordNowPayload> {
  const presence = await discordMirror.get();
  if (!presence) throw new AwaitingReport("Waiting for Quest activity");
  return discordPayload(presence);
}
