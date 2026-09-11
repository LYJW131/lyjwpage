import assert from "node:assert/strict";
import test from "node:test";

import { parseAppleMusicCredentials } from "@api/apple-music-credentials-module";

test("parseAppleMusicCredentials：只收 musicUserToken，去掉首尾空白", () => {
  assert.deepEqual(parseAppleMusicCredentials({ musicUserToken: " token-value " }), { musicUserToken: "token-value" });
});

test("parseAppleMusicCredentials：旧合同的 developerToken / expiresAt 直接拒掉", () => {
  for (const row of [
    { musicUserToken: "u", developerToken: "d" },
    { musicUserToken: "u", expiresAt: 1 },
    { developerToken: "d", expiresAt: 1 },
  ]) {
    assert.throws(() => parseAppleMusicCredentials(row), /developerToken 已停用/);
  }
});

test("parseAppleMusicCredentials：不是对象或 token 为空都报错", () => {
  assert.throws(() => parseAppleMusicCredentials(null), /必须是对象/);
  assert.throws(() => parseAppleMusicCredentials(["x"]), /必须是对象/);
  assert.throws(() => parseAppleMusicCredentials({}), /不能为空/);
  assert.throws(() => parseAppleMusicCredentials({ musicUserToken: "   " }), /不能为空/);
  assert.throws(() => parseAppleMusicCredentials({ musicUserToken: 42 }), /不能为空/);
});
