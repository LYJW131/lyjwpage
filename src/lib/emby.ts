import { AwaitingReport } from "@/lib/awaiting-report";
import { getCurrentItem, getImageObjectKeys, getNowPlaying, getResume } from "@/lib/emby-store";
import { type NowWatchingPayload, nowWatchingPayload, type WatchingPayload, watchingPayload } from "@shared/emby";

export async function getWatching(options: { limit?: number } = {}): Promise<WatchingPayload> {
  const [stored, objectKeys] = await Promise.all([getResume(), getImageObjectKeys()]);
  if (!stored) throw new AwaitingReport("No Emby report yet");

  return watchingPayload(stored.items, objectKeys, options);
}

export async function getNowWatching(): Promise<NowWatchingPayload> {
  const [live, current, objectKeys] = await Promise.all([getNowPlaying(), getCurrentItem(), getImageObjectKeys()]);
  if (!live) return { nowPlaying: null, current: null };

  return nowWatchingPayload(live, current?.item ?? null, objectKeys);
}
export { type NowWatchingPayload, nowWatchingPayload, type WatchingPayload, watchingPayload } from "@shared/emby";
