import { normalizeDiscordReport } from "@/lib/discord-parse";
import { discordPayload } from "@/lib/discord";
import { DISCORD_STALE_MS, isStale } from "@/lib/freshness";
import { STATUS_VIEWS } from "@/lib/status-views";
import { discordMirror } from "@shared/discord";
import { fanout } from "@api/fanout";

export async function recordDiscordReport(input: unknown) {
  const incoming = normalizeDiscordReport(input);
  const previous = await discordMirror.get();
  if (previous && incoming.observedAt <= previous.observedAt) return { changed: false };
  const changed = !previous ||
    previous.discordStatus !== incoming.discordStatus ||
    JSON.stringify(previous.profile) !== JSON.stringify(incoming.profile) ||
    JSON.stringify(previous.playing) !== JSON.stringify(incoming.playing) ||
    isStale({ now: incoming.observedAt, at: previous.observedAt, windowMs: DISCORD_STALE_MS });
  await fanout({
    writes: [discordMirror.put(incoming)],
    events: changed ? [{ type: "discord", payload: discordPayload(incoming) }] : [],
    tags: changed ? [STATUS_VIEWS.discord.tag] : [],
  });
  return { changed };
}
