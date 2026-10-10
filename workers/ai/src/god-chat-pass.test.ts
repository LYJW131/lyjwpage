import assert from "node:assert/strict";
import { test } from "node:test";

import { GOD_CHAT_PASS_TTL_MS, parseGodChatRequest } from "@shared/god-chat";

import { issuePass, passValid } from "./chat/pass.ts";

const NOW = 1_800_000_000_000;

test("a pass is valid for its IP until it expires", async () => {
  const { pass, expiresAt } = await issuePass("secret", "1.2.3.4", NOW);
  assert.equal(expiresAt, NOW + GOD_CHAT_PASS_TTL_MS);
  assert.equal(await passValid("secret", pass, "1.2.3.4", NOW + 1000), true);
  assert.equal(await passValid("secret", pass, "5.6.7.8", NOW + 1000), false);
  assert.equal(await passValid("other", pass, "1.2.3.4", NOW + 1000), false);
  assert.equal(await passValid("secret", pass, "1.2.3.4", expiresAt), false);
});

test("a pass cannot be extended by rewriting its expiry", async () => {
  const { pass } = await issuePass("secret", "1.2.3.4", NOW);
  const forged = `${NOW + 2 * GOD_CHAT_PASS_TTL_MS}.${pass.split(".")[1]}`;
  assert.equal(await passValid("secret", forged, "1.2.3.4", NOW), false);
});

test("a request needs a Turnstile token or a well-formed pass", async () => {
  const messages = [{ role: "user", content: "hi" }];
  const { pass } = await issuePass("secret", "1.2.3.4", NOW);
  assert.equal(parseGodChatRequest({ messages }), null);
  assert.equal(parseGodChatRequest({ messages, humanPass: "nope" }), null);
  assert.equal(parseGodChatRequest({ messages, humanPass: pass })?.humanPass, pass);
});
