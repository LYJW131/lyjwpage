import { mirrorKey } from "@/lib/storage";

export const QUEST_STALE_MS = 5 * 60_000;

export type QuestPlaying = {
  name: string;
  platform: "meta_quest";
  details: string | null;
  state: string | null;
  startedAt: number | null;
  applicationId: string | null;
  parentApplicationId: string | null;
  largeImageUrl: string | null;
};

export type QuestPresence = {
  observedAt: number;
  receivedAt: number;
  discordStatus: "online" | "idle" | "dnd" | "offline";
  playing: QuestPlaying | null;
};

// discordStatus 只在上报与存储里：它是 Discord 账号的在线状态，不是 Quest 本身，公开的 QuestNow 不带。
export type QuestNow = Omit<QuestPresence, "discordStatus"> & { available: boolean };

export const questMirror = mirrorKey<QuestPresence>(["quest", "presence"], (value) => value.observedAt);

export function questNow(presence: QuestPresence | null, now = Date.now()): QuestNow {
  const available = presence != null && now - Math.min(presence.observedAt, presence.receivedAt) < QUEST_STALE_MS;
  return {
    available,
    observedAt: presence?.observedAt ?? 0,
    receivedAt: presence?.receivedAt ?? 0,
    playing: available ? presence.playing : null,
  };
}
