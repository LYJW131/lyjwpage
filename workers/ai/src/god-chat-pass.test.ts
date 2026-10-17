import assert from "node:assert/strict";
import { test } from "node:test";

import { GOD_CHAT_PASS_TTL_MS, parseGodChatRequest } from "@shared/god-chat";

import { issuePass, passValid } from "./chat/pass.ts";

const NOW = 1_800_000_000_000;

test("a pass is valid from any IP until it expires", async () => {
  const { pass, expiresAt } = await issuePass("secret", NOW);
  assert.equal(expiresAt, NOW + GOD_CHAT_PASS_TTL_MS);
  assert.equal(await passValid("secret", pass, NOW + 1000), true);
  assert.equal(await passValid("other", pass, NOW + 1000), false);
  assert.equal(await passValid("secret", pass, expiresAt), false);
});

test("a pass cannot be extended by rewriting its expiry", async () => {
  const { pass } = await issuePass("secret", NOW);
  const forged = `${NOW + 2 * GOD_CHAT_PASS_TTL_MS}.${pass.split(".")[1]}`;
  assert.equal(await passValid("secret", forged, NOW), false);
});

test("a request needs a Turnstile token or a well-formed pass", async () => {
  const messages = [{ role: "user", content: "hi" }];
  const { pass } = await issuePass("secret", NOW);
  assert.equal(parseGodChatRequest({ messages }), null);
  assert.equal(parseGodChatRequest({ messages, humanPass: "nope" }), null);
  assert.equal(parseGodChatRequest({ messages, humanPass: pass })?.humanPass, pass);
});
