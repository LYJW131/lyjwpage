import assert from "node:assert/strict";
import test from "node:test";

import type { WatchingMedia } from "./types.ts";
import { describeDevice, describeMedia } from "./watching-media.ts";

/** 实机上那部闪光的哈萨维：1080p H264 SDR，日语 EAC3 5.1，外挂简中字幕 */
const gundam: WatchingMedia = {
  container: "mkv",
  bitrate: 6421965,
  video: { codec: "h264", width: 1920, height: 1080, range: "sdr", bitDepth: 8 },
  audio: { codec: "eac3", profile: null, channels: 6, layout: "5.1", language: "jpn" },
  subtitle: { codec: "srt", language: "zh-CN", title: null, forced: false, external: true },
};

test("规格按分辨率、编码、音轨、字幕、播放方式、码率排，SDR 不占标签", () => {
  assert.deepEqual(describeMedia(gundam, "directplay"), [
    "1080p",
    "H.264",
    "DD+ 5.1",
    "中文字幕",
    "直接播放",
    "6.4 Mbps",
  ]);
});

test("4K HDR10 HEVC 配 DTS-HD MA 7.1，profile 优先于编码名", () => {
  const media: WatchingMedia = {
    container: "mkv",
    bitrate: 48_200_000,
    video: { codec: "hevc", width: 3840, height: 1600, range: "hdr10", bitDepth: 10 },
    audio: { codec: "dts", profile: "DTS-HD MA", channels: 8, layout: "7.1", language: "eng" },
    subtitle: null,
  };
  assert.deepEqual(describeMedia(media, "transcode"), [
    "4K",
    "HDR10",
    "HEVC",
    "DTS-HD MA 7.1",
    "转码",
    "48.2 Mbps",
  ]);
});

test("Dolby Vision 与 TrueHD Atmos；没有声道布局时按声道数推", () => {
  const media: WatchingMedia = {
    container: "mkv",
    bitrate: null,
    video: { codec: "hevc", width: 3840, height: 2160, range: "dolby-vision", bitDepth: 10 },
    audio: { codec: "truehd", profile: "Dolby TrueHD + Dolby Atmos", channels: 8, layout: null, language: "eng" },
    subtitle: { codec: "pgssub", language: "eng", title: null, forced: true, external: false },
  };
  assert.deepEqual(describeMedia(media, null), [
    "4K",
    "Dolby Vision",
    "HEVC",
    "TrueHD Atmos 7.1",
    "英文强制字幕",
  ]);
});

test("裁过黑边的 1920×804 仍算 1080p；不认识的编码和语言原样大写", () => {
  const media: WatchingMedia = {
    container: "mp4",
    bitrate: 820_000,
    video: { codec: "prores", width: 1920, height: 804, range: null, bitDepth: null },
    audio: { codec: "pcm_s24le", profile: "LC", channels: 2, layout: null, language: null },
    subtitle: { codec: "subrip", language: "may", title: null, forced: false, external: false },
  };
  assert.deepEqual(describeMedia(media, "directstream"), [
    "1080p",
    "PRORES",
    "PCM_S24LE 2.0",
    "MAY字幕",
    "直接串流",
    "820 kbps",
  ]);
});

test("没有规格时只剩播放方式；什么都没有就是空", () => {
  assert.deepEqual(describeMedia(null, "directplay"), ["直接播放"]);
  assert.deepEqual(describeMedia(null, null), []);
  assert.deepEqual(
    describeMedia({ container: null, bitrate: null, video: null, audio: null, subtitle: null }, null),
    [],
  );
});

test("设备：Infuse 的运行模式后缀和网页端的登录方式都不算「在哪放」", () => {
  assert.equal(describeDevice("Infuse-Direct", "iPad"), "Infuse · iPad");
  assert.equal(describeDevice("Infuse-Download", "Mac"), "Infuse · Mac");
  assert.equal(describeDevice("Emby Web (oauth2)", "Google Chrome macOS"), "Emby Web · Google Chrome macOS");
  assert.equal(describeDevice("Emby for Android", "Quest 3"), "Emby for Android · Quest 3");
});

test("设备：只有一边、或两边一样，就只写一个；都没有是 null", () => {
  assert.equal(describeDevice(null, "Apple TV"), "Apple TV");
  assert.equal(describeDevice("Emby for iOS", null), "Emby for iOS");
  assert.equal(describeDevice("Apple TV", "apple tv"), "Apple TV");
  assert.equal(describeDevice(null, null), null);
  assert.equal(describeDevice("", "  "), null);
});
