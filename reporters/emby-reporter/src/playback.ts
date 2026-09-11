/**
 * 从 Emby 的会话和媒体源里挑出「正在放的这一路」：在哪放、怎么放、什么规格。
 *
 * 纯函数，不碰网络。会话说选了哪条音轨 / 字幕，这里就按下标取那一条；站点只收
 * 挑好的那几个字段，不收整份流列表 —— 一个条目动辄二十几条字幕流，而且外挂字幕
 * 流带着 NAS 的 SMB 路径，整份转出去就是把内网路径发到公网上。
 *
 * 字段一律逐个挑，不展开整个流对象，理由同上。
 */

export type EmbyMediaStream = {
  Type?: string;
  Codec?: string;
  Profile?: string;
  Index?: number;
  Width?: number;
  Height?: number;
  BitDepth?: number;
  /** 老字段，只有 SDR / HDR 两档 */
  VideoRange?: string;
  /** 4.7+ 的细分：None / Hdr10 / Hdr10Plus / DolbyVision / Hlg … */
  ExtendedVideoType?: string;
  Channels?: number;
  ChannelLayout?: string;
  Language?: string;
  Title?: string;
  IsDefault?: boolean;
  IsForced?: boolean;
  IsExternal?: boolean;
};

export type EmbyMediaSource = {
  Id?: string;
  Container?: string;
  Bitrate?: number;
  MediaStreams?: EmbyMediaStream[];
};

/** 会话里的 PlayState。PlayMethod 在没有 NowPlayingItem 的空闲会话上也会残留 */
export type EmbyPlayState = {
  PositionTicks?: number;
  IsPaused?: boolean;
  PlayMethod?: string;
  AudioStreamIndex?: number;
  SubtitleStreamIndex?: number;
  MediaSourceId?: string;
};

/** 条目或 NowPlayingItem 上和媒体有关的那几个字段 */
export type EmbyItemMedia = {
  Container?: string;
  Bitrate?: number;
  MediaStreams?: EmbyMediaStream[];
  MediaSources?: EmbyMediaSource[];
};

/* ── 站点 ingest 收的形状，和站点 lib/types 的 WatchingMedia 逐字对应 ── */

export type VideoRange = "sdr" | "hdr" | "hdr10" | "hdr10plus" | "dolby-vision" | "hlg";

export type PlaybackMedia = {
  container: string | null;
  bitrate: number | null;
  video: {
    codec: string | null;
    width: number | null;
    height: number | null;
    range: VideoRange | null;
    bitDepth: number | null;
  } | null;
  audio: {
    codec: string | null;
    profile: string | null;
    channels: number | null;
    layout: string | null;
    language: string | null;
  } | null;
  subtitle: {
    codec: string | null;
    language: string | null;
    title: string | null;
    forced: boolean;
    external: boolean;
  } | null;
};

export type PlayMethod = "directplay" | "directstream" | "transcode";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function lower(value: unknown): string | null {
  return text(value)?.toLowerCase() ?? null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

/** 小写、去掉分隔符，让 "Hdr10Plus" / "HDR10+" / "hdr10_plus" 落到同一个键 */
function key(value: unknown): string {
  return (text(value) ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * 播放方式只在真的在播时才算数：空闲会话上 PlayMethod 是上一次播放留下的。
 * 调用方保证传进来的会话带 NowPlayingItem。
 */
export function playMethod(state: EmbyPlayState | undefined): PlayMethod | null {
  const method = key(state?.PlayMethod);
  if (method === "directplay" || method === "directstream" || method === "transcode") {
    return method;
  }
  return null;
}

function videoRange(stream: EmbyMediaStream): VideoRange | null {
  const extended = key(stream.ExtendedVideoType);
  if (extended && extended !== "none") {
    if (extended === "hdr10") return "hdr10";
    if (extended === "hdr10plus") return "hdr10plus";
    if (extended === "dolbyvision") return "dolby-vision";
    if (extended === "hlg") return "hlg";
    // HdrVivid 之类：知道是 HDR，具体哪种不认
    return "hdr";
  }
  const range = key(stream.VideoRange);
  if (range === "hdr") return "hdr";
  if (range === "sdr") return "sdr";
  return null;
}

type StreamSource = {
  streams: EmbyMediaStream[];
  container: string | null;
  bitrate: number | null;
};

/**
 * 流列表取谁的：会话上 NowPlayingItem 若带流，那就是正在放的那份；否则按
 * PlayState.MediaSourceId 在条目的媒体源里找 —— 流下标是按媒体源算的，同一集的
 * BD / WEB 两个版本下标各不相同，拿错媒体源就会把音轨标错。
 */
function resolveSource(
  playState: EmbyPlayState | undefined,
  nowPlaying: EmbyItemMedia | undefined,
  item: EmbyItemMedia | null,
): StreamSource | null {
  const sources = item?.MediaSources ?? [];
  const wanted = text(playState?.MediaSourceId);
  const matched = (wanted && sources.find((source) => source.Id === wanted)) || null;

  if (nowPlaying?.MediaStreams?.length) {
    return {
      streams: nowPlaying.MediaStreams,
      container: lower(nowPlaying.Container) ?? lower(matched?.Container) ?? lower(item?.Container),
      bitrate: count(nowPlaying.Bitrate) ?? count(matched?.Bitrate) ?? count(item?.Bitrate),
    };
  }

  const chosen = matched ?? sources[0] ?? null;
  if (chosen?.MediaStreams?.length) {
    return {
      streams: chosen.MediaStreams,
      container: lower(chosen.Container) ?? lower(item?.Container),
      bitrate: count(chosen.Bitrate) ?? count(item?.Bitrate),
    };
  }

  if (item?.MediaStreams?.length) {
    return {
      streams: item.MediaStreams,
      container: lower(item.Container),
      bitrate: count(item.Bitrate),
    };
  }

  return null;
}

function ofType(streams: EmbyMediaStream[], type: string) {
  return streams.filter((stream) => stream.Type === type);
}

function byIndex(streams: EmbyMediaStream[], index: unknown) {
  if (typeof index !== "number" || !Number.isFinite(index)) return null;
  return streams.find((stream) => stream.Index === index) ?? null;
}

export function pickMedia(input: {
  playState: EmbyPlayState | undefined;
  nowPlaying: EmbyItemMedia | undefined;
  item: EmbyItemMedia | null;
}): PlaybackMedia | null {
  const source = resolveSource(input.playState, input.nowPlaying, input.item);
  if (!source) return null;

  const video = ofType(source.streams, "Video")[0] ?? null;

  // 会话说了选哪条就用哪条，没说就是默认轨，再没有就第一条
  const audios = ofType(source.streams, "Audio");
  const audio =
    byIndex(audios, input.playState?.AudioStreamIndex) ??
    audios.find((stream) => stream.IsDefault) ??
    audios[0] ??
    null;

  // 字幕只认会话明确选中的那条：没有下标、或 -1，都是没开字幕
  const subtitleIndex = input.playState?.SubtitleStreamIndex;
  const subtitle =
    typeof subtitleIndex === "number" && subtitleIndex >= 0
      ? byIndex(ofType(source.streams, "Subtitle"), subtitleIndex)
      : null;

  return {
    container: source.container,
    bitrate: source.bitrate,
    video: video
      ? {
          codec: lower(video.Codec),
          width: count(video.Width),
          height: count(video.Height),
          range: videoRange(video),
          bitDepth: count(video.BitDepth),
        }
      : null,
    audio: audio
      ? {
          codec: lower(audio.Codec),
          profile: text(audio.Profile),
          channels: count(audio.Channels),
          layout: text(audio.ChannelLayout),
          language: text(audio.Language),
        }
      : null,
    subtitle: subtitle
      ? {
          codec: lower(subtitle.Codec),
          language: text(subtitle.Language),
          title: text(subtitle.Title),
          forced: subtitle.IsForced === true,
          external: subtitle.IsExternal === true,
        }
      : null,
  };
}
