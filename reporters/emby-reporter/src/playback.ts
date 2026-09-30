// 必须逐字段挑选，完整媒体流可能带 NAS/SMB 路径，不能随报文公开。

export type EmbyMediaStream = {
  Type?: string;
  Codec?: string;
  Profile?: string;
  Index?: number;
  Width?: number;
  Height?: number;
  BitDepth?: number;
  VideoRange?: string;
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

export type EmbyPlayState = {
  PositionTicks?: number;
  IsPaused?: boolean;
  PlayMethod?: string;
  AudioStreamIndex?: number;
  SubtitleStreamIndex?: number;
  MediaSourceId?: string;
};

export type EmbyItemMedia = {
  Container?: string;
  Bitrate?: number;
  MediaStreams?: EmbyMediaStream[];
  MediaSources?: EmbyMediaSource[];
};


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

function key(value: unknown): string {
  return (text(value) ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// 空闲会话会残留上次的 PlayMethod；只有存在 NowPlayingItem 时它才有效。
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

// 流下标只在所属媒体源内有效；同一集不同版本的音轨下标不能互换。
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

  const audios = ofType(source.streams, "Audio");
  const audio =
    byIndex(audios, input.playState?.AudioStreamIndex) ??
    audios.find((stream) => stream.IsDefault) ??
    audios[0] ??
    null;

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
