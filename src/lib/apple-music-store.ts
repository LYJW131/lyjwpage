import { AwaitingReport } from "@/lib/awaiting-report";
import type { ListeningPayload } from "@/lib/types";
import { mirror } from "@shared/apple-music-store";

export async function getRecentlyPlayed(): Promise<ListeningPayload> {
  const state = await mirror.get();
  if (!state) {
    if (await mirror.reachable()) {
      throw new AwaitingReport("还没有拉到过 Apple Music 最近播放");
    }
    throw new Error("读不到「最近在听」—— Storage 连不上，数据本身可能还在");
  }
  return { items: state.items, fetchedAt: state.fetchedAt };
}
