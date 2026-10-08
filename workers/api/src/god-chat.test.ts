import assert from "node:assert/strict";
import test from "node:test";

import { GOD_CHAT_LIMITS, parseGodChatRequest } from "@shared/god-chat";
import { downgradeChain } from "@shared/god-chat-tiers";
import { toModelMessages } from "./chat/history.ts";
import { parseRouterAnswer, routerInput } from "./chat/router.ts";
import { parseSiteStatusInput } from "./chat/site-status.ts";

const user = (content: string) => ({ role: "user" as const, content });
const assistant = (content: string) => ({ role: "assistant" as const, content });

test("对话请求：合法历史去首尾空白，以访客消息结尾", () => {
  const parsed = parseGodChatRequest({ turnstileToken: "t", messages: [user(" hi "), assistant("hello"), user("why?")] });
  assert.deepEqual(parsed?.messages, [user("hi"), assistant("hello"), user("why?")]);
});

test("模型的长回复只截断，总量超了从最早的丢，后续对话照样能发", () => {
  const long = "x".repeat(GOD_CHAT_LIMITS.maxReplyChars + 500);
  const parsed = parseGodChatRequest({ turnstileToken: "t", messages: [user("q1"), assistant(long), user("q2")] });
  assert.ok(parsed);
  assert.equal(parsed.messages[1].content.length, GOD_CHAT_LIMITS.maxReplyChars + 1);
  const many = Array.from({ length: 9 }, (_, i) => [user(`u${i}`), assistant("y".repeat(3000))]).flat();
  const fitted = parseGodChatRequest({ turnstileToken: "t", messages: [...many, user("last")] });
  assert.ok(fitted);
  assert.ok(fitted.messages.reduce((n, m) => n + m.content.length, 0) <= GOD_CHAT_LIMITS.maxTotalChars);
  assert.equal(fitted.messages[0].role, "user");
  assert.equal(fitted.messages.at(-1)?.content, "last");
});

test("对话请求：缺 token、陌生角色、超长、以助手结尾都拒绝", () => {
  assert.equal(parseGodChatRequest({ messages: [user("hi")] }), null);
  assert.equal(parseGodChatRequest({ turnstileToken: "t", messages: [{ role: "system", content: "x" }] }), null);
  assert.equal(parseGodChatRequest({ turnstileToken: "t", messages: [user("x".repeat(GOD_CHAT_LIMITS.maxMessageChars + 1))] }), null);
  assert.equal(parseGodChatRequest({ turnstileToken: "t", messages: [user("hi"), assistant("yo")] }), null);
});

test("对话请求：只留最近若干条，且从访客消息开始", () => {
  const long = Array.from({ length: GOD_CHAT_LIMITS.maxMessages + 5 }, (_, i) => (i % 2 ? assistant(`a${i}`) : user(`u${i}`)));
  long.push(user("last"));
  const parsed = parseGodChatRequest({ turnstileToken: "t", messages: long });
  assert.ok(parsed);
  assert.ok(parsed.messages.length <= GOD_CHAT_LIMITS.maxMessages);
  assert.equal(parsed.messages[0].role, "user");
  assert.equal(parsed.messages.at(-1)?.content, "last");
});

test("请求里多带的字段一律丢掉", () => {
  const parsed = parseGodChatRequest({ turnstileToken: "t", messages: [{ role: "user", content: "x", deep: true, tier: "fable" }] });
  assert.deepEqual(parsed?.messages, [user("x")]);
});

test("站点数据工具只认登记过的视图，去重并封顶", () => {
  assert.deepEqual(parseSiteStatusInput({ views: ["nowListening", "bogus", "nowListening", "coding"] }), ["nowListening", "coding"]);
  assert.deepEqual(parseSiteStatusInput({ views: "desktop" }), []);
  assert.equal(parseSiteStatusInput({ views: ["desktop", "server", "charger", "pulse", "coding", "limits"] }).length, 4);
});

test("Clef 路由：只接受已知档位或 refuse，输入只带最近几条上下文", () => {
  assert.equal(parseRouterAnswer({ answers: { route: { choice: "fable" } } }), "fable");
  assert.equal(parseRouterAnswer({ answers: { route: { choice: "refuse" } } }), "refuse");
  assert.equal(parseRouterAnswer({ answers: { route: { choice: "gpt" } } }), null);
  assert.equal(parseRouterAnswer(null), null);
  const input = routerInput(Array.from({ length: 9 }, (_, i) => user(`m${i}`)) as never);
  assert.equal(input.state.latestMessage, "m8");
  assert.equal(input.state.earlierMessages.length, 4);
});

test("额度用完只往下降级，不往上升", () => {
  assert.deepEqual(downgradeChain("fable"), ["fable", "opus", "haiku"]);
  assert.deepEqual(downgradeChain("opus"), ["opus", "haiku"]);
  assert.deepEqual(downgradeChain("haiku"), ["haiku"]);
});

test("回复的工具痕迹只留合法值，作答前插一条说明，下一轮模型知道自己查过", () => {
  const parsed = parseGodChatRequest({
    turnstileToken: "t",
    messages: [
      user("在听什么"),
      { role: "assistant", content: "GHOST", trace: { tier: "haiku", views: ["nowListening", "../x"], searches: ["suisei"], bogus: 1 } },
      { role: "assistant", content: "x", trace: { tier: "gpt" } },
      user("你刚才查了吗"),
    ],
  });
  assert.ok(parsed);
  assert.deepEqual(parsed.messages[1].trace, { tier: "haiku", views: ["nowListening"], searches: ["suisei"] });
  assert.equal(parsed.messages[2].trace, undefined);
  const model = toModelMessages(parsed.messages);
  assert.deepEqual(model.map((m) => m.role), ["user", "system", "assistant", "assistant", "user"]);
  assert.match(String(model[1].content), /Small Fry \(Haiku 5\.5\).*get_site_status for nowListening.*web_search for "suisei"/);
});

test("长回复截断时工具痕迹跟着保留", () => {
  const parsed = parseGodChatRequest({
    turnstileToken: "t",
    messages: [user("q"), { role: "assistant", content: "z".repeat(GOD_CHAT_LIMITS.maxReplyChars + 10), trace: { tier: "fable" } }, user("q2")],
  });
  assert.equal(parsed?.messages[1].trace?.tier, "fable");
});
