import assert from "node:assert/strict";
import test from "node:test";

import { GOD_CHAT_VISUAL_EXAMPLES } from "@shared/god-chat";

import { checkVisuals, replyFences } from "./chat/reply-fences";

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
    "```diagram", JSON.stringify({ layers: [{ nodes: [] }] }), "```",
    "```python", "print(1)", "```",
    "```media", '{"items":[',
  ].join("\n");
  assert.deepEqual(checkVisuals(replyFences(reply)).invalid, [
    { kind: "chart", error: "json" },
    { kind: "diagram", error: "shape" },
    { kind: "media", error: "unclosed" },
  ]);
});

test("引用块与列表里的图示也切得出来，引用块去掉 > 再校验，CRLF 换行同样处理", () => {
  const quoted = ["> ```diagram", "> {broken", "> ```"].join("\r\n");
  const listed = ["1. 看图：", "   ```stats", `   ${JSON.stringify(GOD_CHAT_VISUAL_EXAMPLES.stats)}`, "   ```"].join("\n");
  const fences = replyFences(`${quoted}\r\n\r\n${listed}`);
  assert.deepEqual(fences.map((fence) => [fence.language, fence.closed]), [["diagram", true], ["stats", true]]);
  assert.equal(fences[0].source, "{broken");
  assert.deepEqual(checkVisuals(fences).invalid, [{ kind: "diagram", error: "json" }]);
});

test("顶层缩进四格起是缩进代码块，不算图示；列表里的深缩进照样算", () => {
  assert.deepEqual(replyFences(["    ```stats", "    {}", "    ```"].join("\n")), []);
  const nested = ["- 外层", "  - 内层", "      ```chart", "      {}", "      ```"].join("\n");
  assert.deepEqual(replyFences(nested).map((fence) => fence.language), ["chart"]);
});

test("漏写末尾括号、补齐后画得出的图示单独记成 repaired", () => {
  const reply = ["```stats", '{"items":[{"label":"a","value":"b"}]', "", "```", "```timeline", JSON.stringify(GOD_CHAT_VISUAL_EXAMPLES.timeline), "```"].join("\n");
  assert.deepEqual(checkVisuals(replyFences(reply)), { invalid: [], repaired: ["stats"] });
});

test("回复末尾的 next 预测块不算图示，不记成无效", () => {
  const fences = replyFences(["答案。", "```next", "那 TA 今天听了什么？", "```"].join("\n"));
  assert.deepEqual(fences.map((fence) => fence.language), ["next"]);
  assert.deepEqual(checkVisuals(fences), { invalid: [], repaired: [] });
});
