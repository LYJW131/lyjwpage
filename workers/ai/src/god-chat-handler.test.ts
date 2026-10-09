import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import type Anthropic from "@anthropic-ai/sdk";
import { GOD_CHAT_TURNSTILE_ACTION, type GodChatEvent } from "@shared/god-chat";
import { GOD_CHAT_TIERS, GOD_CHAT_TIER_INFO, type GodChatEffort } from "@shared/god-chat-tiers";
import type { Env } from "./runtime.ts";
import type { ChatQuota } from "./chat/quota.ts";
import type { AnthropicEgress } from "./chat/egress.ts";

// Node 不提供 cloudflare:workers；这里只替换基类，SDK 与流式序列化使用真实实现。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "cloudflare:workers") return nextResolve(specifier, context);
    return { url: "data:text/javascript,export class DurableObject{}", shortCircuit: true };
  },
});
const { handleChat } = await import("./chat/handler.ts");

function binding<T extends Rpc.DurableObjectBranded>(stub: Partial<DurableObjectStub<T>>): DurableObjectNamespace<T> {
  const id: DurableObjectId = { toString: () => "test", equals: () => true };
  return {
    newUniqueId: () => id,
    idFromName: () => id,
    idFromString: () => id,
    get: () => stub as DurableObjectStub<T>,
    getByName: () => stub as DurableObjectStub<T>,
    jurisdiction: () => { throw new Error("Unexpected jurisdiction call"); },
  };
}

function modelStream(model: string, tool: boolean): Response {
  const events = [
    { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: tool
      ? { type: "tool_use", id: "tool_test", name: "get_site_status", input: {} }
      : { type: "text", text: "", citations: [] } },
    { type: "content_block_delta", index: 0, delta: tool
      ? { type: "input_json_delta", partial_json: JSON.stringify({ views: ["timezone"] }) }
      : { type: "text_delta", text: "Done." } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: tool ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 10 } },
    { type: "message_stop" },
  ];
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

test("三个模型的 SDK 请求都启用消息级 effort，工具续跑继承强度并在签名 trace 中记录", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
  t.after(() => {
    globalThis.fetch = original;
  });
  for (const tier of GOD_CHAT_TIERS) {
    await t.test(tier, async () => {
      const requests: { body: Anthropic.Beta.MessageCreateParamsStreaming; headers: Headers }[] = [];
      const effort: GodChatEffort = tier === "haiku" ? "medium" : GOD_CHAT_TIER_INFO[tier].effort;
      const env: Env = {
        PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
        AI_DEV: "true",
        CHAT_FORCE_TIER: tier === "haiku" ? "haiku-medium" : tier,
        ANTHROPIC_API_KEY: "test-key",
        TURNSTILE_SECRET_KEY: "test-key",
        CHAT_HISTORY_SECRET: "test-seal",
        ALLOWED_ORIGINS: "https://lyjw.me",
        CHAT_QUOTA: binding<ChatQuota>({
          admitVisitor: async () => "ok",
          admitTier: () => {
            if (tier === "haiku") return Promise.resolve("haiku" as const);
            if (tier === "opus") return Promise.resolve("opus" as const);
            return Promise.resolve("fable" as const);
          },
        }),
        ANTHROPIC_EGRESS: binding<AnthropicEgress>({
          fetch: async (request: Request) => {
            const body = await request.json() as Anthropic.Beta.MessageCreateParamsStreaming;
            requests.push({ body, headers: request.headers });
            return modelStream(body.model, requests.length === 1);
          },
        }),
      };
      const response = await handleChat(new Request("https://api.test/api/chat", {
        method: "POST", body: JSON.stringify({ turnstileToken: "test-token", messages: [{ role: "user", content: "What's the timezone?" }] }),
      }), env, {
        readStatus: async () => Response.json({ ok: true, data: { timezone: "Asia/Singapore" } }),
        readDoc: async () => new Response("unused"),
      });
      const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as GodChatEvent);
      assert.equal(requests.length, 2);
      for (const { body, headers } of requests) {
        assert.equal(body.model, GOD_CHAT_TIER_INFO[tier].model);
        assert.equal(body.output_config, undefined);
        assert.deepEqual(body.thinking, { type: "adaptive", display: "summarized" });
        assert.ok(headers.get("anthropic-beta")?.includes("mid-conversation-output-config-2026-07-01"));
        assert.equal(headers.get("anthropic-beta")?.includes("server-side-fallback-2026-07-01"), tier !== "haiku");
        assert.deepEqual(body.messages.filter((m) => m.role === "system"), [{ role: "system", content: [], output_config: { effort } }]);
      }
      assert.deepEqual(requests[1].body.messages.slice(0, requests[0].body.messages.length), requests[0].body.messages);
      assert.ok(events.some((e) => e.type === "text" && e.text === "Done."));
      const seal = events.find((e) => e.type === "seal");
      assert.ok(seal?.type === "seal");
      assert.equal(seal.trace?.effort, effort);
    });
  }
});

test("关闭限流和强制模型只有显式 AI 开发或预览开关才生效", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
  t.after(() => { globalThis.fetch = original; });

  for (const flags of [{}, { AI_DEV: "false", PREVIEW_WORKER: "false" }, { AI_DEV: "true" }, { PREVIEW_WORKER: "true" }]) {
    const dev = flags.AI_DEV === "true" || flags.PREVIEW_WORKER === "true";
    const enforced: boolean[] = [];
    const tiers: string[] = [];
    const response = await handleChat(new Request("https://ai.test/api/chat", {
      method: "POST", body: JSON.stringify({ turnstileToken: "test-token", messages: [{ role: "user", content: "hello" }] }),
    }), {
      ...flags,
      PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
      ANTHROPIC_API_KEY: "test-key",
      TURNSTILE_SECRET_KEY: "test-key",
      CHAT_HISTORY_SECRET: "test-seal",
      ALLOWED_ORIGINS: "https://lyjw.me",
      CHAT_RATE_LIMIT: "off",
      CHAT_FORCE_TIER: "fable",
      CHAT_QUOTA: binding<ChatQuota>({
        admitVisitor: async (_ip, enforce) => { enforced.push(enforce ?? true); return "ok"; },
        admitTier: async (_ip, tier) => { tiers.push(tier); return null; },
      }),
    }, {
      readStatus: async () => new Response("unused"),
      readDoc: async () => new Response("unused"),
    });
    assert.equal(response.status, 429);
    await response.text();
    assert.deepEqual(enforced, [!dev]);
    assert.deepEqual(tiers, dev ? ["fable"] : ["haiku"]);
  }
});
