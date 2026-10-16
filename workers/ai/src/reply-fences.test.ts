import assert from "node:assert/strict";
import test from "node:test";

import { GOD_CHAT_VISUAL_EXAMPLES } from "@shared/god-chat";

import { invalidVisuals, replyFences } from "./chat/reply-fences";

test("围栏按浏览器的规则切：收尾同字符且不短于开头，语言标记不分大小写", () => {
  const reply = ["text", "````Chart", "```", "{}", "````", "~~~html", "<b>x</b>", "~~~", "  ```stats", "{"].join("\n");
  assert.deepEqual(replyFences(reply), [
    { language: "chart", source: "```\n{}", closed: true },
    { language: "html", source: "<b>x</b>", closed: true },
    { language: "stats", source: "{", closed: false },
  ]);
});

test("图示用浏览器同一份校验，过不了的按 JSON、结构、没收尾分开记", () => {
  const good = JSON.stringify(GOD_CHAT_VISUAL_EXAMPLES.timeline);
  const reply = [
    "```timeline", good, "```",
    "```chart", "{nope", "```",
    "```diagram", JSON.stringify({ layers: [{ nodes: [{ id: "a", label: "A" }] }], edges: [{ from: "a", to: "a" }] }), "```",
    "```python", "print(1)", "```",
    "```media", '{"items":[',
  ].join("\n");
  assert.deepEqual(invalidVisuals(replyFences(reply)), [
    { kind: "chart", error: "json" },
    { kind: "diagram", error: "shape" },
    { kind: "media", error: "unclosed" },
  ]);
});
