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

/** 引用了却还没有图的键。回给代理，让它下一次把这些补上 */
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
 * 三个部分都可省略，各推各的：续播列表 60 秒一轮且只在有变化时推，播放位置
 * 只在拖动进度条偏离推算值时推，图片则只在没推过或 ImageTag 变了时才带。
 */
export async function commitPreparedEmbyReport(prepared: PreparedEmbyReport) {
  const { receivedAt } = prepared;

  const writes: Promise<unknown>[] = [];
  const events: PendingEvent[] = [];
  const tags: string[] = [];

  /**
   * 这次用得着的三个键一起读取。
   *
   * 三份都来自同一个 StateHub 本地 SQLite，但依然并行组织：图片映射两份 payload 都要用，续播列表既要 diff
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
   * 列表内容变没变。代理只在有变化时推列表，但每 10 分钟还会兜底整推一次，
   * 收到就发失效通知的话推送会退化成定时广播，所以这里自己比一遍。
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
   * 列表也带整份数据推（2.8 KB），理由见 lib/live-events 的事件定义。
   *
   * 新落地的图片也要发。列表里存的是图片键、地址在读取时才拼，所以图片单独补推
   * 的那一次 resume 根本没变，但 /api/status/watching 的输出确实变了（裂图变成
   * 封面）—— 不发的话得等下一轮轮询，而列表的轮询现在是 5 分钟一次。
   */
  if ((resumeChanged || stored > 0) && referenced) {
    events.push({ type: "watching", payload: watchingPayload(referenced, objectKeys) });
  }

  // 落库和推送同时发车，失效等它们完成，见 lib/live-events 的 fanout
  await fanout({ writes, events, tags });

  return { items: list?.length ?? null, playing: played?.outcome ?? null, images: stored, missingImages: missing };
}

/**
 * `missingImages` 回的是**本部署**引用了却没有的键，不再并对端那份。
 *
 * 从前取并集：两份部署各有各的 `imageKey → objectKey` 映射，「引用了但没有」是
 * 各算各的。代价是每一条上报都要等一次跨海往返，而两边只在**转发丢了**的时候才
 * 会不一样 —— 正常情况下对端算的是同一份请求体，答案必然一致。转发现在不等了
 * （见 lib/api 的 ingestRoute），这份并也就无从谈起。
 *
 * 放弃的是「转发丢了之后把对端那张裂图修回来」：代理把没被抱怨的键当成已经收下
 * （见 reporters/emby-reporter 的 deliver），所以没人提就不会重传。注意 COS 回源
 * 救不了这一种 —— 回源救的是「有 URL 但桶里没字节」，而对端缺的是映射本身，
 * 它根本拼不出 URL。但转发丢了的话对端缺的是那次上报的全部内容，不止图。
 */

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
