import type { EmbyNowPlaying, StoredWatchingItem } from "@/lib/emby-store";
import { IMAGE_OBJECT_KEY } from "@/lib/asset-url";
import { number, object, text } from "@/lib/json";
import type { WatchingItem, WatchingMedia, WatchingPlayMethod } from "@/lib/types";

import { hasStoredImage, type ImageBucket } from "./r2-assets";

/**
 * Emby「最近在看」。
 *
 * 本站不发任何 Emby 请求 —— 站点将来跑在 Vercel 上，内网里的 Emby 那时根本
 * 够不着。续播列表、播放位置、海报全部由 NAS 上的推送代理送进来
 * （reporters/emby-reporter → api/ingest/emby）。Emby 自己的播放
 * webhook 也先发给那个代理，再由它带着密钥转发过来 —— Emby 的 webhook 配置项
 * 加不了自定义请求头，直发站点就只能开一个不鉴权的入口。
 *
 * 这个文件是上报入口（workers/ingress）那一半：把推来的东西逐字段收敛、确认图片
 * 已经落进 R2。落库、差分和推送在状态核心（workers/api/src/stores/emby.ts）。
 */

/** 图片键由代理拼（itemId:kind:tag:height），这里只挡住不像键的东西 */
const IMAGE_KEY = /^[A-Za-z0-9:_.-]{1,160}$/;

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

/**
 * 三个会撞上 Object.prototype 的名字。
 *
 * 映射是个普通对象，`objectKeys["__proto__"] = "…"` 那一下被 setter 吃掉、什么也
 * 没存（值是字符串，构不成原型污染），但**读**的那一下拿回来的是 Object.prototype
 * 本身 —— 真值，于是 publicAssetPath 把它拼成 "[object Object]"，产出一个坏路径。
 * 挡在入口最省事：挡住了 posterKey / backdropKey 就永远不会是这三个词，读取侧
 * 也就不会去查它们。
 */
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function imageKey(value: unknown): string | null {
  const key = text(value);
  if (!key || RESERVED_KEYS.has(key)) return null;
  return IMAGE_KEY.test(key) ? key : null;
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
  // 两个 id 都是代理原样转来的任意字符串，不编码的话带 # / & / 空格的那些会把
  // 后面的查询串截断，拼出一个点不开的链接
  const id = encodeURIComponent(item.id);
  const server = item.serverId ? `&serverId=${encodeURIComponent(item.serverId)}` : "";
  return `${base}/web/index.html#!/item?id=${id}${server}`;
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

/**
 * 接收上报器已经写入 R2 的对象键；站点不再接触图片字节。
 *
 * 上报入口先并发确认 R2 对象；状态核心的 StateHub 提交时再读取最新映射并逐键合并。
 * 没有新落地的图时返回的就是最新对象；有的话返回的是**落库后的那一份**
 * （setImageObjectKeys 会按 IMAGE_LIMIT 裁），不是就地改过的那个：超限时被淘汰
 * 掉的键必须在这次的回执和推送里就体现出来，否则推给浏览器的那份会引用刚被丢掉
 * 的键，代理也不会从 missingImages 里知道要补，下一轮又变回裂图。
 *
 * 确认走并发：`hasStoredImage` 未命中 5 分钟正缓存时要跨网发一次 R2 HEAD。
 * 一次补图可以带一整批（IMAGE_LIMIT = 96）；HEAD 之间互不相干，也不进入
 * StateHub 的串行提交队列。
 */
async function prepareImages(value: unknown, bucket: ImageBucket): Promise<Array<{ key: string; objectKey: string }>> {
  if (!Array.isArray(value) || !value.length) return [];

  const candidates: { key: string; objectKey: string }[] = [];
  for (const entry of value) {
    const raw = object(entry);
    // imageKey 是 Emby 侧的键（itemId:kind:tag:height），objectKey 是 R2 上那份
    // 字节的内容地址。两个键挨在一起，名字必须各自说清是谁的键。
    const key = imageKey(raw?.imageKey);
    if (!key || !raw) continue;

    const objectKey = text(raw.objectKey);
    if (!objectKey || !IMAGE_OBJECT_KEY.test(objectKey)) continue;
    candidates.push({ key, objectKey });
  }
  if (!candidates.length) return [];

  const confirmed = await Promise.all(
    candidates.map((candidate) => hasStoredImage(bucket, candidate.objectKey)),
  );

  return candidates.filter((_, index) => confirmed[index]);
}

export type PreparedEmbyReport = {
  source: "emby";
  receivedAt: number;
  resume?: StoredWatchingItem[];
  playing?: PreparedEmbyPlaying;
  images: Array<{ key: string; objectKey: string }>;
};

/**
 * 纯字段收敛和 R2 HEAD 都在上报入口完成，不进入 StateHub 的提交队列。
 * `images` 是上报器直传的那个桶（上报入口的 `env.IMAGES`），只 HEAD。
 */
export async function prepareEmbyReport(
  body: unknown,
  receivedAt: number,
  images: ImageBucket,
): Promise<PreparedEmbyReport> {
  const root = object(body);
  if (!root) throw new Error("请求体不是对象");

  const resume = object(root.resume);
  const list = resume && Array.isArray(resume.items)
    ? resume.items
      .map(reportItem)
      .filter((item): item is ReportItem => item != null)
      .map(normalize)
    : undefined;
  const playing = "playing" in root ? preparePlaying(root.playing, receivedAt) : undefined;
  const confirmed = await prepareImages(root.images, images);
  return { source: "emby", receivedAt, ...(list ? { resume: list } : {}), ...(playing ? { playing } : {}), images: confirmed };
}


/**
 * 规格里的字符串都是编码名、语言代码这类短标识。挡个长度，别让一条上报把任意
 * 长的文本存进 SQLite 再广播给每个在线的浏览器。
 */
const LABEL_LIMIT = 64;

function label(value: unknown): string | null {
  const raw = text(value);
  return raw ? raw.slice(0, LABEL_LIMIT) : null;
}

/** 非负整数才收：宽高、声道数、位深、码率没有小数和负数 */
function count(value: unknown): number | null {
  const raw = number(value);
  return raw != null && raw >= 0 ? Math.round(raw) : null;
}

type VideoRange = NonNullable<NonNullable<WatchingMedia["video"]>["range"]>;

const RANGES = new Set<VideoRange>(["sdr", "hdr", "hdr10", "hdr10plus", "dolby-vision", "hlg"]);

function videoRange(value: unknown): VideoRange | null {
  const raw = text(value);
  return raw && RANGES.has(raw as VideoRange) ? (raw as VideoRange) : null;
}

const PLAY_METHODS = new Set<WatchingPlayMethod>(["directplay", "directstream", "transcode"]);

function playMethod(value: unknown): WatchingPlayMethod | null {
  const raw = text(value);
  return raw && PLAY_METHODS.has(raw as WatchingPlayMethod) ? (raw as WatchingPlayMethod) : null;
}

/**
 * 上报器已经按会话选好了音轨和字幕，这里只按契约逐字段收敛，不猜、不补。
 * 整块不是对象就当没带 —— 旧版上报器不发这个字段，位置更新照收。
 */
function playbackMedia(value: unknown): WatchingMedia | null {
  const raw = object(value);
  if (!raw) return null;

  const video = object(raw.video);
  const audio = object(raw.audio);
  const subtitle = object(raw.subtitle);

  return {
    container: label(raw.container),
    bitrate: count(raw.bitrate),
    video: video
      ? {
          codec: label(video.codec),
          width: count(video.width),
          height: count(video.height),
          range: videoRange(video.range),
          bitDepth: count(video.bitDepth),
        }
      : null,
    audio: audio
      ? {
          codec: label(audio.codec),
          profile: label(audio.profile),
          channels: count(audio.channels),
          layout: label(audio.layout),
          language: label(audio.language),
        }
      : null,
    subtitle: subtitle
      ? {
          codec: label(subtitle.codec),
          language: label(subtitle.language),
          title: label(subtitle.title),
          forced: subtitle.forced === true,
          external: subtitle.external === true,
        }
      : null,
  };
}

/** 收下一次播放状态：先算，写留给 commit。`state` 为 null 表示没有会话在播了 */
export type PreparedEmbyPlaying = {
  outcome: "updated" | "cleared";
  state: EmbyNowPlaying | null;
  item: StoredWatchingItem | null;
};

function preparePlaying(value: unknown, receivedAt: number): PreparedEmbyPlaying {
  const raw = object(value);
  const itemId = text(raw?.itemId);
  if (!raw || !itemId) {
    return { outcome: "cleared", state: null, item: null };
  }

  const reported = reportItem(raw.item);
  const item = reported ? normalize(reported) : null;
  /**
   * 时间戳取本站收到的时刻，不用代理给的。
   * 进度是从这个锚点按真实时间往前推算的，两台机器的时钟差多少，推算就偏多少。
   */
  const state: EmbyNowPlaying = {
    itemId,
    paused: raw.paused === true,
    positionTicks: number(raw.positionTicks) ?? 0,
    runTimeTicks: number(raw.runTimeTicks) ?? 0,
    client: label(raw.client),
    deviceName: label(raw.deviceName),
    playMethod: playMethod(raw.playMethod),
    media: playbackMedia(raw.media),
    at: receivedAt,
  };

  return { outcome: "updated", state, item };
}
