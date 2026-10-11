import assert from "node:assert/strict";
import { test } from "node:test";

import { readGodChatRoute } from "@shared/god-chat";
import { GOD_CHAT_TIER_INFO, godChatTierInfo } from "@shared/god-chat-tiers";

test("an unknown chat tier has no rank to destructure and is dropped from the route event", () => {
  assert.equal(godChatTierInfo("oracle"), undefined);
  assert.equal(godChatTierInfo("toString"), undefined);
  assert.equal(godChatTierInfo(null), undefined);
  assert.equal(godChatTierInfo(undefined), undefined);
  assert.equal(godChatTierInfo("sonnet")?.persona, GOD_CHAT_TIER_INFO.sonnet.persona);
  assert.equal(readGodChatRoute("oracle", "fable"), undefined);
  assert.equal(readGodChatRoute("toString"), undefined);
  assert.deepEqual(readGodChatRoute(null, "oracle"), { tier: null });
  assert.deepEqual(readGodChatRoute("haiku", "oracle"), { tier: "haiku" });
  assert.deepEqual(readGodChatRoute("sonnet", "fable"), { tier: "sonnet", downgradedFrom: "fable" });
  assert.deepEqual(readGodChatRoute("opus"), { tier: "opus" });
});
