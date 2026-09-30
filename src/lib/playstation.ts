import { AwaitingReport } from "@/lib/awaiting-report";
import { getPlaystationPlayedGames, getPlaystationPresence } from "@/lib/playstation-store";
import type {
  PlaystationPlayingPayload,
  PlaystationPresencePayload
} from "@/lib/types";

export async function getPlaying(): Promise<PlaystationPlayingPayload> {
  const payload = await getPlaystationPlayedGames();
  if (!payload) throw new AwaitingReport("尚未收到 PlayStation 最近游玩遥测");
  return payload;
}

export async function getPlayingNow(): Promise<PlaystationPresencePayload> {
  const payload = await getPlaystationPresence();
  if (!payload) throw new AwaitingReport("尚未收到 PlayStation 在线状态遥测");
  return payload;
}
export { normalizePlaystationPlayedGames, normalizePlaystationPresence } from "@shared/playstation";
