import { AwaitingReport } from "@/lib/awaiting-report";
import {
  getPlaystationPlayedGames,
  getPlaystationPresence,
  getPlaystationTrophies,
} from "@/lib/playstation-store";
import { overlayPlayStats } from "@/lib/trophies";
import type {
  PlaystationPlayingPayload,
  PlaystationPresencePayload,
  TrophiesPayload,
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

export async function getTrophies(): Promise<TrophiesPayload> {
  const [payload, played] = await Promise.all([getPlaystationTrophies(), getPlaystationPlayedGames()]);
  if (!payload) throw new AwaitingReport("尚未收到 PlayStation 奖杯遥测");
  if (!played?.items.length) {
    return {
      ...payload,
      titles: payload.titles.map((title) => ({
        ...title,
        service: title.service ?? null,
        preOrder: title.preOrder === true,
      })),
    };
  }
  return { ...payload, titles: overlayPlayStats(payload.titles, played.items) };
}
export { normalizePlaystationPlayedGames, normalizePlaystationPresence } from "@shared/playstation";
