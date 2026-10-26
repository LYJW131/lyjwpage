import assert from "node:assert/strict";
import test from "node:test";

import type { ChatSession } from "@/lib/chat-archive";
import { chatCompletion, chatHistoryLines } from "@/lib/chat-completion";
import { GOD_CHAT_PRESETS } from "@shared/god-chat";

const PRESETS = GOD_CHAT_PRESETS.map((preset) => preset.text);

test("草稿为空时补 AI 那句，没有就不补", () => {
  assert.equal(chatCompletion("", "那 TA 在听什么？", PRESETS), "那 TA 在听什么？");
  assert.equal(chatCompletion("", undefined, PRESETS), "");
});

test("按开头匹配示例问题，AI 那句排在最前", () => {
  assert.equal(chatCompletion("LYJW 现", undefined, PRESETS), "在在忙什么？");
  assert.equal(chatCompletion("LYJW 现", "LYJW 现在开心吗", PRESETS), "在开心吗");
});

test("忽略大小写与全半角，补上的部分保留候选句原样", () => {
  assert.equal(chatCompletion("ｌｙｊｗ 现", undefined, PRESETS), "在在忙什么？");
  assert.equal(chatCompletion("hello w", undefined, ["Hello World"]), "orld");
});

test("候选句不比草稿长、以 / 开头或只有空白时不补全", () => {
  assert.equal(chatCompletion("LYJW 现在在忙什么？", undefined, PRESETS), "");
  assert.equal(chatCompletion("/cl", "/clear", ["/clear"]), "");
  assert.equal(chatCompletion("  ", "下一句", PRESETS), "");
});

test("本地历史取各会话的访客消息，新的在前、去重，不含命令与选项卡回答", () => {
  const session = (id: string, updatedAt: number, messages: ChatSession["messages"]): ChatSession => ({ id, title: id, createdAt: 0, updatedAt, messages });
  const sessions = [
    session("old", 1, [{ role: "user", content: "旧问题" }, { role: "assistant", content: "答" }, { role: "user", content: "重复的" }]),
    session("new", 2, [{ role: "user", content: "重复的" }, { role: "user", content: "/usage" }, { role: "user", content: "选了 A", answers: [] }, { role: "user", content: "最新的" }]),
  ];
  assert.deepEqual(chatHistoryLines(sessions), ["最新的", "重复的", "旧问题"]);
});
