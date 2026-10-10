import { AwaitingReport } from "@/lib/awaiting-report";
import { getPlaystationPlayedGames, getPlaystationPresence } from "@/lib/playstation-store";
import type {
  PlaystationPlayingPayload,
  PlaystationPresencePayload
} from "@/lib/types";

export async function getPlaying(): Promise<PlaystationPlayingPayload> {
  const payload = await getPlaystationPlayedGames();
  if (!payload) throw new AwaitingReport("No PlayStation play history yet");
  return payload;
}

export async function getPlayingNow(): Promise<PlaystationPresencePayload> {
  const payload = await getPlaystationPresence();
  if (!payload) throw new AwaitingReport("No PlayStation presence yet");
  return payload;
}
export { normalizePlaystationPlayedGames, normalizePlaystationPresence } from "@shared/playstation";
