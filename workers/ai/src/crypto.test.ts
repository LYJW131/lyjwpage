import assert from "node:assert/strict";
import test from "node:test";

import { base64url, decodeBase64url } from "./crypto.ts";

test("base64url 换掉 + 与 /、去掉 padding，能直接进 URL 与令牌", () => {
  assert.equal(base64url(new Uint8Array([251, 255, 191])), "-_-_");
  assert.equal(base64url(new TextEncoder().encode("Hello")), "SGVsbG8");
  assert.equal(base64url(new Uint8Array(0)), "");
  assert.match(base64url(crypto.getRandomValues(new Uint8Array(64))), /^[A-Za-z0-9_-]+$/);
});

test("decodeBase64url 还原原始字节，多字节 UTF-8 内容也对得上", () => {
  assert.deepEqual([...decodeBase64url("SGVsbG8")], [...new TextEncoder().encode("Hello")]);
  const bytes = new TextEncoder().encode("中文标题与 🔒");
  assert.deepEqual(decodeBase64url(base64url(bytes)), bytes);
});
