import { mirrorKey } from "@/lib/storage";

export const QUEST_STALE_MS = 5 * 60_000;

export type QuestPlaying = {
  name: string;
  platform: "meta_quest";
  details: string | null;
  state: string | null;
  /** Epoch milliseconds reported by Discord; null when absent. */
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

export type QuestNow = Omit<QuestPresence, "discordStatus"> & {
  available: boolean;
  discordStatus: QuestPresence["discordStatus"] | null;
};

export const questMirror = mirrorKey<QuestPresence>(["quest", "presence"], (value) => value.observedAt);

export function questNow(presence: QuestPresence | null, now = Date.now()): QuestNow {
  const available = presence != null && now - Math.min(presence.observedAt, presence.receivedAt) < QUEST_STALE_MS;
  return {
    available,
    observedAt: presence?.observedAt ?? 0,
    receivedAt: presence?.receivedAt ?? 0,
    discordStatus: available ? presence.discordStatus : null,
    playing: available ? presence.playing : null,
  };
}
