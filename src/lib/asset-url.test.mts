import assert from "node:assert/strict";
import test from "node:test";

import { IMAGE_PATH_PREFIX, objectKeyFromAssetUrl, publicAssetPath } from "./asset-url.ts";

const OBJECT_KEY = `${"a".repeat(64)}.webp`;

test("对象键拼成同源路径，不带任何交付域", () => {
  assert.equal(publicAssetPath(OBJECT_KEY), `${IMAGE_PATH_PREFIX}/${OBJECT_KEY}`);
  assert.ok(publicAssetPath(OBJECT_KEY).startsWith("/"));
});

test("从同源路径和绝对地址都能取回对象键", () => {
  assert.equal(objectKeyFromAssetUrl(publicAssetPath(OBJECT_KEY)), OBJECT_KEY);
  assert.equal(objectKeyFromAssetUrl(`https://r2.example.com/${OBJECT_KEY}`), OBJECT_KEY);
  assert.equal(objectKeyFromAssetUrl(`/img/${OBJECT_KEY}?v=1#x`), OBJECT_KEY);
  const jpegKey = `${"b".repeat(64)}.jpg`;
  assert.equal(objectKeyFromAssetUrl(`/img/${jpegKey}`), jpegKey);
});

test("不是内容键的地址一律不认", () => {
  assert.equal(objectKeyFromAssetUrl("https://example.com/not-an-object.jpg"), null);
  assert.equal(objectKeyFromAssetUrl("/img/../etc/passwd"), null);
  assert.equal(objectKeyFromAssetUrl(`${"a".repeat(64)}.gif`), null);
  assert.equal(objectKeyFromAssetUrl(""), null);
});
