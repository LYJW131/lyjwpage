import { AwaitingReport } from "@/lib/awaiting-report";
import type { ListeningPayload } from "@/lib/types";
import { mirror } from "@shared/apple-music-store";

/**
 * 取「最近在听」。
 *
 * 一次都还没拉到过时明确报错，不返回空列表 —— 空列表的意思是「你最近什么都没听」，
 * 而这里的实情是「站点手上还没有这份数据」，两件事的修法完全不同。这个状态是
 * 正常的、短暂的：读取本身不触发拉取，要等采集 Worker 的 `appleRecentJob`
 * 写入并推送，卡片才会点亮。
 */
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
