import assert from "node:assert/strict";
import test from "node:test";

import { parseAppleMusicUrl } from "./motion-artwork-url.ts";

test("专辑和单曲链接各解出自己的 ID，storefront 跟着路径走", () => {
  assert.deepEqual(
    parseAppleMusicUrl("https://music.apple.com/us/album/positions/1538081237"),
    { storefront: "us", albumId: "1538081237" },
  );
  assert.deepEqual(
    parseAppleMusicUrl("https://music.apple.com/cn/song/%E8%8A%B1%E3%81%AE%E5%A1%94/1663334287"),
    { storefront: "cn", songId: "1663334287" },
  );
  // 专辑链接带 ?i=<songId> 选中曲目时，路径上的仍是专辑 ID
  assert.deepEqual(
    parseAppleMusicUrl("https://music.apple.com/us/album/positions/1538081237?i=1538081494"),
    { storefront: "us", albumId: "1538081237" },
  );
});

test("没写 storefront 的链接按 us 解", () => {
  assert.deepEqual(parseAppleMusicUrl("https://music.apple.com/album/positions/1538081237"), {
    storefront: "us",
    albumId: "1538081237",
  });
});

test("不是专辑 / 单曲的路径不解析 —— 歌单、搜索页都没有动态封面可查", () => {
  assert.equal(parseAppleMusicUrl("https://music.apple.com/us/playlist/pl.abc123"), null);
  assert.equal(parseAppleMusicUrl("https://music.apple.com/search?term=positions"), null);
  assert.equal(parseAppleMusicUrl("https://music.apple.com/us"), null);
});

test("主机名整段匹配：子域放行，蹭后缀的假域名不放", () => {
  assert.deepEqual(
    parseAppleMusicUrl("https://beta.music.apple.com/us/album/positions/1538081237"),
    { storefront: "us", albumId: "1538081237" },
  );
  assert.equal(parseAppleMusicUrl("https://evilmusic.apple.com/us/album/x/1"), null);
  assert.equal(parseAppleMusicUrl("https://example.com/us/album/x/1"), null);
});

test("资源 ID 只认纯数字 —— 解析出的值要拼进 amp-api 的 URL，别让它带路径手术", () => {
  assert.equal(parseAppleMusicUrl("https://music.apple.com/us/album/x/..%2F..%2Fevil"), null);
  assert.equal(parseAppleMusicUrl("https://music.apple.com/us/album/positions/.."), null);
  // 资料库 ID（i.xxx）不是目录 ID，本来就解不出动态封面
  assert.equal(parseAppleMusicUrl("https://music.apple.com/us/song/x/i.abc123"), null);
});

test("解析不出 URL 的输入返回 null，不抛", () => {
  assert.equal(parseAppleMusicUrl("不是地址"), null);
  assert.equal(parseAppleMusicUrl(""), null);
});
