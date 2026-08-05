import { cached } from "@/lib/cache";
import type { WatchingItem } from "@/lib/types";

/**
 * Emby「最近在看」。
 *
 * 两个数据源合成：
 * - Users/{id}/Items/Resume —— 未看完的续播列表（小时级变化）
 * - Sessions               —— 此刻真正在播放的会话，用来给某一条打实时标记
 */

const RESUME_TTL_MS = 60_000;
/** 正在播放的状态要跟手一些 */
const SESSIONS_TTL_MS = 10_000;
const TIMEOUT_MS = 6_000;

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

type EmbySession = {
  UserId?: string;
  Client?: string;
  DeviceName?: string;
  NowPlayingItem?: { Id?: string; RunTimeTicks?: number };
  PlayState?: { IsPaused?: boolean; PositionTicks?: number };
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

  // 内网地址用于服务端取数，图片和跳转链接要用浏览器能访问到的公网地址
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

function imageUrl(
  baseUrl: string,
  itemId: string | undefined,
  kind: string,
  tag: string | undefined,
  maxHeight: number,
): string | null {
  if (!itemId || !tag) return null;
  const params = new URLSearchParams({ tag, maxHeight: String(maxHeight) });
  return `${baseUrl}/emby/Items/${itemId}/Images/${kind}?${params}`;
}

/** 横版图，按 Thumb → 父级 Thumb → Backdrop → 父级 Backdrop 依次退让 */
function resolveBackdrop(baseUrl: string, item: EmbyItem, maxHeight = 400): string | null {
  const candidates: Array<[string | undefined, string, string | undefined]> = [
    [item.Id, "Thumb", item.ImageTags?.Thumb],
    [item.ParentThumbItemId, "Thumb", item.ParentThumbImageTag],
    [item.Id, "Backdrop", item.BackdropImageTags?.[0]],
    [item.ParentBackdropItemId, "Backdrop", item.ParentBackdropImageTags?.[0]],
  ];

  for (const [id, kind, tag] of candidates) {
    const url = imageUrl(baseUrl, id, kind, tag, maxHeight);
    if (url) return url;
  }
  return null;
}

/** 竖版海报。剧集自身的 Primary 是剧照，所以优先取剧集所属剧的海报 */
function resolvePoster(baseUrl: string, item: EmbyItem, maxHeight = 600): string | null {
  if (item.Type === "Episode") {
    const series = imageUrl(baseUrl, item.SeriesId, "Primary", item.SeriesPrimaryImageTag, maxHeight);
    if (series) return series;
  }
  return imageUrl(baseUrl, item.Id, "Primary", item.ImageTags?.Primary, maxHeight);
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
    poster: resolvePoster(publicUrl, item),
    backdrop: resolveBackdrop(publicUrl, item),
    type: normalizeType(item.Type),
    year: item.ProductionYear ?? null,
    link: item.Id
      ? `${publicUrl}/web/index.html#!/item?id=${item.Id}${item.ServerId ? `&serverId=${item.ServerId}` : ""}`
      : null,
    playedAt: item.UserData?.LastPlayedDate ?? null,
  };
}

export type WatchingPayload = {
  items: WatchingItem[];
  /** 此刻正在播放的那一条，附带设备与暂停状态 */
  nowPlaying: {
    itemId: string;
    paused: boolean;
    progress: number | null;
    device: string;
  } | null;
};

export async function getWatching({ limit = 8 } = {}): Promise<WatchingPayload> {
  const { url, key, userId, publicUrl } = config();

  const items = await cached(`emby:resume:${limit}`, RESUME_TTL_MS, async () => {
    const params = new URLSearchParams({
      Limit: String(limit),
      MediaTypes: "Video",
      Fields: [
        "ProductionYear",
        "SeriesPrimaryImage",
        "BasicSyncInfo",
        "UserDataPlayCount",
      ].join(","),
    });
    const data = await embyFetch<{ Items?: EmbyItem[] }>(
      `${url}/emby/Users/${userId}/Items/Resume?${params}`,
      key,
    );
    return (data.Items ?? []).map((item) => normalize(item, publicUrl));
  });

  // Sessions 挂了不该拖垮整个列表 —— 没有实时标记只是少个锦上添花
  let nowPlaying: WatchingPayload["nowPlaying"] = null;
  try {
    const sessions = await cached(`emby:sessions`, SESSIONS_TTL_MS, () =>
      embyFetch<EmbySession[]>(`${url}/emby/Sessions`, key),
    );

    // 必须在续播列表里反查，不能「随便找一个有 NowPlayingItem 的会话」：
    // Sessions 里混着 DLNA 投屏、qbittorrent、auth_proxy 这些没有 UserId 的
    // 条目，而多个会话同时有 NowPlayingItem 时 find 取到的是任意一个 ——
    // 取错了就等于真正在看的那条拿不到实时标记。
    const resumeIds = new Set(items.map((item) => item.id));
    const session = sessions.find(
      (entry) =>
        entry.UserId === userId &&
        entry.NowPlayingItem?.Id &&
        resumeIds.has(String(entry.NowPlayingItem.Id)),
    );

    if (session?.NowPlayingItem?.Id) {
      const runtime = Number(session.NowPlayingItem.RunTimeTicks) || 0;
      const position = Number(session.PlayState?.PositionTicks) || 0;

      nowPlaying = {
        itemId: String(session.NowPlayingItem.Id),
        paused: Boolean(session.PlayState?.IsPaused),
        progress: runtime > 0 ? Math.min(100, (position / runtime) * 100) : null,
        device: session.Client || session.DeviceName || "",
      };
    }
  } catch {
    nowPlaying = null;
  }

  return { items, nowPlaying };
}
