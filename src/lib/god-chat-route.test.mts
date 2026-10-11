import assert from "node:assert/strict";
import { test } from "node:test";

import { readGodChatRoute } from "@shared/god-chat";

test("an unknown chat tier is dropped from the route event before it reaches the rank table", () => {
  assert.equal(readGodChatRoute("oracle", "fable"), undefined);
  assert.equal(readGodChatRoute("toString"), undefined);
  assert.deepEqual(readGodChatRoute(null, "oracle"), { tier: null });
  assert.deepEqual(readGodChatRoute("haiku", "oracle"), { tier: "haiku" });
  assert.deepEqual(readGodChatRoute("sonnet", "fable"), { tier: "sonnet", downgradedFrom: "fable" });
  assert.deepEqual(readGodChatRoute("opus"), { tier: "opus" });
});
