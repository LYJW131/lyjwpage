import assert from "node:assert/strict";
import test from "node:test";

import { pickMedia, playMethod, type EmbyItemMedia, type EmbyMediaStream } from "./playback.ts";

/** 实机上一条 1080p H264 的流列表：一条视频、两条音轨、内封字幕若干、一条外挂简中 */
const streams: EmbyMediaStream[] = [
  { Type: "Video", Codec: "h264", Width: 1920, Height: 1080, BitDepth: 8, VideoRange: "SDR", ExtendedVideoType: "None", Index: 0, Profile: "High" },
  { Type: "Audio", Codec: "eac3", Language: "jpn", Channels: 6, ChannelLayout: "5.1", IsDefault: true, Index: 1 },
  { Type: "Audio", Codec: "eac3", Language: "eng", Channels: 6, ChannelLayout: "5.1", IsDefault: false, Index: 2 },
  { Type: "Subtitle", Codec: "subrip", Language: "eng", IsDefault: true, Index: 3 },
  { Type: "Subtitle", Codec: "subrip", Language: "jpn", Title: "Forced", IsForced: true, Index: 14 },
  { Type: "Subtitle", Codec: "srt", Language: "zh-CN", IsDefault: true, IsExternal: true, Index: 25 },
];

const item: EmbyItemMedia = {
  Container: "mkv",
  Bitrate: 6421965,
  MediaStreams: streams,
  MediaSources: [{ Id: "mediasource_23217", Container: "mkv", Bitrate: 6421965, MediaStreams: streams }],
};

test("按会话选中的下标取音轨和字幕；外挂字幕的路径之类一概不带", () => {
  const media = pickMedia({
    playState: { AudioStreamIndex: 2, SubtitleStreamIndex: 25, MediaSourceId: "mediasource_23217" },
    nowPlaying: undefined,
    item,
  });
  assert.deepEqual(media, {
    container: "mkv",
    bitrate: 6421965,
    video: { codec: "h264", width: 1920, height: 1080, range: "sdr", bitDepth: 8 },
    audio: { codec: "eac3", profile: null, channels: 6, layout: "5.1", language: "eng" },
    subtitle: { codec: "srt", language: "zh-CN", title: null, forced: false, external: true },
  });
});

test("没说选哪条就用默认音轨；字幕下标 -1 或缺席都是没开字幕", () => {
  const media = pickMedia({ playState: { SubtitleStreamIndex: -1 }, nowPlaying: undefined, item });
  assert.equal(media?.audio?.language, "jpn");
  assert.equal(media?.subtitle, null);
  assert.equal(pickMedia({ playState: {}, nowPlaying: undefined, item })?.subtitle, null);
});

test("强制字幕按下标取到时带 forced；ExtendedVideoType 优先于 VideoRange", () => {
  const hdr: EmbyItemMedia = {
    MediaStreams: [
      { Type: "Video", Codec: "hevc", Width: 3840, Height: 2160, BitDepth: 10, VideoRange: "HDR", ExtendedVideoType: "DolbyVision", Index: 0 },
      { Type: "Audio", Codec: "truehd", Profile: "Dolby TrueHD + Dolby Atmos", Channels: 8, Index: 1 },
      ...streams.filter((stream) => stream.Type === "Subtitle"),
    ],
  };
  const media = pickMedia({ playState: { SubtitleStreamIndex: 14 }, nowPlaying: undefined, item: hdr });
  assert.equal(media?.video?.range, "dolby-vision");
  assert.deepEqual(media?.audio, { codec: "truehd", profile: "Dolby TrueHD + Dolby Atmos", channels: 8, layout: null, language: null });
  assert.deepEqual(media?.subtitle, { codec: "subrip", language: "jpn", title: "Forced", forced: true, external: false });
  assert.equal(media?.container, null);
});

test("会话上的 NowPlayingItem 带流就以它为准；只认 HDR 但认不出哪种时归 hdr", () => {
  const media = pickMedia({
    playState: { MediaSourceId: "mediasource_23217" },
    nowPlaying: {
      Container: "mp4",
      Bitrate: 12000000,
      MediaStreams: [{ Type: "Video", Codec: "av1", Width: 3840, Height: 1600, ExtendedVideoType: "HdrVivid", Index: 0 }],
    },
    item,
  });
  assert.deepEqual(media, {
    container: "mp4",
    bitrate: 12000000,
    video: { codec: "av1", width: 3840, height: 1600, range: "hdr", bitDepth: null },
    audio: null,
    subtitle: null,
  });
});

test("媒体源按 MediaSourceId 对，对不上退回第一个；哪儿都没有流就是 null", () => {
  const twoSources: EmbyItemMedia = {
    MediaSources: [
      { Id: "web", Container: "mp4", MediaStreams: [{ Type: "Video", Codec: "h264", Index: 0 }] },
      { Id: "bd", Container: "mkv", MediaStreams: [{ Type: "Video", Codec: "hevc", Index: 0 }] },
    ],
  };
  assert.equal(pickMedia({ playState: { MediaSourceId: "bd" }, nowPlaying: undefined, item: twoSources })?.video?.codec, "hevc");
  assert.equal(pickMedia({ playState: { MediaSourceId: "gone" }, nowPlaying: undefined, item: twoSources })?.video?.codec, "h264");
  assert.equal(pickMedia({ playState: {}, nowPlaying: undefined, item: null }), null);
  assert.equal(pickMedia({ playState: {}, nowPlaying: { MediaStreams: [] }, item: { MediaStreams: [] } }), null);
});

test("播放方式只认三种写法，大小写不论；别的当不知道", () => {
  assert.equal(playMethod({ PlayMethod: "DirectPlay" }), "directplay");
  assert.equal(playMethod({ PlayMethod: "Transcode" }), "transcode");
  assert.equal(playMethod({ PlayMethod: "direct_stream" }), "directstream");
  assert.equal(playMethod({ PlayMethod: "Remux" }), null);
  assert.equal(playMethod(undefined), null);
});
