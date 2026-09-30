import { withStorageScope } from "@/lib/storage";
import type { ListeningItem, RecentTrack } from "@/lib/types";
import { fanout } from "@api/fanout";
import { prepareRecentlyPlayed } from "@api/stores/apple-music-store";
import { prepareRecentTracks, recordListeningTrace } from "@api/stores/listening-pulse";

/**
 * 收下采集 Worker 拉回来的一份最近在听（专辑 / 歌单 / 电台）：差分、落库、推 `listening`。
 *
 * 拉取本身（Apple 请求、封面与时长的缓存）在采集 Worker 里；这里只做依赖权威
 * 旧值的那一半，经 StateCore RPC 进来。
 */
export async function commitRecentlyPlayed(items: ListeningItem[]): Promise<{ changed: boolean }> {
  return withStorageScope(async () => {
    const { changed, listening, commit } = await prepareRecentlyPlayed(items);
    // 推送带完整数据、和落库同源；fanout 先等写落库再推。首屏不失效：列表区定高、
    // 条目绝对定位，换歌只换内容，交给定时重建（见 lib/home-layout）。
    await fanout({
      writes: [commit()],
      events: changed ? [{ type: "listening", payload: listening }] : [],
    });
    return { changed };
  });
}

/**
 * 收下采集 Worker 拉回来的最近播放单曲：和上一轮比，变了就记一条听歌痕迹。
 *
 * 列表变了就是「在什么设备上又放了首歌」，哪怕 Mac 睡着、HomePod 没动 —— 那时这是
 * 唯一留下的痕迹。它没有时刻，只知道落在上一轮刷新和这一轮之间，所以 Pulse 把它画成
 * 一段不确定区间，不当成此刻在放，见 shared/pulse-listening。不推送：Pulse 自己按节奏重读。
 */
export async function commitRecentTracks(tracks: RecentTrack[]): Promise<{ traced: boolean }> {
  return withStorageScope(async () => {
    const { trace, commit } = await prepareRecentTracks(tracks);
    await fanout({ writes: trace ? [commit(), recordListeningTrace(trace)] : [commit()] });
    return { traced: trace !== null };
  });
}
