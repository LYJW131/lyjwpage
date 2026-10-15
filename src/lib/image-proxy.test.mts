import assert from "node:assert/strict";
import test from "node:test";

import {
  IMAGE_DEFAULT_QUALITY,
  IMAGE_DEFAULT_WIDTH,
  ImagePolicyError,
  IMAGE_WIDTHS,
  ImageUpstreamError,
  imageUpstreamFailureStatus,
  displayWidthFromSizes,
  fetchImageUpstream,
  imageWidthBucket,
  imageSourceFromInternalPath,
  optimizerImagePath,
  optimizerSrcSet,
  parseImageSource,
  parseVariantFit,
  parseVariantQuality,
  parseVariantWidth,
  variantShape,
} from "./image-proxy.ts";
import { BodyTooLargeError, readBoundedBytes } from "@shared/read-bounded-bytes.ts";

test("白名单域名放行，相似后缀与凭证拒绝", () => {
  assert.ok(parseImageSource("https://avatars.githubusercontent.com/u/1?s=96"));
  assert.ok(parseImageSource("https://a1.mzstatic.blobstore.apple.com/x.png"));
  assert.ok(parseImageSource("https://psn-rsc.prod.dl.playstation.net/a.png"));
  assert.ok(parseImageSource("https://is1-ssl.mzstatic.com/image/thumb/x/240x240cc.webp"));
  assert.equal(parseImageSource("https://notblobstore.apple.com/x.png"), null);
  assert.equal(parseImageSource("https://notmzstatic.com/x.png"), null);
  assert.equal(parseImageSource("https://mzstatic.com.evil.com/x.png"), null);
  assert.equal(parseImageSource("https://blobstore.apple.com.evil.com/x.png"), null);
  assert.equal(parseImageSource("https://avatars.githubusercontent.com.evil.com/x"), null);
  assert.equal(parseImageSource("https://user:pw@avatars.githubusercontent.com/x"), null);
  assert.equal(parseImageSource("http://avatars.githubusercontent.com/x"), null);
  assert.equal(parseImageSource("https://avatars.githubusercontent.com:8443/x"), null);
});

test("本地与 IP 字面量一律拒绝", () => {
  assert.equal(parseImageSource("https://localhost/x.png"), null);
  assert.equal(parseImageSource("https://app.localhost/x.png"), null);
  assert.equal(parseImageSource("https://127.0.0.1/x.png"), null);
  assert.equal(parseImageSource("https://192.168.1.10/x.png"), null);
  assert.equal(parseImageSource("https://[::1]/x.png"), null);
  assert.equal(parseImageSource("https://8.8.8.8/x.png"), null);
  assert.equal(parseImageSource("not a url"), null);
  assert.equal(parseImageSource(null), null);
});

test("宽度和质量白名单校验", () => {
  assert.equal(parseVariantWidth(null), IMAGE_DEFAULT_WIDTH);
  assert.equal(parseVariantWidth("184"), 184);
  assert.equal(parseVariantWidth("999"), null);
  assert.equal(parseVariantWidth("-1"), null);
  assert.equal(parseVariantWidth("abc"), null);
  assert.equal(parseVariantQuality(null), IMAGE_DEFAULT_QUALITY);
  assert.equal(parseVariantQuality("1"), 1);
  assert.equal(parseVariantQuality("100"), 100);
  assert.equal(parseVariantQuality("0"), null);
  assert.equal(parseVariantQuality("101"), null);
  assert.equal(parseVariantQuality("60.5"), null);
  assert.equal(parseVariantFit(null), "scale-down");
  assert.equal(parseVariantFit("scale-down"), "scale-down");
  assert.equal(parseVariantFit("contain"), "contain");
  assert.equal(parseVariantFit("cover"), "cover");
  assert.equal(parseVariantFit("fill"), null);
});

test("srcset 按显示宽度出 1x、2x 两档，档位都在宽度白名单里", () => {
  const src = "https://is1-ssl.mzstatic.com/a.webp";
  const widthsOf = (set: string) => set.split(", ").map((entry) => ({
    w: Number(new URL(entry.split(" ")[0], "https://site.test").searchParams.get("w")),
    density: entry.split(" ")[1],
  }));
  assert.deepEqual(widthsOf(optimizerSrcSet(src, 75, 44)), [{ w: 48, density: "1x" }, { w: 88, density: "2x" }, { w: 160, density: "3x" }]);
  assert.deepEqual(widthsOf(optimizerSrcSet(src, 75, 64)), [{ w: 64, density: "1x" }, { w: 128, density: "2x" }, { w: 192, density: "3x" }]);
  assert.deepEqual(widthsOf(optimizerSrcSet(src, 75, 1500)), [{ w: 1920, density: "1x" }]);
  assert.deepEqual(widthsOf(optimizerSrcSet(src, 75, 700)), [{ w: 750, density: "1x" }, { w: 1920, density: "2x" }]);
  for (const display of [1, 20, 44, 100, 333, 960, 5000]) {
    for (const { w } of widthsOf(optimizerSrcSet(src, 75, display))) {
      assert.ok((IMAGE_WIDTHS as readonly number[]).includes(w));
    }
  }
  assert.equal(imageWidthBucket(10), IMAGE_WIDTHS[0]);
  assert.equal(imageWidthBucket(99999), IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]);
});

test("sizes 取其中最大的像素宽度作显示宽度，没有像素值就不猜", () => {
  assert.equal(displayWidthFromSizes("44px"), 44);
  assert.equal(displayWidthFromSizes("(min-width: 1024px) 64px, 56px"), 64);
  assert.equal(displayWidthFromSizes("100vw"), undefined);
  assert.equal(displayWidthFromSizes(undefined), undefined);
});

test("签名查询串原样保留进 url 参数", () => {
  const signed =
    "https://a1.mzstatic.blobstore.apple.com/get/f.jpg?token=AbC%2B%3D&sig=x%3Dy&expires=1";
  const path = optimizerImagePath(signed, 240, 75);
  const parsed = new URL(path, "https://site.test");
  assert.equal(parsed.searchParams.get("url"), signed);
  assert.equal(parsed.searchParams.get("w"), "240");
  assert.equal(parsed.searchParams.get("q"), "75");
});

test("/img 内部路径只接受图片对象键", () => {
  assert.equal(imageSourceFromInternalPath(`/img/${"b".repeat(64)}.png`), `${"b".repeat(64)}.png`);
  assert.equal(imageSourceFromInternalPath(`/img/${"b".repeat(64)}.mp3`), null);
  assert.equal(imageSourceFromInternalPath("/img/../../secret"), null);
  assert.equal(imageSourceFromInternalPath("/other/x.png"), null);
});

function upstreamResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(new Uint8Array([1, 2, 3]), { status, headers });
}

test("上游重定向跟随但每跳重新过白名单", async () => {
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (calls.length === 1) {
      return upstreamResponse(302, {
        location: "https://avatars.githubusercontent.com/u/2",
      });
    }
    return upstreamResponse(200, { "content-type": "image/png" });
  };
  const res = await fetchImageUpstream(
    new URL("https://avatars.githubusercontent.com/u/1"),
    fakeFetch,
  );
  assert.equal(res.status, 200);
  assert.deepEqual(calls, [
    "https://avatars.githubusercontent.com/u/1",
    "https://avatars.githubusercontent.com/u/2",
  ]);
});

test("重定向到本地地址被拒绝", async () => {
  const fakeFetch: typeof fetch = async () =>
    upstreamResponse(302, { location: "https://127.0.0.1/internal" });
  await assert.rejects(
    fetchImageUpstream(new URL("https://avatars.githubusercontent.com/u/1"), fakeFetch),
    (error) => error instanceof ImagePolicyError && error.kind === "source",
  );
});

test("超过最大跳数与上游错误不静默", async () => {
  const loopFetch: typeof fetch = async () =>
    upstreamResponse(302, { location: "https://avatars.githubusercontent.com/u/9" });
  await assert.rejects(
    fetchImageUpstream(new URL("https://avatars.githubusercontent.com/u/1"), loopFetch),
    (error) => error instanceof ImagePolicyError && error.kind === "redirects",
  );

  const deadFetch: typeof fetch = async () => upstreamResponse(404);
  await assert.rejects(
    fetchImageUpstream(new URL("https://avatars.githubusercontent.com/u/1"), deadFetch),
    (error) => error instanceof ImageUpstreamError && error.status === 404,
  );

  const fatFetch: typeof fetch = async () =>
    upstreamResponse(200, { "content-length": String(21 * 1024 * 1024) });
  await assert.rejects(
    fetchImageUpstream(new URL("https://avatars.githubusercontent.com/u/1"), fatFetch),
    (error) => error instanceof ImageUpstreamError && error.status === 413,
  );
});

test("变体形状：scale-down 只给宽度保比例，cover/contain 给方形", () => {
  assert.deepEqual(variantShape(50, "scale-down"), { width: 50, fit: "scale-down" });
  assert.deepEqual(variantShape(50, "cover"), { width: 50, height: 50, fit: "cover" });
  assert.deepEqual(variantShape(50, "contain"), { width: 50, height: 50, fit: "contain" });
});

test("读体按真实字节数限流，不限于 Content-Length", async () => {
  const oversized = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.enqueue(new Uint8Array([4, 5, 6]));
    },
  });
  await assert.rejects(readBoundedBytes(oversized, 4), BodyTooLargeError);

  const cancelled: boolean[] = [];
  const tracked = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.enqueue(new Uint8Array([4, 5]));
    },
    cancel() {
      cancelled.push(true);
    },
  });
  await assert.rejects(readBoundedBytes(tracked, 4), BodyTooLargeError);
  assert.deepEqual(cancelled, [true]);

  const exact = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4]));
      controller.close();
    },
  });
  assert.deepEqual([...await readBoundedBytes(exact, 4)], [1, 2, 3, 4]);
});

test("an image the upstream no longer has is a 404, only upstream failures are a 502", () => {
  const status = (code: number) => imageUpstreamFailureStatus(new ImageUpstreamError(code));
  assert.equal(status(403), 404);
  assert.equal(status(404), 404);
  assert.equal(status(413), 413);
  assert.equal(status(408), 502);
  assert.equal(status(429), 502);
  assert.equal(status(500), 502);
  assert.equal(status(504), 502);
});
