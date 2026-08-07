import { cached } from "@/lib/cache";
import {
  getNowPlaying,
  setNowPlaying,
  TICKS_PER_MS,
  type ResolvedNowPlaying,
} from "@/lib/emby-store";
import { embyImageUrl, type ImageKind } from "@/lib/image-proxy";
import type { WatchingItem } from "@/lib/types";

/**
 * Emby「最近在看」。
 *
 * 两个数据源合成：
 * - Users/{id}/Items/Resume —— 未看完的续播列表，本站定时拉
 * - Emby 的 webhook        —— 开播/暂停/停止时主动通知本站，用来打实时标记。
 *   以前是轮询 /emby/Sessions，现在不轮询了，见 lib/emby-store.ts
 */

const RESUME_TTL_MS = 60_000;
/**
 * 播放中时才会用到的会话查询。
 * Emby 拖动进度条不发任何 webhook（播放事件只有 start/pause/unpause/stop），
 * 想跟上 seek 只能主动问。缓存很短是为了跟手；没在播时一次都不会发。
 */
const SESSION_TTL_MS = 2_000;

const TIMEOUT_MS = 6_000;
const ITEM_FIELDS = [
  "ProductionYear",
  "SeriesPrimaryImage",
  "BasicSyncInfo",
  "UserDataPlayCount",
].join(",");

type EmbyItem = {
  Id?: string;
  Name?: string;
  ServerId?: string;
  Type?: string;
  SeriesName?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  ProductionYear?: number;
  RunTimeTicks?: number;
  ImageTags?: { Primary?: string; Thumb?: string };
  BackdropImageTags?: string[];
  ParentBackdropImageTags?: string[];
  ParentBackdropItemId?: string;
  ParentThumbItemId?: string;
  ParentThumbImageTag?: string;
  SeriesPrimaryImageTag?: string;
  SeriesId?: string;
  UserData?: {
    PlayedPercentage?: number;
    PlaybackPositionTicks?: number;
    LastPlayedDate?: string;
  };
};

function config() {
  const url = (process.env.EMBY_URL ?? "").replace(/\/+$/, "");
  const key = process.env.EMBY_API_KEY ?? "";
  const userId = process.env.EMBY_USER_ID ?? "";

  const missing: string[] = [];
  if (!url) missing.push("EMBY_URL");
  if (!key) missing.push("EMBY_API_KEY");
  if (!userId) missing.push("EMBY_USER_ID");
  if (missing.length) throw new Error(`缺少 Emby 配置：${missing.join("、")}`);

  // 内网地址用于服务端取数；publicUrl 只用来拼「在 Emby 里打开」的跳转链接，
  // 图片已经改走本站的签名代理，不再需要浏览器能直连 Emby
  const publicUrl = (process.env.EMBY_PUBLIC_URL ?? url).replace(/\/+$/, "");
  return { url, key, userId, publicUrl };
}

async function embyFetch<T>(path: string, key: string): Promise<T> {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${path}${separator}api_key=${encodeURIComponent(key)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Emby 返回 ${response.status}`);
  return response.json() as Promise<T>;
}

/**
 * 图片一律走本站的签名代理，不给前端 Emby 直链 ——
 * 既不暴露源站，页面套上 CDN 后图片也能一起被缓存。
 */
function imageUrl(
  itemId: string | undefined,
  kind: ImageKind,
  tag: string | undefined,
  height: number,
): string | null {
  if (!itemId || !tag) return null;
  return embyImageUrl({ id: itemId, kind, tag, height });
}

/** 横版图，按 Thumb → 父级 Thumb → Backdrop → 父级 Backdrop 依次退让 */
function resolveBackdrop(item: EmbyItem, height = 400): string | null {
  const candidates: Array<[string | undefined, ImageKind, string | undefined]> = [
    [item.Id, "Thumb", item.ImageTags?.Thumb],
    [item.ParentThumbItemId, "Thumb", item.ParentThumbImageTag],
    [item.Id, "Backdrop", item.BackdropImageTags?.[0]],
    [item.ParentBackdropItemId, "Backdrop", item.ParentBackdropImageTags?.[0]],
  ];

  for (const [id, kind, tag] of candidates) {
    const url = imageUrl(id, kind, tag, height);
    if (url) return url;
  }
  return null;
}

/** 竖版海报。剧集自身的 Primary 是剧照，所以优先取剧集所属剧的海报 */
function resolvePoster(item: EmbyItem, height = 600): string | null {
  if (item.Type === "Episode") {
    const series = imageUrl(item.SeriesId, "Primary", item.SeriesPrimaryImageTag, height);
    if (series) return series;
  }
  return imageUrl(item.Id, "Primary", item.ImageTags?.Primary, height);
}

function resolveProgress(item: EmbyItem): number {
  const userData = item.UserData ?? {};
  const percentage = Number(userData.PlayedPercentage);
  if (userData.PlayedPercentage != null && !Number.isNaN(percentage)) {
    return Math.min(100, Math.max(0, percentage));
  }

  const position = Number(userData.PlaybackPositionTicks) || 0;
  const runtime = Number(item.RunTimeTicks) || 0;
  if (!runtime) return 0;
  return Math.min(100, Math.max(0, (position / runtime) * 100));
}

function normalizeType(type: string | undefined): WatchingItem["type"] {
  if (type === "Episode" || type === "Movie" || type === "Series") return type;
  return "Other";
}

function normalize(item: EmbyItem, publicUrl: string): WatchingItem {
  const name = item.Name ?? "";
  const season = item.ParentIndexNumber;
  const episode = item.IndexNumber;

  let title: string;
  let subtitle: string;

  if (item.Type === "Episode") {
    // 剧集展示剧名当标题，「S1:E5 - 集标题」当副标题
    title = item.SeriesName || name;
    const label =
      season != null && episode != null
        ? `S${season}:E${episode}`
        : episode != null
          ? `E${episode}`
          : null;
    subtitle = [label, name].filter(Boolean).join(" · ");
  } else {
    title = name;
    subtitle = item.ProductionYear != null ? String(item.ProductionYear) : "";
  }

  return {
    id: item.Id ?? "",
    title,
    subtitle,
    progress: resolveProgress(item),
    poster: resolvePoster(item),
    backdrop: resolveBackdrop(item),
    type: normalizeType(item.Type),
    year: item.ProductionYear ?? null,
    link: item.Id
      ? `${publicUrl}/web/index.html#!/item?id=${item.Id}${item.ServerId ? `&serverId=${item.ServerId}` : ""}`
      : null,
    playedAt: item.UserData?.LastPlayedDate ?? null,
  };
}

/**
 * 「最近在看」和「正在播放」拆成两份，因为它们的数据源和刷新节奏根本不同：
 * 前者是后端定时轮询 Emby 的 Resume 列表（有 RESUME_TTL_MS 缓存），
 * 后者纯粹由 Emby 的 webhook 驱动，本站不轮询。
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

export async function getWatching({ limit = 8 } = {}): Promise<WatchingPayload> {
  const { url, key, userId, publicUrl } = config();

  const items = await cached(`emby:resume:${limit}`, RESUME_TTL_MS, async () => {
    const params = new URLSearchParams({
      Limit: String(limit),
      MediaTypes: "Video",
      Fields: ITEM_FIELDS,
    });
    const data = await embyFetch<{ Items?: EmbyItem[] }>(
      `${url}/emby/Users/${userId}/Items/Resume?${params}`,
      key,
    );
    return (data.Items ?? []).map((item) => normalize(item, publicUrl));
  });

  return { items };
}

/** webhook 驱动，空闲时零请求 —— 没在播就什么上游都不打 */
export async function getNowWatching(): Promise<NowWatchingPayload> {
  const live = await getNowPlaying();
  if (!live) return { nowPlaying: null, current: null };

  const { url, key, userId, publicUrl } = config();
  // 单项详情只负责卡片文案和图片，实时进度仍以 webhook / Sessions 为准
  const current = await cached(`emby:item:${live.itemId}`, RESUME_TTL_MS, async () => {
    const params = new URLSearchParams({ Fields: ITEM_FIELDS });
    const item = await embyFetch<EmbyItem>(
      `${url}/emby/Users/${userId}/Items/${encodeURIComponent(live.itemId)}?${params}`,
      key,
    );
    return normalize(item, publicUrl);
  });

  // 播放中：顺带核对一次真实位置，把 seek 造成的偏差拉回来
  return { nowPlaying: await syncPosition(live, url, key, userId), current };
}

/** 用 Sessions 校正播放位置。只在已知播放中时调用，空闲时零请求 */
async function syncPosition(
  live: ResolvedNowPlaying,
  url: string,
  key: string,
  userId: string,
): Promise<ResolvedNowPlaying> {
  try {
    const sessions = await cached(`emby:session-position`, SESSION_TTL_MS, () =>
      embyFetch<
        Array<{
          UserId?: string;
          NowPlayingItem?: { Id?: string; RunTimeTicks?: number };
          PlayState?: { PositionTicks?: number; IsPaused?: boolean };
        }>
      >(`${url}/emby/Sessions`, key),
    );

    const session = sessions.find(
      (entry) =>
        entry.UserId === userId && String(entry.NowPlayingItem?.Id ?? "") === live.itemId,
    );
    if (!session?.NowPlayingItem?.Id) return live;

    const positionTicks = Number(session.PlayState?.PositionTicks) || 0;
    const runTimeTicks = Number(session.NowPlayingItem.RunTimeTicks) || 0;
    const paused = Boolean(session.PlayState?.IsPaused);

    // 写回存储：这样即便下一拍查不到会话，推算也是从校正后的锚点开始
    await setNowPlaying({
      itemId: live.itemId,
      paused,
      positionTicks,
      runTimeTicks,
      device: live.device,
      at: Date.now(),
    });

    return {
      itemId: live.itemId,
      paused,
      progress: runTimeTicks ? Math.min(100, (positionTicks / runTimeTicks) * 100) : null,
      device: live.device,
      positionMs: positionTicks / TICKS_PER_MS,
      durationMs: runTimeTicks ? runTimeTicks / TICKS_PER_MS : null,
    };
  } catch {
    // Sessions 挂了不该影响展示，沿用推算值
    return live;
  }
}
