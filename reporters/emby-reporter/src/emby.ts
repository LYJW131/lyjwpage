import { config } from "./config.js";

/**
 * Emby 这一侧：拉数据、挑图、把条目压成站点要的形状。
 *
 * 站点只收「Emby 说了什么」，不收「该怎么显示」—— 标题拼法和跳转链接都在站点
 * 那边做。但图片必须在这里挑：字节是这边下载的，选哪张的逻辑跟着走才不会分家。
 */

const ITEM_FIELDS = [
  "ProductionYear",
  "SeriesPrimaryImage",
  "BasicSyncInfo",
  "UserDataPlayCount",
].join(",");

/** Emby 的 tick 是 100 纳秒，1 毫秒 = 10000 tick */
export const TICKS_PER_MS = 10_000;

type ImageKind = "Primary" | "Backdrop" | "Thumb";

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

export type EmbySession = {
  UserId?: string;
  Client?: string;
  DeviceName?: string;
  NowPlayingItem?: { Id?: string; RunTimeTicks?: number };
  PlayState?: { PositionTicks?: number; IsPaused?: boolean };
};

/** 站点 ingest 收的条目形状 */
export type ReportItem = {
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

/** 取一张图需要的全部信息。key 里带着 ImageTag，图换了 key 就换 */
export type ImageRef = {
  key: string;
  itemId: string;
  kind: ImageKind;
  tag: string;
  height: number;
};

export type MappedItem = {
  item: ReportItem;
  images: ImageRef[];
};

/**
 * 密钥走 `X-Emby-Token` 请求头，不挂在 query 上：query 会原样写进 Emby 的
 * access log，也写进中间任何一层代理的日志。
 *
 * 取图那条二进制路径也走这个函数，换头之后两条一起变，验的时候两条都要看一眼。
 */
async function embyFetch(path: string, accept: "json" | "binary") {
  const response = await fetch(`${config.emby.url}${path}`, {
    headers: { "X-Emby-Token": config.emby.key },
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  if (!response.ok) throw new Error(`Emby 返回 ${response.status}`);
  return accept === "json" ? response.json() : response.arrayBuffer();
}

function imageRef(
  itemId: string | undefined,
  kind: ImageKind,
  tag: string | undefined,
  height: number,
): ImageRef | null {
  if (!itemId || !tag) return null;
  return { key: `${itemId}:${kind}:${tag}:${height}`, itemId, kind, tag, height };
}

/** 横版图，按 Thumb → 父级 Thumb → Backdrop → 父级 Backdrop 依次退让 */
function resolveBackdrop(item: EmbyItem): ImageRef | null {
  const height = config.backdropHeight;
  const candidates: Array<ImageRef | null> = [
    imageRef(item.Id, "Thumb", item.ImageTags?.Thumb, height),
    imageRef(item.ParentThumbItemId, "Thumb", item.ParentThumbImageTag, height),
    imageRef(item.Id, "Backdrop", item.BackdropImageTags?.[0], height),
    imageRef(item.ParentBackdropItemId, "Backdrop", item.ParentBackdropImageTags?.[0], height),
  ];
  return candidates.find((ref): ref is ImageRef => ref != null) ?? null;
}

/** 竖版海报。剧集自身的 Primary 是剧照，所以优先取剧集所属剧的海报 */
function resolvePoster(item: EmbyItem): ImageRef | null {
  const height = config.posterHeight;
  if (item.Type === "Episode") {
    const series = imageRef(item.SeriesId, "Primary", item.SeriesPrimaryImageTag, height);
    if (series) return series;
  }
  return imageRef(item.Id, "Primary", item.ImageTags?.Primary, height);
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

function text(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function finite(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapItem(raw: EmbyItem): MappedItem | null {
  if (!raw.Id) return null;

  const poster = resolvePoster(raw);
  const backdrop = resolveBackdrop(raw);

  return {
    item: {
      id: raw.Id,
      name: raw.Name ?? "",
      type: text(raw.Type),
      serverId: text(raw.ServerId),
      seriesName: text(raw.SeriesName),
      season: finite(raw.ParentIndexNumber),
      episode: finite(raw.IndexNumber),
      year: finite(raw.ProductionYear),
      progress: resolveProgress(raw),
      playedAt: text(raw.UserData?.LastPlayedDate),
      posterKey: poster?.key ?? null,
      backdropKey: backdrop?.key ?? null,
    },
    images: [poster, backdrop].filter((ref): ref is ImageRef => ref != null),
  };
}

export async function fetchResume(): Promise<MappedItem[]> {
  const params = new URLSearchParams({
    Limit: String(config.resumeLimit),
    MediaTypes: "Video",
    Fields: ITEM_FIELDS,
  });
  const data = (await embyFetch(
    `/emby/Users/${config.emby.userId}/Items/Resume?${params}`,
    "json",
  )) as { Items?: EmbyItem[] };

  return (data.Items ?? []).flatMap((raw) => mapItem(raw) ?? []);
}

/** 单集详情。会话接口给的 NowPlayingItem 字段不全，挑图要的 tag 都不在里面 */
export async function fetchItem(itemId: string): Promise<MappedItem | null> {
  const params = new URLSearchParams({ Fields: ITEM_FIELDS });
  const raw = (await embyFetch(
    `/emby/Users/${config.emby.userId}/Items/${encodeURIComponent(itemId)}?${params}`,
    "json",
  )) as EmbyItem;
  return mapItem(raw);
}

/** 只关心配置里那个用户的会话，别把家里其他人在看什么推出去 */
export async function fetchSession(): Promise<EmbySession | null> {
  const sessions = (await embyFetch("/emby/Sessions", "json")) as EmbySession[];
  return (
    sessions.find(
      (session) => session.UserId === config.emby.userId && session.NowPlayingItem?.Id,
    ) ?? null
  );
}

/** 取原始字节；压缩和 R2 上传由上报器的 r2 模块一次完成。 */
export async function fetchImage(ref: ImageRef): Promise<Buffer> {
  const params = new URLSearchParams({ tag: ref.tag, maxHeight: String(ref.height) });
  const buffer = (await embyFetch(
    `/emby/Items/${ref.itemId}/Images/${ref.kind}?${params}`,
    "binary",
  )) as ArrayBuffer;
  return Buffer.from(buffer);
}
