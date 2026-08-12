import {
  clearNowPlaying,
  getCurrentItem,
  getImageUrls,
  getNowPlaying,
  getResume,
  setCurrentItem,
  setImageUrls,
  setNowPlaying,
  setResume,
  type ResolvedNowPlaying,
  type StoredWatchingItem,
} from "@/lib/emby-store";
import { ASSET_URL_PREFIX, hasStoredImage, IMAGE_OBJECT_KEY } from "@/lib/r2-assets";
import { number, object, text } from "@/lib/json";
import { expireStatus, NOW_WATCHING_TAG, publish, WATCHING_TAG } from "@/lib/live-events";
import type { WatchingItem } from "@/lib/types";

/**
 * Emby「最近在看」。
 *
 * 本站不发任何 Emby 请求 —— 站点将来跑在 Vercel 上，内网里的 Emby 那时根本
 * 够不着。续播列表、播放位置、海报全部由 NAS 上的推送代理送进来
 * （reporters/emby-reporter → api/ingest/emby）。Emby 自己的播放
 * webhook 也先发给那个代理，再由它带着密钥转发过来 —— Emby 的 webhook 配置项
 * 加不了自定义请求头，直发站点就只能开一个不鉴权的入口。
 *
 * 于是这个文件只剩两件事：把推来的东西规范化存下，以及读出来拼成前端要的形状。
 */

/** 图片键由代理拼（itemId:kind:tag:height），这里只挡住不像键的东西 */
const IMAGE_KEY = /^[A-Za-z0-9:_.-]{1,160}$/;
/**
 * 「最近在看」和「正在播放」拆成两份，因为它们的刷新节奏根本不同：
 * 前者一天可能只变几次，后者跟着播放走。
 * 合成一个端点的话，慢的那半会被快的那半的节奏拖着白跑。
 */
export type WatchingPayload = {
  items: WatchingItem[];
};

export type NowWatchingPayload = {
  /** 此刻播放中的那一条，附带设备与暂停状态 */
  nowPlaying: ResolvedNowPlaying | null;
  /**
   * 播放中那一项的详情。
   *
   * 单独给是因为它不一定在 Resume 列表里（刚开播、或已经看完就会掉出去），
   * 而两个端点各自刷新，服务端没法再像从前那样把它插进列表里返回。
   * 置顶和去重交给页面做 —— 那本来就是展示逻辑。
   */
  current: WatchingItem | null;
};

/** 把存下来的条目里的图片键换成真地址。键还没对应上图就先空着 */
function resolve(item: StoredWatchingItem, urls: Record<string, string>): WatchingItem {
  const { posterKey, backdropKey, ...rest } = item;
  return {
    ...rest,
    poster: (posterKey && urls[posterKey]) || null,
    backdrop: (backdropKey && urls[backdropKey]) || null,
  };
}

export async function getWatching({ limit = 8 } = {}): Promise<WatchingPayload> {
  const stored = await getResume();
  // 还没收到过推送。交给 statusRoute 变成降级信封，前端显示提示
  if (!stored) throw new Error("尚未收到 Emby 推送");

  const urls = await getImageUrls();
  return { items: stored.items.slice(0, limit).map((item) => resolve(item, urls)) };
}

/** 全靠推送，空闲时零上游请求 —— 没在播就只读一次自家存储 */
export async function getNowWatching(): Promise<NowWatchingPayload> {
  const live = await getNowPlaying();
  if (!live) return { nowPlaying: null, current: null };

  const stored = await getCurrentItem();
  // 详情比 webhook 晚到一拍很正常（代理下一轮才把这一项推来），对不上就先不给
  const current =
    stored?.item.id === live.itemId ? resolve(stored.item, await getImageUrls()) : null;

  return { nowPlaying: live, current };
}

/* ── 以下是推送代理那一侧的入口 ──────────────────────────────── */

/**
 * 代理推来的一项。
 *
 * 只带 Emby 说了什么，不带怎么显示：标题拼法和「在 Emby 里打开」的链接都在
 * 这一侧做 —— 前者是展示逻辑，后者要用 EMBY_PUBLIC_URL，那是浏览器侧的地址，
 * 代理不该知道。
 */
type ReportItem = {
  id: string;
  name: string;
  type: string | null;
  serverId: string | null;
  seriesName: string | null;
  season: number | null;
  episode: number | null;
  year: number | null;
  progress: number;
  playedAt: string | null;
  posterKey: string | null;
  backdropKey: string | null;
};

function imageKey(value: unknown): string | null {
  const key = text(value);
  return key && IMAGE_KEY.test(key) ? key : null;
}

function reportItem(value: unknown): ReportItem | null {
  const raw = object(value);
  const id = text(raw?.id);
  if (!raw || !id) return null;

  return {
    id,
    name: text(raw.name) ?? "",
    type: text(raw.type),
    serverId: text(raw.serverId),
    seriesName: text(raw.seriesName),
    season: number(raw.season),
    episode: number(raw.episode),
    year: number(raw.year),
    progress: Math.min(100, Math.max(0, number(raw.progress) ?? 0)),
    playedAt: text(raw.playedAt),
    posterKey: imageKey(raw.posterKey),
    backdropKey: imageKey(raw.backdropKey),
  };
}

function normalizeType(type: string | null): WatchingItem["type"] {
  if (type === "Episode" || type === "Movie" || type === "Series") return type;
  return "Other";
}

/**
 * 跳转链接指向 EMBY_PUBLIC_URL，那是浏览器能访问到的地址。
 * 没配就不给链接 —— 这里再没有内网地址可退，退了也是个点不开的链接。
 */
function link(item: ReportItem): string | null {
  const base = (process.env.EMBY_PUBLIC_URL ?? "").replace(/\/+$/, "");
  if (!base || !item.id) return null;
  const server = item.serverId ? `&serverId=${item.serverId}` : "";
  return `${base}/web/index.html#!/item?id=${item.id}${server}`;
}

function normalize(item: ReportItem): StoredWatchingItem {
  let title: string;
  let subtitle: string;

  if (item.type === "Episode") {
    // 剧集展示剧名当标题，「S1:E5 - 集标题」当副标题
    title = item.seriesName || item.name;
    const label =
      item.season != null && item.episode != null
        ? `S${item.season}:E${item.episode}`
        : item.episode != null
          ? `E${item.episode}`
          : null;
    subtitle = [label, item.name].filter(Boolean).join(" · ");
  } else {
    title = item.name;
    subtitle = item.year != null ? String(item.year) : "";
  }

  return {
    id: item.id,
    title,
    subtitle,
    progress: item.progress,
    posterKey: item.posterKey,
    backdropKey: item.backdropKey,
    type: normalizeType(item.type),
    year: item.year,
    link: link(item),
    playedAt: item.playedAt,
  };
}

/** 接收上报器已经写入 R2 的对象键；站点不再接触图片字节。 */
async function storeImages(value: unknown): Promise<{ urls: Record<string, string>; stored: number }> {
  const urls = await getImageUrls();
  if (!Array.isArray(value) || !value.length) return { urls, stored: 0 };

  let stored = 0;
  for (const entry of value) {
    const raw = object(entry);
    // imageKey 是 Emby 侧的键（itemId:kind:tag:height），objectKey 是 R2 上那份
    // 字节的内容地址。两个键挨在一起，名字必须各自说清是谁的键。
    const key = imageKey(raw?.imageKey);
    if (!key || !raw) continue;

    const objectKey = text(raw.objectKey);
    if (!objectKey || !IMAGE_OBJECT_KEY.test(objectKey)) continue;
    if (!(await hasStoredImage(objectKey))) continue;
    const url = `${ASSET_URL_PREFIX}${objectKey}`;
    // 重新插入，让它排到末尾：淘汰的总是最久没被推过的那些
    delete urls[key];
    urls[key] = url;
    stored += 1;
  }

  if (stored) await setImageUrls(urls);
  return { urls, stored };
}

/** 引用了却还没有图的键。回给代理，让它下一次把这些补上 */
function missingKeys(items: StoredWatchingItem[], urls: Record<string, string>): string[] {
  const missing = new Set<string>();
  for (const item of items) {
    for (const key of [item.posterKey, item.backdropKey]) {
      if (key && !urls[key]) missing.add(key);
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
export async function recordEmbyReport(body: unknown) {
  const root = object(body);
  if (!root) throw new Error("请求体不是对象");

  const { urls, stored } = await storeImages(root.images);

  const resume = object(root.resume);
  let items: number | null = null;
  /**
   * 列表内容变没变。代理只在有变化时推列表，但每 10 分钟还会兜底整推一次，
   * 收到就发失效通知的话推送会退化成定时广播，所以这里自己比一遍。
   */
  let resumeChanged = false;
  if (resume && Array.isArray(resume.items)) {
    const list = resume.items
      .map(reportItem)
      .filter((item): item is ReportItem => item != null)
      .map(normalize);
    const previous = await getResume();
    resumeChanged = JSON.stringify(previous?.items) !== JSON.stringify(list);
    await setResume(list);
    items = list.length;
  }

  /**
   * `playing` 缺席和为 null 是两回事：缺席表示这次不谈播放状态（比如只补图），
   * null 表示代理确认没有会话在播了，要清掉。所以判存在而不是判真假。
   */
  let playing: "updated" | "cleared" | null = null;
  if ("playing" in root) {
    playing = (await recordPlaying(root.playing)) ? "updated" : "cleared";
  }

  /**
   * 缺哪些图要按「落地后的全部状态」算，而不是只看这次推来的部分：
   * Redis 被清空时代理往往只推了个位置更新，得靠这份回执才知道图也没了。
   */
  const current = playing === "updated" ? (await getCurrentItem())?.item : null;
  const referenced = [...((await getResume())?.items ?? []), ...(current ? [current] : [])];
  const missing = missingKeys(referenced, urls);

  // 播放状态变了就直接把新数据推给浏览器 —— 服务端手上已经是最新的
  if (playing) {
    await publish({ type: "watching-now", payload: await getNowWatching() });
    expireStatus(NOW_WATCHING_TAG);
  }
  /**
   * 列表也带整份数据推（2.8 KB），理由见 lib/live-events 的事件定义。
   *
   * 新落地的图片也要发。列表里存的是图片键、地址在读取时才拼，所以图片单独补推
   * 的那一次 resume 根本没变，但 /api/status/watching 的输出确实变了（裂图变成
   * 封面）—— 不发的话得等下一轮轮询，而列表的轮询现在是 5 分钟一次。
   */
  if (resumeChanged || stored > 0) {
    await publish({ type: "watching", payload: await getWatching() });
    expireStatus(WATCHING_TAG);
  }

  return { items, playing, images: stored, missingImages: missing };
}

/** 返回是否仍在播放中 */
async function recordPlaying(value: unknown): Promise<boolean> {
  const raw = object(value);
  const itemId = text(raw?.itemId);
  if (!raw || !itemId) {
    await clearNowPlaying();
    return false;
  }

  const item = reportItem(raw.item);
  if (item) await setCurrentItem(normalize(item));

  /**
   * 时间戳取本站收到的时刻，不用代理给的。
   * 进度是从这个锚点按真实时间往前推算的，两台机器的时钟差多少，推算就偏多少。
   */
  await setNowPlaying({
    itemId,
    paused: raw.paused === true,
    positionTicks: number(raw.positionTicks) ?? 0,
    runTimeTicks: number(raw.runTimeTicks) ?? 0,
    device: text(raw.device) ?? "",
    at: Date.now(),
  });
  return true;
}
