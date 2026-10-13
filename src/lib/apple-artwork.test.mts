import assert from "node:assert/strict";
import test from "node:test";

import { appleArtwork, needsOptimizing } from "./apple-artwork.ts";

test("appleArtwork：尺寸占位换成请求像素，{w}x{h} 段的 jpg/jpeg 后缀换成 webp", () => {
  const template = "https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/ab/cd/{w}x{h}bb.jpg";
  assert.equal(appleArtwork(template, 300), "https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/ab/cd/300x300bb.webp");
  assert.equal(appleArtwork("https://a/{w}x{h}c.JPEG", 64), "https://a/64x64c.webp");
  assert.equal(appleArtwork("https://a/{w}x{h}b.jpeg?token=1", 64), "https://a/64x64b.webp?token=1");
});

test("appleArtwork：{f} 写死 webp，{c} 写死 sr；尺寸取整且至少为 1", () => {
  assert.equal(appleArtwork("https://a/{w}x{h}.{f}", 96), "https://a/96x96.webp");
  assert.equal(appleArtwork("https://a/{w}x{h}-{c}.png", 96), "https://a/96x96-sr.png");
  assert.equal(appleArtwork("https://a/{w}x{h}bb.jpg", 100.6), "https://a/101x101bb.webp");
  assert.equal(appleArtwork("https://a/{w}x{h}bb.jpg", 0), "https://a/1x1bb.webp");
  assert.equal(appleArtwork("https://a/{w}x{h}bb.jpg", -5), "https://a/1x1bb.webp");
});

test("appleArtwork：空输入返回 null；模板段之外的文件名后缀不动", () => {
  assert.equal(appleArtwork(null, 100), null);
  assert.equal(appleArtwork(undefined, 100), null);
  assert.equal(appleArtwork("", 100), null);
  assert.equal(appleArtwork("https://a/100x100bb.jpg", 300), "https://a/100x100bb.jpg");
  assert.equal(appleArtwork("https://a/photo.jpg/{w}x{h}bb.png", 64), "https://a/photo.jpg/64x64bb.png");
});

test("needsOptimizing：只认 *.blobstore.apple.com 主机名，路径里出现不算", () => {
  assert.equal(needsOptimizing("https://a1.mzstatic-sa.blobstore.apple.com/abc"), true);
  assert.equal(needsOptimizing("https://blobstore.apple.com/x"), false);
  assert.equal(needsOptimizing("https://evil.example/x.blobstore.apple.com/"), false);
  assert.equal(needsOptimizing("https://is1-ssl.mzstatic.com/{w}x{h}bb.jpg"), false);
  assert.equal(needsOptimizing("not a url"), false);
  assert.equal(needsOptimizing(null), false);
  assert.equal(needsOptimizing(undefined), false);
});
