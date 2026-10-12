import { AwaitingReport } from "@shared/awaiting-report";
import type { ListeningPayload } from "@shared/types";
import { mirror } from "@shared/apple-music-store";

export async function getRecentlyPlayed(): Promise<ListeningPayload> {
  const state = await mirror.get();
  if (!state) throw new AwaitingReport("还没有拉到过 Apple Music 最近播放");
  return { items: state.items, fetchedAt: state.fetchedAt };
}
