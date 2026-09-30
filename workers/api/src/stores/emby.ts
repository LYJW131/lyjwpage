import { getCurrentItem, getImageObjectKeys, getNowPlaying, getResume, resolveNowPlaying, type StoredWatchingItem } from "@/lib/emby-store";
import { NOW_WATCHING_TAG, WATCHING_TAG } from "@/lib/live-events";
import { fanout, type PendingEvent } from "@api/fanout";
import { recordStateObservation } from "@api/stores/pulse";
import { watchingFacts } from "@shared/pulse-timeline";
import type { PreparedEmbyPlaying, PreparedEmbyReport } from "@shared/ingest/emby";
import { clearNowPlaying, setCurrentItem, setImageObjectKeys, setNowPlaying, setResume } from "@api/stores/emby-store";
import { nowWatchingPayload, watchingPayload } from "@shared/emby";


async function mergePreparedImages(
  candidates: ReadonlyArray<{ key: string; objectKey: string }>,
  latest: Record<string, string>,
): Promise<{ objectKeys: Record<string, string>; stored: number }> {
  if (!candidates.length) return { objectKeys: latest, stored: 0 };
  const objectKeys = { ...latest };
  for (const candidate of candidates) {
    // 慢 HEAD 期间可能有新图片提交，必须用 DO 当前映射合并，不能覆盖并发新增键。
    delete objectKeys[candidate.key];
    objectKeys[candidate.key] = candidate.objectKey;
  }
  return {
    objectKeys: await setImageObjectKeys(objectKeys),
    stored: candidates.length,
  };
}

function missingKeys(items: StoredWatchingItem[], objectKeys: Record<string, string>): string[] {
  const missing = new Set<string>();
  for (const item of items) {
    for (const key of [item.posterKey, item.backdropKey]) {
      if (key && !objectKeys[key]) missing.add(key);
    }
  }
  return [...missing];
}

export async function commitPreparedEmbyReport(prepared: PreparedEmbyReport) {
  const { receivedAt } = prepared;

  const writes: Promise<unknown>[] = [];
  const events: PendingEvent[] = [];
  const tags: string[] = [];

  const [images, previousResume, storedCurrent, previousNowPlaying] = await Promise.all([
    getImageObjectKeys(),
    getResume(),
    prepared.playing ? getCurrentItem() : null,
    prepared.playing ? getNowPlaying() : null,
  ]);

  const { objectKeys, stored } = await mergePreparedImages(prepared.images, images);

  let list: StoredWatchingItem[] | null = null;
  let resumeChanged = false;
  if (prepared.resume) {
    list = prepared.resume;
    resumeChanged = JSON.stringify(previousResume?.items) !== JSON.stringify(list);
    writes.push(setResume(list));
    if (!previousResume?.items.length !== !list.length) tags.push(WATCHING_TAG);
  }

  const played = prepared.playing ?? null;
  if (played) {
    writes.push(commitPlaying(played));
    // 位置更新可能不带详情，须复用匹配 itemId 的标题，避免同一播放被切成多个区间。
    const kept = storedCurrent?.item ?? null;
    const detail = played.item ?? (kept?.id === played.state?.itemId ? kept : null);
    writes.push(recordStateObservation("watching", receivedAt, watchingFacts(played.state, detail)));
    const nowPlaying = resolveNowPlaying(played.state);
    events.push({
      type: "watching-now",
      payload: nowWatchingPayload(nowPlaying, detail, objectKeys),
    });
    if ((previousNowPlaying == null) !== (nowPlaying == null)) tags.push(NOW_WATCHING_TAG);
  }

  const referenced = list ?? previousResume?.items ?? null;
  const current = played?.item ?? null;
  const missing = missingKeys(
    [...(referenced ?? []), ...(current ? [current] : [])],
    objectKeys,
  );

  if ((resumeChanged || stored > 0) && referenced) {
    events.push({ type: "watching", payload: watchingPayload(referenced, objectKeys) });
  }

  await fanout({ writes, events, tags });

  return { items: list?.length ?? null, playing: played?.outcome ?? null, images: stored, missingImages: missing };
}

async function commitPlaying(playing: PreparedEmbyPlaying): Promise<void> {
  if (!playing.state) {
    await clearNowPlaying();
    return;
  }
  await Promise.all([
    playing.item ? setCurrentItem(playing.item) : null,
    setNowPlaying(playing.state),
  ]);
}
