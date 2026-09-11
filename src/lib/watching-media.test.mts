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

test("规格按画面（分辨率 + 编码合一）、音轨、码率排，SDR 不占标签，播放方式和字幕不进标签", () => {
  assert.deepEqual(describeMedia(gundam), ["1080p H.264", "DD+ 5.1", "6.4 Mbps"]);
});

test("4K HDR10 HEVC 配 DTS-HD MA 7.1，profile 优先于编码名", () => {
  const media: WatchingMedia = {
    container: "mkv",
    bitrate: 48_200_000,
    video: { codec: "hevc", width: 3840, height: 1600, range: "hdr10", bitDepth: 10 },
    audio: { codec: "dts", profile: "DTS-HD MA", channels: 8, layout: "7.1", language: "eng" },
    subtitle: null,
  };
  assert.deepEqual(describeMedia(media), ["4K HEVC", "HDR10", "DTS-HD MA 7.1", "48.2 Mbps"]);
});

test("Dolby Vision 与 TrueHD Atmos；没有声道布局时按声道数推", () => {
  const media: WatchingMedia = {
    container: "mkv",
    bitrate: null,
    video: { codec: "hevc", width: 3840, height: 2160, range: "dolby-vision", bitDepth: 10 },
    audio: { codec: "truehd", profile: "Dolby TrueHD + Dolby Atmos", channels: 8, layout: null, language: "eng" },
    subtitle: { codec: "pgssub", language: "eng", title: null, forced: true, external: false },
  };
  assert.deepEqual(describeMedia(media), ["4K HEVC", "Dolby Vision", "TrueHD Atmos 7.1"]);
});

test("裁过黑边的 1920×804 仍算 1080p；不认识的编码原样大写", () => {
  const media: WatchingMedia = {
    container: "mp4",
    bitrate: 820_000,
    video: { codec: "prores", width: 1920, height: 804, range: null, bitDepth: null },
    audio: { codec: "pcm_s24le", profile: "LC", channels: 2, layout: null, language: null },
    subtitle: { codec: "subrip", language: "may", title: null, forced: false, external: false },
  };
  assert.deepEqual(describeMedia(media), ["1080p PRORES", "PCM_S24LE 2.0", "820 kbps"]);
});

test("画面标签缺分辨率或缺编码时只写另一边；什么都没有就是空", () => {
  assert.deepEqual(
    describeMedia({
      container: null,
      bitrate: null,
      video: { codec: "hevc", width: null, height: null, range: null, bitDepth: null },
      audio: null,
      subtitle: null,
    }),
    ["HEVC"],
  );
  assert.deepEqual(
    describeMedia({
      container: null,
      bitrate: null,
      video: { codec: null, width: 1280, height: 720, range: null, bitDepth: null },
      audio: null,
      subtitle: null,
    }),
    ["720p"],
  );
  assert.deepEqual(describeMedia(null), []);
  assert.deepEqual(
    describeMedia({ container: null, bitrate: null, video: null, audio: null, subtitle: null }),
    [],
  );
});

test("设备：客户端、设备各一个标签；Infuse 的运行模式后缀和网页端的登录方式都不算「在哪放」", () => {
  assert.deepEqual(describeDevice("Infuse-Direct", "iPad"), ["Infuse", "iPad"]);
  assert.deepEqual(describeDevice("Infuse-Download", "Mac"), ["Infuse", "Mac"]);
  assert.deepEqual(describeDevice("Emby Web (oauth2)", "Google Chrome macOS"), ["Emby Web", "Google Chrome macOS"]);
  assert.deepEqual(describeDevice("Emby for Android", "Quest 3"), ["Emby for Android", "Quest 3"]);
});

test("设备：只有一边、或两边一样，就只写一个；都没有是空", () => {
  assert.deepEqual(describeDevice(null, "Apple TV"), ["Apple TV"]);
  assert.deepEqual(describeDevice("Emby for iOS", null), ["Emby for iOS"]);
  assert.deepEqual(describeDevice("Apple TV", "apple tv"), ["Apple TV"]);
  assert.deepEqual(describeDevice(null, null), []);
  assert.deepEqual(describeDevice("", "  "), []);
});
