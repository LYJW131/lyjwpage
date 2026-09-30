import type { EmbyNowPlaying, StoredWatchingItem } from "@/lib/emby-store";
import { IMAGE_OBJECT_KEY } from "@/lib/asset-url";
import { number, object, text } from "@/lib/json";
import type { WatchingItem, WatchingMedia, WatchingPlayMethod } from "@/lib/types";

import { hasStoredImage, type ImageBucket } from "./r2-assets";


const IMAGE_KEY = /^[A-Za-z0-9:_.-]{1,160}$/;


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

// 普通对象读取这些键会命中原型，可能把 Object.prototype 当作图片地址。
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

function link(item: ReportItem): string | null {
  const base = (process.env.EMBY_PUBLIC_URL ?? "").replace(/\/+$/, "");
  if (!base || !item.id) return null;
  const id = encodeURIComponent(item.id);
  const server = item.serverId ? `&serverId=${encodeURIComponent(item.serverId)}` : "";
  return `${base}/web/index.html#!/item?id=${id}${server}`;
}

function normalize(item: ReportItem): StoredWatchingItem {
  let title: string;
  let subtitle: string;

  if (item.type === "Episode") {
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

async function prepareImages(value: unknown, bucket: ImageBucket): Promise<Array<{ key: string; objectKey: string }>> {
  if (!Array.isArray(value) || !value.length) return [];

  const candidates: { key: string; objectKey: string }[] = [];
  for (const entry of value) {
    const raw = object(entry);
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


const LABEL_LIMIT = 64;

function label(value: unknown): string | null {
  const raw = text(value);
  return raw ? raw.slice(0, LABEL_LIMIT) : null;
}

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
  // 进度用本站接收时刻作锚，避免上报器时钟偏差被算进播放进度。
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
