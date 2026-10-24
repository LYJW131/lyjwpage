import assert from "node:assert/strict";
import test from "node:test";

import type Anthropic from "@anthropic-ai/sdk";
import type { GodChatMessage } from "@shared/god-chat";
import { GOD_CHAT_TIER_INFO } from "@shared/god-chat-tiers";
import type { Env } from "./runtime.ts";
import type { ChatQuota } from "./chat/quota.ts";
import type { AnthropicEgress } from "./chat/egress.ts";
import { sealExchange } from "./chat/seal.ts";
import { binding, chatRequest, deepseekFetch, handleChat, modelStream, parseEvents, toolIO, unexpected } from "./chat/testing/handler-fixture.ts";

function upgradeEnv(thinkFree: boolean) {
  const requests: Anthropic.Beta.MessageCreateParamsStreaming[] = [];
  const admitted: { tier: string; allowDowngrade?: boolean }[] = [];
  const env: Env = {
    PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
    AI_DEV: "true",
    CHAT_FORCE_TIER: "flash",
    ANTHROPIC_API_KEY: "test-key",
    DEEPSEEK_API_KEY: "test-deepseek",
    TURNSTILE_SECRET_KEY: "test-turnstile",
    CHAT_HISTORY_SECRET: "test-seal",
    ALLOWED_ORIGINS: "https://lyjw.me",
    CHAT_QUOTA: binding<ChatQuota>({
      admitVisitor: async () => "ok" as const,
      admitTier: async (_ip, wanted, _enforce, allowDowngrade) => {
        admitted.push({ tier: wanted, allowDowngrade });
        return wanted === "think" && !thinkFree ? null : wanted;
      },
    }),
  };
  const fetch = deepseekFetch(async (request) => {
    const body = await request.json() as Anthropic.Beta.MessageCreateParamsStreaming;
    requests.push(body);
    return requests.length === 1 ? modelStream(body.model, { name: "request_upgrade", input: {} }) : modelStream(body.model, false);
  });
  return { env, requests, admitted, fetch };
}

test("Small Fry 调 request_upgrade 后整轮对话交给 Prophet：扣 think 名额、开思考、不带 Small Fry 的草稿、路由事件改成 Prophet", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const { env, requests, admitted, fetch } = upgradeEnv(true);
  globalThis.fetch = fetch;
  const events = await parseEvents(await handleChat(chatRequest(undefined, [{ role: "user", content: "Prove that sqrt(2) is irrational." }]), env, toolIO));
  assert.deepEqual(admitted.map((entry) => entry.tier), ["flash", "think"]);
  assert.equal(admitted[1].allowDowngrade, false);
  assert.equal(requests.length, 2);
  assert.ok(requests[0].tools?.some((tool) => "name" in tool && tool.name === "request_upgrade"));
  assert.deepEqual(requests[0].thinking, { type: "disabled" });
  assert.equal(requests[1].model, GOD_CHAT_TIER_INFO.think.model);
  assert.deepEqual(requests[1].thinking, { type: "adaptive" });
  assert.ok(requests[1].tools?.every((tool) => !("name" in tool) || tool.name !== "request_upgrade"));
  assert.ok(requests[1].messages.every((message) => message.role !== "assistant"));
  const routes = events.filter((event) => event.type === "route");
  assert.deepEqual(routes.map((event) => event.tier), ["flash", "think"]);
  assert.ok(routes.every((event) => event.downgradedFrom === undefined));
  const seal = events.find((event) => event.type === "seal");
  assert.equal(seal?.trace?.tier, "think");
});

test("Claude 阵容里 Haiku 升档交给 Sonnet：扣 sonnet 名额，追加 Sonnet 的强度", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => unexpected();
  const requests: Anthropic.Beta.MessageCreateParamsStreaming[] = [];
  const admitted: string[] = [];
  const respond = async (request: Request) => {
    const body = await request.json() as Anthropic.Beta.MessageCreateParamsStreaming;
    requests.push(body);
    return requests.length === 1 ? modelStream(body.model, { name: "request_upgrade", input: {} }) : modelStream(body.model, false);
  };
  const env: Env = {
    PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
    AI_DEV: "true",
    CHAT_FORCE_TIER: "haiku",
    ANTHROPIC_API_KEY: "test-key",
    DEEPSEEK_API_KEY: "test-deepseek",
    TURNSTILE_SECRET_KEY: "test-turnstile",
    CHAT_HISTORY_SECRET: "test-seal",
    ALLOWED_ORIGINS: "https://lyjw.me",
    CHAT_QUOTA: binding<ChatQuota>({
      admitVisitor: async () => "ok" as const,
      admitTier: async (_ip, wanted) => { admitted.push(wanted); return wanted; },
    }),
    ANTHROPIC_EGRESS: binding<AnthropicEgress>({ colo: async () => "KIX", fetch: respond }),
  };
  const events = await parseEvents(await handleChat(chatRequest(undefined, [{ role: "user", content: "Prove that sqrt(2) is irrational." }]), env, toolIO));
  assert.deepEqual(admitted, ["haiku", "sonnet"]);
  assert.equal(requests[1].model, GOD_CHAT_TIER_INFO.sonnet.model);
  const efforts = requests[1].messages.filter((message) => message.role === "system" && "output_config" in message).map((message) => (message as { output_config: { effort: string } }).output_config.effort);
  assert.deepEqual(efforts, [GOD_CHAT_TIER_INFO.haiku.effort, GOD_CHAT_TIER_INFO.sonnet.effort]);
  assert.equal(events.find((event) => event.type === "seal")?.trace?.effort, GOD_CHAT_TIER_INFO.sonnet.effort);
});

test("Prophet 没有空位时 request_upgrade 回错误，Small Fry 自己答完", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const { env, requests, fetch } = upgradeEnv(false);
  globalThis.fetch = fetch;
  const events = await parseEvents(await handleChat(chatRequest(undefined, [{ role: "user", content: "Prove that sqrt(2) is irrational." }]), env, toolIO));
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].thinking, { type: "disabled" });
  assert.deepEqual(requests[1].tools, requests[0].tools);
  assert.deepEqual(events.filter((event) => event.type === "route").map((event) => event.tier), ["flash"]);
});

test("示例问题跳过 Clef 按预设定档，示例或 Clef 判出的预取写成一轮已调过的工具、随第一次请求发出", async (t) => {
  const original = globalThis.fetch;
  const exa: typeof fetch = async (input) => String(input).includes("api.exa.ai")
    ? Response.json({ results: [{ url: "https://e.dev/news", title: "News", highlights: ["model launch"] }] })
    : unexpected();
  t.after(() => { globalThis.fetch = original; });
  const run = async (content: string, history: GodChatMessage[] = [], answers: Record<string, unknown> = { route: { choice: "flash" } }) => {
    const requests: Anthropic.Beta.MessageCreateParamsStreaming[] = [];
    const wanted: string[] = [];
    let clef = 0;
    const respond = async (request: Request) => {
      const body = await request.json() as Anthropic.Beta.MessageCreateParamsStreaming;
      requests.push(body);
      return modelStream(body.model, false);
    };
    globalThis.fetch = deepseekFetch(respond, exa);
    const env: Env = {
      PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
      ANTHROPIC_API_KEY: "test-key",
      EXA_API_KEY: "test-exa",
      DEEPSEEK_API_KEY: "test-deepseek",
      TURNSTILE_SECRET_KEY: "test-turnstile",
      CHAT_HISTORY_SECRET: "test-seal",
      ALLOWED_ORIGINS: "https://lyjw.me",
      AI: Object.assign({} as Ai, { run: async (model: string) => { if (model === "@cf/cloudflare/clef") clef++; return { answers }; } }),
      CHAT_QUOTA: binding<ChatQuota>({
        admitVisitor: async () => "ok" as const,
        admitTier: async (_ip, tier) => { wanted.push(tier); return tier; },
      }),
      ANTHROPIC_EGRESS: binding<AnthropicEgress>({ colo: async () => "KIX", fetch: respond }),
    };
    const events = await parseEvents(await handleChat(chatRequest(undefined, [...history, { role: "user", content }]), env, toolIO));
    return { events, requests, wanted, clef };
  };

  const news = await run("这周 AI 圈有什么大新闻？");
  assert.equal(news.clef, 0);
  assert.deepEqual(news.wanted, ["think"]);
  assert.equal(news.requests.length, 1);
  const [call, result] = news.requests[0].messages.slice(-2);
  assert.equal(call.role, "assistant");
  assert.ok(Array.isArray(call.content) && call.content[0].type === "thinking" && call.content[1].type === "tool_use" && call.content[1].name === "web_search");
  assert.ok(Array.isArray(result.content) && result.content[0].type === "tool_result" && typeof result.content[0].content === "string" && result.content[0].content.includes("URL: https://e.dev/news"));
  assert.ok(news.events.some((event) => event.type === "search"));
  assert.ok(news.requests[0].messages.some((message) => message.role === "system" && typeof message.content === "string" && message.content.includes("timeline visual")));
  assert.equal(news.requests[0].mcp_servers, undefined);
  assert.ok(news.requests[0].tools?.every((tool) => tool.type !== "mcp_toolset"));

  const status = await run("LYJW 闲下来都做些什么？");
  assert.equal(status.clef, 0);
  assert.deepEqual(status.wanted, ["flash"]);
  const statusCall = status.requests[0].messages.at(-2)?.content;
  assert.ok(Array.isArray(statusCall) && statusCall[0].type === "tool_use" && statusCall[0].name === "get_site_status");
  assert.ok(status.events.some((event) => event.type === "tool" && event.views.includes("listening")));

  const later = await run("LYJW 闲下来都做些什么？", [{ role: "user", content: "hi" }, { role: "assistant", content: "Done.", seal: await sealExchange("test-seal", "hi", "Done.", undefined) }]);
  assert.equal(later.clef, 1);
  assert.ok(later.requests[0].messages.every((message) => !Array.isArray(message.content) || message.content.every((block) => block.type !== "tool_use")));

  const routed = await run("他最近在听谁的歌", [], {
    route: { choice: "flash" },
    status: { choice: "listening", probabilities: { listening: 0.9 } },
    doc: { choice: "none", probabilities: { none: 0.95 } },
  });
  assert.equal(routed.clef, 1);
  const routedCall = routed.requests[0].messages.at(-2)?.content;
  assert.ok(Array.isArray(routedCall) && routedCall.length === 1 && routedCall[0].type === "tool_use" && routedCall[0].name === "get_site_status");
  assert.ok(routed.events.some((event) => event.type === "tool" && event.views.includes("listening")));
  assert.ok(routed.requests[0].messages.every((message) => message.role !== "system" || typeof message.content !== "string" || !message.content.includes("sample questions")));
});
