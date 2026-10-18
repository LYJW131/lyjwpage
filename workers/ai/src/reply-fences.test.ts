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
    "```stats", JSON.stringify({ items: [] }), "```",
    "```python", "print(1)", "```",
    "```media", '{"items":[',
  ].join("\n");
  assert.deepEqual(invalidVisuals(replyFences(reply)), [
    { kind: "chart", error: "json" },
    { kind: "stats", error: "shape" },
    { kind: "media", error: "unclosed" },
  ]);
});

test("引用块与列表里的图示也切得出来，引用块去掉 > 再校验，CRLF 换行同样处理", () => {
  const quoted = ["> ```timeline", "> {broken", "> ```"].join("\r\n");
  const listed = ["1. 看图：", "   ```stats", `   ${JSON.stringify(GOD_CHAT_VISUAL_EXAMPLES.stats)}`, "   ```"].join("\n");
  const fences = replyFences(`${quoted}\r\n\r\n${listed}`);
  assert.deepEqual(fences.map((fence) => [fence.language, fence.closed]), [["timeline", true], ["stats", true]]);
  assert.equal(fences[0].source, "{broken");
  assert.deepEqual(invalidVisuals(fences), [{ kind: "timeline", error: "json" }]);
});

test("顶层缩进四格起是缩进代码块，不算图示；列表里的深缩进照样算", () => {
  assert.deepEqual(replyFences(["    ```stats", "    {}", "    ```"].join("\n")), []);
  const nested = ["- 外层", "  - 内层", "      ```chart", "      {}", "      ```"].join("\n");
  assert.deepEqual(replyFences(nested).map((fence) => fence.language), ["chart"]);
});
