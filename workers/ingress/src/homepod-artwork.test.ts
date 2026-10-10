import assert from "node:assert/strict";
import test from "node:test";

import { prepareIngest } from "@shared/ingest/prepare";

const NOW = Date.parse("2026-10-10T18:00:00Z");

async function artwork(url: unknown) {
  const prepared = await prepareIngest(
    "homepod",
    { state: "playing", title: "Song", artist: "Artist", artworkUrl: url },
    NOW,
  );
  if (prepared.source !== "homepod") throw new Error(prepared.source);
  return prepared.stored.music.artworkUrl;
}

test("HomePod 封面：Apple 模板和 HA 缓存路径收成公网 mzstatic，在听卡片直接拿这个地址", async () => {
  assert.equal(
    await artwork("https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/ab/cd/{w}x{h}bb.{f}"),
    "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/ab/cd/600x600bb.webp",
  );
  assert.equal(
    await artwork("http://home-assistant.local/api/media_player_proxy/media_player.homepod?token=t&cache=Music115/v4/fe/58/79/art.jpg"),
    "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/fe/58/79/art.jpg/600x600bb.webp",
  );
  assert.equal(await artwork("https://example.com/cover.jpg"), "https://example.com/cover.jpg");
});

test("HomePod 封面：普通内网、本机和带凭据的地址不进在听卡片", async () => {
  for (const url of [
    "http://example.com/cover.jpg",
    "https://user:pass@example.com/cover.jpg",
    "https://127.0.0.1/cover.jpg",
    "https://10.1.2.3/cover.jpg",
    "https://192.168.1.1/cover.jpg",
    "https://169.254.169.254/latest/meta-data/",
    "https://localhost/cover.jpg",
    "https://router.local/cover.jpg",
    "https://metadata.google.internal/x",
    "https://[::1]/cover.jpg",
    "https://[fd00::1]/cover.jpg",
    "https://[fe80::1]/cover.jpg",
  ]) {
    assert.equal(await artwork(url), null, url);
  }
});

test("HomePod 封面：URL 解析器收成十六进制的 IPv4 映射地址仍按内网丢掉", async () => {
  for (const url of [
    "https://[::ffff:127.0.0.1]/cover.jpg",
    "https://[::ffff:7f00:1]/cover.jpg",
    "https://[0:0:0:0:0:ffff:10.1.2.3]/",
    "https://[::ffff:192.168.0.1]/cover.jpg",
    "https://[::ffff:172.16.0.1]/cover.jpg",
    "https://[::ffff:169.254.169.254]/latest/",
    "https://[::ffff:0.0.0.0]/",
    "https://example.com/art?cache=https://[::ffff:127.0.0.1]/cover.jpg",
  ]) {
    assert.equal(await artwork(url), null, url);
  }
  assert.equal(await artwork("https://[::ffff:8.8.8.8]/cover.jpg"), "https://[::ffff:808:808]/cover.jpg");
});
