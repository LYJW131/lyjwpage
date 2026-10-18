import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";

import { installLagReader } from "@shared/lag";
import type { StorageCommand } from "@shared/storage-contract";

import { installApiPorts } from "./ports";
import { executePublicRequest } from "./public-execution";
import type { Env } from "./runtime";
import { LIVE_CARD_CACHE_CONTROL, LIVE_CARD_PATH, liveCardArtwork, remoteArtBytes } from "./live-card";

installApiPorts();

const POSTER_KEY = `${"a".repeat(64)}.png`;
const SMALL_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

function emptyResult(command: StorageCommand): unknown {
  if (command.op === "fields") return {};
  if (command.op === "listRange") return [];
  return null;
}

function envOf(read: (commands: StorageCommand[]) => Promise<unknown[]>, extra: Partial<Env> = {}): Env {
  const hub = { publicRead: read, execute: async () => [] };
  return { STATE: { idFromName: () => ({}), get: () => hub }, ...extra } as unknown as Env;
}

function imageResponse(body: Uint8Array, type = "image/png"): Response {
  return new Response(new Blob([body]), { status: 200, headers: { "Content-Type": type } });
}

function fakeImages(outBytes: Uint8Array | Error): ImagesBinding {
  return {
    input: () => ({
      transform: () => ({
        output: async () =>
          outBytes instanceof Error
            ? Promise.reject(outBytes)
            : { response: () => imageResponse(outBytes, "image/webp") },
      }),
    }),
  } as unknown as ImagesBinding;
}

function r2Of(object: { size: number; bytes: Uint8Array; type?: string | null } | null): R2Bucket {
  return {
    get: async () =>
      object === null
        ? null
        : {
          size: object.size,
          body: new Blob([object.bytes]).stream(),
          arrayBuffer: async () => object.bytes.buffer.slice(0),
          httpMetadata: { contentType: object.type ?? null },
        },
  } as unknown as R2Bucket;
}

test("GET /api/cards/now.svg 空态回 idle SVG 与五分钟缓存头", async (t) => {
  installLagReader(async () => null);
  t.after(installApiPorts);
  const env = envOf(async (commands) => commands.map(emptyResult));
  const response = await executePublicRequest(new Request(`https://api.test${LIVE_CARD_PATH}`), env, { waitUntil: () => {} });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/svg+xml; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), LIVE_CARD_CACHE_CONTROL);
  const svg = await response.text();
  assert.match(svg, /^<svg [^>]*viewBox="28 0 724 134"/);
  assert.match(svg, />NOW · OFFLINE</);
  assert.match(svg, />Offline</);
});

test("在播的剧回 watching 卡，R2 封面经 IMAGE_OBJECTS 内联成 data URI", async (t) => {
  installLagReader(async () => null);
  t.after(installApiPorts);
  const values = new Map<string, string>([
    [":emby:nowPlaying", JSON.stringify({
      itemId: "emby1", paused: false, positionTicks: 6_000_000_000, runTimeTicks: 48_000_000_000,
      client: "Emby Web", deviceName: "TV", playMethod: "directplay", media: null, at: Date.now(),
    })],
    [":emby:current", JSON.stringify({
      item: {
        id: "emby1", title: "Frieren", subtitle: "S1E3 · The Magician", progress: 12,
        type: "Episode", year: 2023, link: null, playedAt: new Date().toISOString(),
        posterKey: "p1", backdropKey: null,
      },
      at: Date.now(),
    })],
    [":emby:images", JSON.stringify({ objectKeys: { p1: POSTER_KEY }, at: Date.now() })],
  ]);
  const env = envOf(
    async (commands) => commands.map((c) =>
      ("key" in c && c.op === "get")
        ? [...values].find(([suffix]) => c.key.endsWith(suffix))?.[1] ?? null
        : emptyResult(c)),
    { IMAGE_OBJECTS: r2Of({ size: SMALL_PNG.length, bytes: SMALL_PNG, type: "image/png" }) },
  );
  const response = await executePublicRequest(new Request(`https://api.test${LIVE_CARD_PATH}`), env, { waitUntil: () => {} });
  assert.equal(response.status, 200);
  const svg = await response.text();
  assert.match(svg, />NOW · WATCHING</);
  assert.match(svg, />Frieren</);
  assert.match(svg, />S1E3 · The Magician</);
  assert.ok(svg.includes(`<image href="data:image/png;base64,${Buffer.from(SMALL_PNG).toString("base64")}"`));
});

test("存储整个挂了仍回 200 的 idle 卡，只把缓存缩到一分钟", async (t) => {
  installLagReader(async () => null);
  t.after(installApiPorts);
  t.mock.method(console, "error", () => {});
  const env = envOf(async () => { throw new Error("StateHub down"); });
  const response = await executePublicRequest(new Request(`https://api.test${LIVE_CARD_PATH}`), env, { waitUntil: () => {} });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/svg+xml; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=60");
  assert.match(await response.text(), />NOW · OFFLINE</);
});

test("远端封面只抓白名单里的主机，别的 URL 一个请求都不发", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return imageResponse(SMALL_PNG);
  }) as typeof fetch;
  assert.equal(await liveCardArtwork({ artworkKey: null, artworkUrl: "https://evil.example/a.png" }, {}, fetchImpl), null);
  assert.equal(await liveCardArtwork({ artworkKey: null, artworkUrl: "http://cdn.discordapp.com/x/a.png" }, {}, fetchImpl), null);
  assert.equal(await liveCardArtwork({ artworkKey: null, artworkUrl: "/img/notarealkey.png" }, {}, fetchImpl), null);
  assert.deepEqual(calls, []);
});

test("Apple 模板先按 160px 展开再抓，小图按原字节内联", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return imageResponse(SMALL_PNG, "image/webp");
  }) as typeof fetch;
  const template = "https://is1-ssl.mzstatic.com/image/thumb/a/b/{w}x{h}bb.jpg";
  const uri = await liveCardArtwork({ artworkKey: null, artworkUrl: template }, {}, fetchImpl);
  assert.deepEqual(calls, ["https://is1-ssl.mzstatic.com/image/thumb/a/b/160x160bb.webp"]);
  assert.equal(uri, `data:image/webp;base64,${Buffer.from(SMALL_PNG).toString("base64")}`);
});

test("过期的 deadline 不发请求；途中过线按超时丢封面", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    await sleep(60);
    return imageResponse(SMALL_PNG);
  }) as typeof fetch;
  assert.equal(await remoteArtBytes("https://cdn.discordapp.com/a.png", fetchImpl, Date.now() - 1), null);
  assert.equal(await remoteArtBytes("https://cdn.discordapp.com/a.png", fetchImpl, Date.now() + 10), null);
  assert.equal(calls.length, 1);
});

test("声明超大或实际超大的原图都不进卡", async () => {
  const declaredFetch = (async () => new Response(new Blob([SMALL_PNG]), {
    status: 200,
    headers: { "Content-Type": "image/png", "Content-Length": String(5 * 1024 * 1024) },
  })) as typeof fetch;
  assert.equal(await remoteArtBytes("https://cdn.discordapp.com/a.png", declaredFetch, Date.now() + 5_000), null);

  const bigBody = new Uint8Array(4 * 1024 * 1024 + 1);
  const bigFetch = (async () => imageResponse(bigBody)) as typeof fetch;
  assert.equal(await remoteArtBytes("https://cdn.discordapp.com/a.png", bigFetch, Date.now() + 5_000), null);
});

test("重定向目标也要过白名单：跳到白名单内拿图，跳出去就放弃", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return calls.length === 1
      ? new Response(null, { status: 302, headers: { location: "https://media.discordapp.net/attachments/a/b.png" } })
      : imageResponse(SMALL_PNG, "image/webp");
  }) as typeof fetch;
  const uri = await remoteArtBytes("https://cdn.discordapp.com/a.png", fetchImpl, Date.now() + 5_000);
  assert.deepEqual(calls, ["https://cdn.discordapp.com/a.png", "https://media.discordapp.net/attachments/a/b.png"]);
  assert.ok(uri && uri.bytes.length === SMALL_PNG.length);

  const bad = (async () => new Response(null, { status: 302, headers: { location: "https://evil.example/x.png" } })) as typeof fetch;
  assert.equal(await remoteArtBytes("https://cdn.discordapp.com/a.png", bad, Date.now() + 5_000), null);
});

test("有 IMAGES 绑定时统一裁成 webp；产物超上限或 transform 失败再退回原字节", async () => {
  const tiny = fakeImages(new Uint8Array(100));
  const uri = await liveCardArtwork(
    { artworkKey: null, artworkUrl: "https://image.api.playstation.com/icon.png" },
    { IMAGES: tiny },
    (async () => imageResponse(new Uint8Array(200_000).fill(1), "image/png")) as typeof fetch,
  );
  assert.equal(uri, `data:image/webp;base64,${Buffer.from(new Uint8Array(100)).toString("base64")}`);

  const oversized = fakeImages(new Uint8Array(50 * 1024));
  const raw = await liveCardArtwork(
    { artworkKey: null, artworkUrl: "https://cdn.discordapp.com/a.png" },
    { IMAGES: oversized },
    (async () => imageResponse(SMALL_PNG)) as typeof fetch,
  );
  assert.equal(raw, null);

  const broken = fakeImages(new Error("transform down"));
  const fallback = await liveCardArtwork(
    { artworkKey: null, artworkUrl: "https://cdn.discordapp.com/a.png" },
    { IMAGES: broken },
    (async () => imageResponse(SMALL_PNG)) as typeof fetch,
  );
  assert.equal(fallback, `data:image/png;base64,${Buffer.from(SMALL_PNG).toString("base64")}`);
});

test("R2 对象超上限或绑定缺失就没有封面", async () => {
  assert.equal(
    await liveCardArtwork(
      { artworkKey: POSTER_KEY, artworkUrl: null },
      { IMAGE_OBJECTS: r2Of({ size: 5 * 1024 * 1024, bytes: SMALL_PNG }) },
    ),
    null,
  );
  assert.equal(await liveCardArtwork({ artworkKey: POSTER_KEY, artworkUrl: null }, {}), null);
});
