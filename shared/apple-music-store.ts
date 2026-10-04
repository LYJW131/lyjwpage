import { mirrorKey } from "@/lib/storage";
import type { ListeningItem, PlayingContainer } from "@/lib/types";


// mirrorKey 不校验形状；结构变化必须升级键版本，避免把旧值当新格式读取。
export const mirror = mirrorKey<{ items: ListeningItem[]; fetchedAt: number }>(
  ["apple-music", "recent", "v2"],
  (state) => state.fetchedAt,
);

export const playingContainer = mirrorKey<{ container: PlayingContainer | null; fetchedAt: number }>(
  ["apple-music", "playing-container", "v1"],
  (state) => state.fetchedAt,
);
