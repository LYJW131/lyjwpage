import assert from "node:assert/strict";
import test from "node:test";

import { codingModelLabel } from "./coding-model-label.ts";

test("卡片上的模型名跟排行榜同一套，上下文档位标记先剥掉", () => {
  assert.equal(codingModelLabel("claude-opus-5-5"), "Claude Opus 5.5");
  assert.equal(codingModelLabel("claude-opus-5-5[1m]"), "Claude Opus 5.5");
  assert.equal(codingModelLabel("claude-opus-5"), "Claude Opus 5");
  assert.equal(codingModelLabel("gpt-5.6-sol"), "GPT 5.6 Sol");
  assert.equal(codingModelLabel("gpt-6"), "GPT 6");
  assert.equal(codingModelLabel("grok-4.7-xhigh"), "Grok 4.7 Xhigh");
  assert.equal(codingModelLabel("grok-bot-default"), "Grok Bot");
  assert.equal(codingModelLabel("github_bugbot"), "Bugbot");
  assert.equal(codingModelLabel("agent_review"), "Agent Review");
  assert.equal(codingModelLabel("gemini-3.8-flash-high"), "Gemini 3.8 Flash High");
  assert.equal(codingModelLabel(""), "");
});
