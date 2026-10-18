import assert from "node:assert/strict";
import test from "node:test";

import { CODING_AGENT_LABELS, codingAgentLabel } from "./coding-agent-labels.ts";

test("登记的 agent id 显示登记名", () => {
  assert.equal(codingAgentLabel("claude"), "Claude Code");
  assert.equal(codingAgentLabel("grok"), "Grok Build");
  assert.equal(codingAgentLabel("devin"), "Devin CLI");
  assert.equal(Object.keys(CODING_AGENT_LABELS).length, 8);
});

test("没登记的 id 原样显示，原型链上的名字也不算登记过", () => {
  assert.equal(codingAgentLabel("newagent"), "newagent");
  assert.equal(codingAgentLabel("constructor"), "constructor");
  assert.equal(codingAgentLabel("toString"), "toString");
});
