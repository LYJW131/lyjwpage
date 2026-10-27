import assert from "node:assert/strict";
import test from "node:test";

import { GOD_CHAT_NEXT_MAX_CHARS, splitNextSuggestion } from "@shared/god-chat-next";

test("末尾完整的 next 块切出正文和预测句，去掉首尾空白", () => {
  assert.deepEqual(splitNextSuggestion("答案在这里。\n\n```next\n  那 TA 今天听了什么歌？ \n```\n"), { body: "答案在这里。", next: "那 TA 今天听了什么歌？" });
  assert.deepEqual(splitNextSuggestion("Hi.\r\n~~~~Next\r\nWhat else?\r\n~~~~"), { body: "Hi.", next: "What else?" });
});

test("流式输出中没收尾的块也切掉，只有开头时没有预测句", () => {
  assert.deepEqual(splitNextSuggestion("正文\n```next\n还在写"), { body: "正文", next: "还在写" });
  assert.deepEqual(splitNextSuggestion("正文\n```next"), { body: "正文" });
});

test("没有 next 块时原样返回", () => {
  const reply = "看代码：\n```python\nprint(1)\n```";
  assert.deepEqual(splitNextSuggestion(reply), { body: reply });
});

test("预测句超长就丢掉，但块照样从正文切掉", () => {
  assert.deepEqual(splitNextSuggestion(`正文\n\`\`\`next\n${"字".repeat(GOD_CHAT_NEXT_MAX_CHARS + 1)}\n\`\`\``), { body: "正文" });
  assert.deepEqual(splitNextSuggestion(`正文\n\`\`\`next\n${"字".repeat(GOD_CHAT_NEXT_MAX_CHARS)}\n\`\`\``).next?.length, GOD_CHAT_NEXT_MAX_CHARS);
});

test("多行只取第一行；空块没有预测句", () => {
  assert.deepEqual(splitNextSuggestion("正文\n```next\n第一句\n第二句\n```"), { body: "正文", next: "第一句" });
  assert.deepEqual(splitNextSuggestion("正文\n```next\n\n```"), { body: "正文" });
});

test("不在末尾的 next 块不处理", () => {
  const reply = "前面\n```next\n例子\n```\n后面还有正文";
  assert.deepEqual(splitNextSuggestion(reply), { body: reply });
});
