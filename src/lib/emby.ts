import { AwaitingReport } from "@/lib/awaiting-report";
import { getCurrentItem, getImageObjectKeys, getNowPlaying, getResume } from "@/lib/emby-store";
import { type NowWatchingPayload, nowWatchingPayload, type WatchingPayload, watchingPayload } from "@shared/emby";

export async function getWatching(options: { limit?: number } = {}): Promise<WatchingPayload> {
  const stored = await getResume();
  if (!stored) throw new AwaitingReport("尚未收到 Emby 推送");

  return watchingPayload(stored.items, await getImageObjectKeys(), options);
}

export async function getNowWatching(): Promise<NowWatchingPayload> {
  const live = await getNowPlaying();
  if (!live) return { nowPlaying: null, current: null };

  return nowWatchingPayload(
    live,
    (await getCurrentItem())?.item ?? null,
    await getImageObjectKeys(),
  );
}
export { type NowWatchingPayload, nowWatchingPayload, type WatchingPayload, watchingPayload } from "@shared/emby";
