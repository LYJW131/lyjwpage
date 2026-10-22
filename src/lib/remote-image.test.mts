import assert from "node:assert/strict";
import test from "node:test";

import { ImagePolicyError, ImageUpstreamError } from "./image-proxy.ts";
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
