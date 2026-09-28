import { withStorageScope } from "@/lib/storage";
import type { ListeningItem } from "@/lib/types";
import { fanout } from "@api/fanout";
import { prepareRecentlyPlayed } from "@api/stores/apple-music-store";
import { recordListeningPlay } from "@api/stores/listening-pulse";

/**
 * 收下采集 Worker 拉回来的一份最近在听：差分、落库、推 `listening`、记听歌痕迹。
 *
 * 拉取本身（Apple 请求、封面与时长的缓存）在采集 Worker 里；这里只做依赖权威
 * 旧值的那一半，经 StateCore RPC 进来。
 */
export async function commitRecentlyPlayed(items: ListeningItem[]): Promise<{ changed: boolean }> {
  return withStorageScope(async () => {
    const { changed, play, listening, commit } = await prepareRecentlyPlayed(items);
    /**
     * 列表变了就是「在什么设备上又放了点什么」，哪怕 Mac 睡着、HomePod 没动 ——
     * 那时这是唯一留下的痕迹。它没有时刻，所以不进 pulse 序列、不画进图，只作为
     * 证据交给评分器和正在播放的实测段一起打分，见 workers/api/src/pulse-score.ts。
     */
    // 完整数据可并行广播。首屏不失效：列表区定高、条目绝对定位，换歌只换内容，
    // 交给定时重建（见 lib/home-layout）。
    await fanout({
      writes: play ? [commit(), recordListeningPlay(play)] : [commit()],
      events: changed ? [{ type: "listening", payload: listening }] : [],
    });
    return { changed };
  });
}
