import assert from "node:assert/strict";
import test from "node:test";

import { assetUrl, objectKeyFromAssetUrl } from "./asset-url.ts";

const OBJECT_KEY = `${"a".repeat(64)}.webp`;

test("公开资产 URL 可以按不同部署的同名环境值组装", () => {
  assert.equal(
    assetUrl("https://r2.example.com/", OBJECT_KEY),
    `https://r2.example.com/${OBJECT_KEY}`,
  );
  assert.equal(
    assetUrl("https://cos.example.com", OBJECT_KEY),
    `https://cos.example.com/${OBJECT_KEY}`,
  );
});

test("实时事件可以从写入方 URL 取回对象键并换成本地交付域", () => {
  const writerUrl = `https://r2.example.com/${OBJECT_KEY}`;
  const objectKey = objectKeyFromAssetUrl(writerUrl);
  assert.equal(objectKey, OBJECT_KEY);
  assert.ok(objectKey);
  assert.equal(
    assetUrl("https://cos.example.com/", objectKey),
    `https://cos.example.com/${OBJECT_KEY}`,
  );
  assert.equal(objectKeyFromAssetUrl("https://example.com/not-an-object.jpg"), null);
});
