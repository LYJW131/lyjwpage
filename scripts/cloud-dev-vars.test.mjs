import assert from "node:assert/strict";
import test from "node:test";

import { cloudDevFiles } from "./cloud-dev-vars.mjs";

test("ai 的 .dev.vars 从 LYJWPAGE_ANTHROPIC_API_KEY 与 LYJWPAGE_DEEPSEEK_API_KEY 取 key，聊天必需的四项都有值", () => {
  const files = cloudDevFiles({ LYJWPAGE_ANTHROPIC_API_KEY: "sk-test", LYJWPAGE_DEEPSEEK_API_KEY: "sk-ds" }, () => "s");
  const ai = Object.fromEntries(files["workers/ai/.dev.vars"].trim().split("\n").map((line) => line.split(/=(.*)/s).slice(0, 2)));
  assert.equal(ai.ANTHROPIC_API_KEY, "sk-test");
  assert.equal(ai.DEEPSEEK_API_KEY, "sk-ds");
  for (const key of ["TURNSTILE_SECRET_KEY", "CHAT_HISTORY_SECRET"]) assert.ok(ai[key], key);
  assert.match(files["workers/core/.dev.vars"], /^DEV_OVERRIDES=true$/m);
});

test("没有 key 时 ANTHROPIC_API_KEY 留空，不写进 undefined", () => {
  assert.match(cloudDevFiles({})["workers/ai/.dev.vars"], /^ANTHROPIC_API_KEY=$/m);
});
