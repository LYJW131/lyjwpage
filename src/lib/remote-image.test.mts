import assert from "node:assert/strict";
import test from "node:test";

import { ImagePolicyError, ImageUpstreamError, parseImageSource } from "./image-proxy.ts";
import { remoteImageDataUri } from "./remote-image.ts";

const png = new Uint8Array([137, 80, 78, 71]);
const ALLOWED = "https://psn-rsc.prod.dl.playstation.net/a.png";

function recordingFetch(respond: () => Response) {
  const calls: string[] = [];
  const impl = (async (input: URL | string) => {
    calls.push(String(input));
    return respond();
  }) as typeof fetch;
  return { calls, impl };
}

test("远程内联：非白名单、非 https、带端口或 IP 的地址不发请求", async () => {
  const { calls, impl } = recordingFetch(() => new Response(png));
  for (const src of [
    "https://attacker.example/beacon.png",
    "http://image.api.playstation.com/x.png",
    "https://psn-rsc.prod.dl.playstation.net:8443/x.png",
    "http://127.0.0.1:9/beacon.png",
    "https://user:pw@psn-rsc.prod.dl.playstation.net/x.png",
  ]) {
    await assert.rejects(remoteImageDataUri(src, impl), ImagePolicyError, src);
  }
  assert.deepEqual(calls, []);
});

test("远程内联：白名单地址内联为 data URI，并带上上游 Content-Type", async () => {
  const { calls, impl } = recordingFetch(() => new Response(png, { headers: { "Content-Type": "image/png" } }));
  const uri = await remoteImageDataUri(ALLOWED, impl);
  assert.equal(uri, `data:image/png;base64,${Buffer.from(png).toString("base64")}`);
  assert.deepEqual(calls, [ALLOWED]);
});

test("远程内联：重定向出白名单、超大响应都拒绝", async () => {
  const redirect = recordingFetch(() => new Response(null, { status: 302, headers: { Location: "https://attacker.example/x.png" } }));
  await assert.rejects(remoteImageDataUri(ALLOWED, redirect.impl), ImagePolicyError);
  assert.deepEqual(redirect.calls, [ALLOWED]);

  const declared = recordingFetch(() => new Response(png, { headers: { "Content-Length": String(21 * 1024 * 1024) } }));
  await assert.rejects(remoteImageDataUri(ALLOWED, declared.impl), ImageUpstreamError);

  const streamed = recordingFetch(() => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
  })));
  await assert.rejects(remoteImageDataUri(ALLOWED, streamed.impl), ImageUpstreamError);
});

test("远程内联：PSN 带尺寸图床与 Quest 封面链可内联，公开 /image 代理仍不认这些主机", async () => {
  for (const src of [
    "https://image.api.playstation.com/x.png?w=224&h=224",
    "https://psnobj.prod.dl.playstation.net/x.png",
    "https://cdn.discordapp.com/app-assets/123/cover.png?size=256",
  ]) {
    const { impl } = recordingFetch(() => new Response(png, { headers: { "Content-Type": "image/png" } }));
    assert.match(await remoteImageDataUri(src, impl), /^data:image\/png;base64,/, src);
  }
  const quest = "https://www.oculus.com/rich_presence/image/1/";
  const hops = [
    new Response(null, { status: 302, headers: { Location: "https://scontent-ord5-1.oculuscdn.com/v/x.webp" } }),
    new Response(png, { headers: { "Content-Type": "image/webp" } }),
  ];
  const chain = recordingFetch(() => hops.shift()!);
  assert.match(await remoteImageDataUri(quest, chain.impl), /^data:image\/webp;base64,/);
  assert.deepEqual(chain.calls, [quest, "https://scontent-ord5-1.oculuscdn.com/v/x.webp"]);
  for (const src of ["https://media.discordapp.net/external/a/https/www.oculus.com/x", "https://image.api.playstation.com/x.png", quest]) {
    assert.equal(parseImageSource(src), null, src);
  }
});
