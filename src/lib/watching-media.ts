import type { WatchingMedia, WatchingPlayMethod } from "@/lib/types";

/**
 * 「正在播放」那条横幅上的两样东西：在哪放（客户端 · 设备）和放的是什么规格
 * （一串短标签）。上报器只给 Emby 说的原话 —— 编码名、语言代码、像素尺寸 ——
 * 这里把它们拼成人看的样子。纯函数，卡片和测试共用。
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

/** 「Infuse · iPad」；两个一样就只留一个，都没有就是 null */
export function describeDevice(client: string | null, deviceName: string | null): string | null {
  const app = clientName(client);
  const device = deviceName?.trim() || null;
  if (app && device && app.toLowerCase() !== device.toLowerCase()) return `${app} · ${device}`;
  return app ?? device;
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

const PLAY_METHODS: Record<WatchingPlayMethod, string> = {
  directplay: "直接播放",
  directstream: "直接串流",
  transcode: "转码",
};

/**
 * Emby 给的语言多是 ISO 639-2 的三字母代码（含 chi / fre / ger 这类书目码），
 * 外挂字幕按文件名给的又可能是 zh-CN。Intl.DisplayNames 认不全书目码，
 * 常见的直接查表，查不到的原样大写。
 */
const LANGUAGES: Record<string, string> = {
  zh: "中文",
  chi: "中文",
  zho: "中文",
  ja: "日文",
  jpn: "日文",
  en: "英文",
  eng: "英文",
  ko: "韩文",
  kor: "韩文",
  fr: "法文",
  fre: "法文",
  fra: "法文",
  de: "德文",
  ger: "德文",
  deu: "德文",
  es: "西班牙文",
  spa: "西班牙文",
  it: "意大利文",
  ita: "意大利文",
  ru: "俄文",
  rus: "俄文",
  pt: "葡萄牙文",
  por: "葡萄牙文",
  th: "泰文",
  tha: "泰文",
  vi: "越南文",
  vie: "越南文",
};

function languageName(code: string | null): string | null {
  if (!code) return null;
  const normalized = code.trim().toLowerCase();
  // zh-CN / zh-Hant 这类先按主语言查
  const primary = normalized.split(/[-_]/)[0];
  return LANGUAGES[normalized] ?? LANGUAGES[primary] ?? normalized.toUpperCase();
}

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

function subtitleLabel(subtitle: NonNullable<WatchingMedia["subtitle"]>): string {
  const language = languageName(subtitle.language) ?? subtitle.title?.trim() ?? "";
  return `${language}${subtitle.forced ? "强制" : ""}字幕`;
}

function bitrate(bps: number | null): string | null {
  if (bps == null || bps <= 0) return null;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(bps / 1_000)} kbps`;
}

/**
 * 规格标签，按「看一眼最想知道的」排：分辨率、动态范围、视频编码、音轨、字幕、
 * 播放方式、码率。没有的那项直接跳过，不占位。
 */
export function describeMedia(
  media: WatchingMedia | null,
  playMethod: WatchingPlayMethod | null,
): string[] {
  const chips: Array<string | null> = [];
  if (media?.video) {
    chips.push(resolution(media.video));
    chips.push(media.video.range ? RANGES[media.video.range] : null);
    chips.push(videoCodec(media.video.codec));
  }
  if (media?.audio) chips.push(audioLabel(media.audio));
  if (media?.subtitle) chips.push(subtitleLabel(media.subtitle));
  if (playMethod) chips.push(PLAY_METHODS[playMethod]);
  chips.push(bitrate(media?.bitrate ?? null));
  return chips.filter((chip): chip is string => Boolean(chip));
}
