import type { WatchingMedia } from "@/lib/types";

/**
 * 「正在播放」那条横幅上的两样东西：在哪放（客户端、设备各一个标签）和放的是
 * 什么规格（一串短标签）。上报器只给 Emby 说的原话 —— 编码名、语言代码、像素尺寸 ——
 * 这里把它们拼成人看的样子。纯函数，卡片和测试共用。
 *
 * 播放方式（直接播放 / 直接串流 / 转码）和字幕不进标签：前者说的是 Emby 怎么送的，
 * 后者太细；信封里照旧带着，只是卡片不画。
 */

/**
 * 客户端名去掉运行模式和登录方式的后缀：Infuse 按播放方式自报 Infuse-Direct /
 * Infuse-Download，网页端经反代登录时是 Emby Web (oauth2)。那些是它们怎么连上
 * Emby 的，不是「在哪放」。
 */
function clientName(client: string | null): string | null {
  if (!client) return null;
  const cleaned = client
    .replace(/^infuse-.*$/i, "Infuse")
    .replace(/\s*\((?:oauth2|direct)\)\s*$/i, "")
    .trim();
  return cleaned || null;
}

/** 客户端和设备各一个标签（["Infuse", "iPad"]）；两个一样就只留一个，都没有就是空 */
export function describeDevice(client: string | null, deviceName: string | null): string[] {
  const app = clientName(client);
  const device = deviceName?.trim() || null;
  if (app && device && app.toLowerCase() !== device.toLowerCase()) return [app, device];
  const only = app ?? device;
  return only ? [only] : [];
}

const VIDEO_CODECS: Record<string, string> = {
  hevc: "HEVC",
  h265: "HEVC",
  h264: "H.264",
  avc: "H.264",
  av1: "AV1",
  vp9: "VP9",
  vc1: "VC-1",
  mpeg2video: "MPEG-2",
  mpeg4: "MPEG-4",
};

const AUDIO_CODECS: Record<string, string> = {
  eac3: "DD+",
  ac3: "DD",
  truehd: "TrueHD",
  dts: "DTS",
  aac: "AAC",
  flac: "FLAC",
  alac: "ALAC",
  opus: "Opus",
  vorbis: "Vorbis",
  mp3: "MP3",
  mp2: "MP2",
};

const RANGES: Record<NonNullable<NonNullable<WatchingMedia["video"]>["range"]>, string | null> = {
  // SDR 是常态，不值得占一个标签
  sdr: null,
  hdr: "HDR",
  hdr10: "HDR10",
  hdr10plus: "HDR10+",
  "dolby-vision": "Dolby Vision",
  hlg: "HLG",
};

function resolution(video: NonNullable<WatchingMedia["video"]>): string | null {
  const width = video.width ?? 0;
  const height = video.height ?? 0;
  if (!width && !height) return null;
  // 按标准档归类：片源常有黑边裁切，1920×804 也是 1080p，不能只看高
  if (width >= 7600 || height >= 4300) return "8K";
  if (width >= 3800 || height >= 2100) return "4K";
  if (width >= 2500 || height >= 1400) return "1440p";
  if (width >= 1900 || height >= 1000) return "1080p";
  if (width >= 1200 || height >= 700) return "720p";
  return `${height || width}p`;
}

function videoCodec(codec: string | null): string | null {
  if (!codec) return null;
  return VIDEO_CODECS[codec] ?? codec.toUpperCase();
}

function channelLayout(audio: NonNullable<WatchingMedia["audio"]>): string | null {
  if (audio.layout) return audio.layout;
  switch (audio.channels) {
    case null:
      return null;
    case 1:
      return "1.0";
    case 2:
      return "2.0";
    case 6:
      return "5.1";
    case 8:
      return "7.1";
    default:
      return `${audio.channels}ch`;
  }
}

/**
 * 音轨标签。DTS 一家的 profile（DTS-HD MA / DTS-HD HRA / DTS:X）比编码名信息多，
 * 直接用；带 Atmos 的接在编码名后面；其余 profile（AAC 的 LC 之类）没人关心。
 */
function audioLabel(audio: NonNullable<WatchingMedia["audio"]>): string | null {
  const codec = audio.codec ? (AUDIO_CODECS[audio.codec] ?? audio.codec.toUpperCase()) : null;
  const profile = audio.profile?.trim() || null;
  const base = profile && /^dts/i.test(profile)
    ? profile
    : profile && /atmos/i.test(profile) && codec
      ? `${codec} Atmos`
      : codec;
  if (!base) return null;
  const layout = channelLayout(audio);
  return layout ? `${base} ${layout}` : base;
}

function bitrate(bps: number | null): string | null {
  if (bps == null || bps <= 0) return null;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(bps / 1_000)} kbps`;
}

/**
 * 规格标签，按「看一眼最想知道的」排：分辨率和视频编码合成一个（「1080p HEVC」，
 * 缺一边就只写另一边），然后动态范围、音轨、码率。没有的那项直接跳过，不占位。
 * 字幕不进标签：信封里照旧带着，卡片不画。
 */
export function describeMedia(media: WatchingMedia | null): string[] {
  const chips: Array<string | null> = [];
  if (media?.video) {
    const picture = [resolution(media.video), videoCodec(media.video.codec)]
      .filter((part): part is string => Boolean(part))
      .join(" ");
    chips.push(picture || null);
    chips.push(media.video.range ? RANGES[media.video.range] : null);
  }
  if (media?.audio) chips.push(audioLabel(media.audio));
  chips.push(bitrate(media?.bitrate ?? null));
  return chips.filter((chip): chip is string => Boolean(chip));
}
