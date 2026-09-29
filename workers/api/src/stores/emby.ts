import { getCurrentItem, getImageObjectKeys, getNowPlaying, getResume, resolveNowPlaying, type StoredWatchingItem } from "@/lib/emby-store";
import { NOW_WATCHING_TAG, WATCHING_TAG } from "@/lib/live-events";
import { fanout, type PendingEvent } from "@api/fanout";
import { recordStateObservation } from "@api/stores/pulse";
import { watchingFacts } from "@shared/pulse-timeline";
import type { PreparedEmbyPlaying, PreparedEmbyReport } from "@shared/ingest/emby";
import { clearNowPlaying, setCurrentItem, setImageObjectKeys, setNowPlaying, setResume } from "@api/stores/emby-store";
import { nowWatchingPayload, watchingPayload } from "@shared/emby";

/**
 * Emby「最近在看」的状态核心那一半：差分、落库、推送。
 *
 * 本站不发任何 Emby 请求，续播列表、播放位置、海报全部由 NAS 上的推送代理送进来
 * （reporters/emby-reporter → /api/ingest/emby）。逐字段收敛和 R2 HEAD 在上报入口做完
 * （shared/ingest/emby.ts），这里只收已经收敛过的那份。
 */

async function mergePreparedImages(
  candidates: ReadonlyArray<{ key: string; objectKey: string }>,
  latest: Record<string, string>,
): Promise<{ objectKeys: Record<string, string>; stored: number }> {
  if (!candidates.length) return { objectKeys: latest, stored: 0 };
  const objectKeys = { ...latest };
  for (const candidate of candidates) {
    // 每次提交都基于 DO 内刚读到的映射合并，慢 HEAD 不能把并发新增的键盖掉。
    delete objectKeys[candidate.key];
    objectKeys[candidate.key] = candidate.objectKey;
  }
  return {
    objectKeys: await setImageObjectKeys(objectKeys),
    stored: candidates.length,
  };
}

/** 引用了却还没有图的键，只按本状态核心里的映射算。回给代理，让它下一次把这些补上 */
function missingKeys(items: StoredWatchingItem[], objectKeys: Record<string, string>): string[] {
  const missing = new Set<string>();
  for (const item of items) {
    for (const key of [item.posterKey, item.backdropKey]) {
      if (key && !objectKeys[key]) missing.add(key);
    }
  }
  return [...missing];
}

/**
 * 收下推送代理的一次上报。
 *
 * 续播列表、播放状态、图片三个部分都可省略，缺席表示这次不谈那一项，各推各的；
 * 什么时候推由上报器定（reporters/emby-reporter/src/index.ts）。
 */
export async function commitPreparedEmbyReport(prepared: PreparedEmbyReport) {
  const { receivedAt } = prepared;

  const writes: Promise<unknown>[] = [];
  const events: PendingEvent[] = [];
  const tags: string[] = [];

  /**
   * 这次用得着的键一起读取。
   *
   * 都来自同一个 StateHub 本地 SQLite，但依然并行组织：图片映射两份 payload 都要用，续播列表既要 diff
   * 又是 missingImages 的底，播放中那一项在代理只推了个位置更新时要拿来配详情。
   */
  const [images, previousResume, storedCurrent, previousNowPlaying] = await Promise.all([
    getImageObjectKeys(),
    getResume(),
    prepared.playing ? getCurrentItem() : null,
    prepared.playing ? getNowPlaying() : null,
  ]);

  const { objectKeys, stored } = await mergePreparedImages(prepared.images, images);

  let list: StoredWatchingItem[] | null = null;
  /**
   * 列表内容变没变。代理除了列表变化时推，到了整推间隔（`fullPushIntervalMs`）还会兜底整推一次；
   * 收到就推给浏览器的话推送会退化成定时广播，所以这里自己比一遍。
   */
  let resumeChanged = false;
  if (prepared.resume) {
    list = prepared.resume;
    resumeChanged = JSON.stringify(previousResume?.items) !== JSON.stringify(list);
    writes.push(setResume(list));
    // 瓷砖行横向滚动、定高，条目增减不改布局；只有空和非空之间换的是另一块占位
    if (!previousResume?.items.length !== !list.length) tags.push(WATCHING_TAG);
  }

  /**
   * `playing` 缺席和为 null 是两回事：缺席表示这次不谈播放状态（比如只补图），
   * null 表示代理确认没有会话在播了，要清掉。所以判存在而不是判真假。
   */
  const played = prepared.playing ?? null;
  if (played) {
    writes.push(commitPlaying(played));
    /**
     * 这次没带详情就用存着的那份，按 itemId 对上才算数（同 nowWatchingPayload
     * 那道闸）。推送和 Pulse 必须用同一份：只给 `played.item` 的话，代理推来一条
     * 不带详情的位置更新会记出一段没有标题的区间，而标题变了在时间线眼里就是
     * 换了一段 —— 同一部剧会凭空多出一个断点。
     */
    const kept = storedCurrent?.item ?? null;
    const detail = played.item ?? (kept?.id === played.state?.itemId ? kept : null);
    writes.push(recordStateObservation("watching", receivedAt, watchingFacts(played.state, detail)));
    // 播放状态变了就直接把新数据推给浏览器 —— 手上这份就是最新的
    const nowPlaying = resolveNowPlaying(played.state);
    events.push({
      type: "watching-now",
      payload: nowWatchingPayload(nowPlaying, detail, objectKeys),
    });
    /**
     * 「正在看」整张卡只在有会话时渲染（暂停也算），所以首屏只在开播和停播时失效。
     * 进度、暂停续播、拖进度条都只换卡里的内容，交给定时重建。
     */
    if ((previousNowPlaying == null) !== (nowPlaying == null)) tags.push(NOW_WATCHING_TAG);
  }

  /**
   * 缺哪些图要按「落地后的全部状态」算，而不是只看这次推来的部分：
   * SQLite 被清空时代理往往只推了个位置更新，得靠这份回执才知道图也没了。
   *
   * 这次带了列表就用手上这份 —— 它正是要写下去的那份，读回来只会更慢，
   * 还可能读到写之前的。
   */
  const referenced = list ?? previousResume?.items ?? null;
  const current = played?.item ?? null;
  const missing = missingKeys(
    [...(referenced ?? []), ...(current ? [current] : [])],
    objectKeys,
  );

  /**
   * 列表也带整份数据推，理由见 lib/live-events 的事件定义。
   *
   * 新落地的图片也要发。列表里存的是图片键、地址在读取时才拼，所以图片单独补推
   * 的那一次 resume 根本没变，但 /api/status/watching 的输出确实变了（裂图变成
   * 封面）—— 不发的话得等下一轮轮询，推送连着时那只是兜底轮询。
   */
  if ((resumeChanged || stored > 0) && referenced) {
    events.push({ type: "watching", payload: watchingPayload(referenced, objectKeys) });
  }

  // 先确认落库，再派发推送和首屏失效，见 workers/api/src/fanout.ts
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
