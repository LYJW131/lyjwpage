import { config } from "./config.js";
import type { EmbyItemMedia, EmbyPlayState } from "./playback.js";


const ITEM_FIELDS = [
  "ProductionYear",
  "SeriesPrimaryImage",
  "BasicSyncInfo",
  "UserDataPlayCount",
].join(",");

const PLAYING_FIELDS = `${ITEM_FIELDS},MediaSources,MediaStreams`;

export const TICKS_PER_MS = 10_000;

type ImageKind = "Primary" | "Backdrop" | "Thumb";

type EmbyItem = EmbyItemMedia & {
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
  NowPlayingItem?: EmbyItemMedia & { Id?: string; RunTimeTicks?: number };
  PlayState?: EmbyPlayState;
};

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
  media?: EmbyItemMedia;
};

// Token 放 query 会泄漏到 Emby 和代理的访问日志，取图也必须走请求头。
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

// 剧集的 Primary 是剧照；竖版海报必须优先取所属剧的 Primary。
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

export async function fetchItem(itemId: string): Promise<MappedItem | null> {
  const params = new URLSearchParams({ Fields: PLAYING_FIELDS });
  const raw = (await embyFetch(
    `/emby/Users/${config.emby.userId}/Items/${encodeURIComponent(itemId)}?${params}`,
    "json",
  )) as EmbyItem;
  const mapped = mapItem(raw);
  if (!mapped) return null;
  return {
    ...mapped,
    media: {
      Container: raw.Container,
      Bitrate: raw.Bitrate,
      MediaStreams: raw.MediaStreams,
      MediaSources: raw.MediaSources,
    },
  };
}

export async function fetchSession(): Promise<EmbySession | null> {
  const sessions = (await embyFetch("/emby/Sessions", "json")) as EmbySession[];
  return (
    sessions.find(
      (session) => session.UserId === config.emby.userId && session.NowPlayingItem?.Id,
    ) ?? null
  );
}

export async function fetchImage(ref: ImageRef): Promise<Buffer> {
  const params = new URLSearchParams({ tag: ref.tag, maxHeight: String(ref.height) });
  const buffer = (await embyFetch(
    `/emby/Items/${ref.itemId}/Images/${ref.kind}?${params}`,
    "binary",
  )) as ArrayBuffer;
  return Buffer.from(buffer);
}
