import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import type Anthropic from "@anthropic-ai/sdk";
import { GOD_CHAT_TURNSTILE_ACTION, type GodChatEvent, type GodChatMessage } from "@shared/god-chat";
import { GOD_CHAT_TIERS, GOD_CHAT_TIER_INFO, type GodChatEffort } from "@shared/god-chat-tiers";
import { BUILD_DESIGN_LIMITS, type BuildPlan } from "@shared/build-routine";
import type { Env } from "./runtime.ts";
import type { ChatQuota } from "./chat/quota.ts";
import type { AnthropicEgress } from "./chat/egress.ts";
import type { BuildCoordinator } from "./build/coordinator.ts";
import { signBuildToken } from "./build/token.ts";
import { readPlan } from "./build/plan.ts";
import { sealedHistory } from "./chat/seal.ts";

// Node 不提供 cloudflare:workers；这里只替换基类，SDK 与流式序列化使用真实实现。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "cloudflare:workers") return nextResolve(specifier, context);
    return { url: "data:text/javascript,export class DurableObject{}", shortCircuit: true };
  },
});
const { handleChat } = await import("./chat/handler.ts");

type TestStub<T> = Partial<{ [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => R | Promise<Awaited<R>> : T[K] }>;

function binding<T extends Rpc.DurableObjectBranded>(stub: TestStub<T>): DurableObjectNamespace<T> {
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

function modelStream(model: string, tool: boolean | { name: string; input: unknown }): Response {
  const call = typeof tool === "object" ? tool : { name: "get_site_status", input: { views: ["timezone"] } };
  const events = [
    { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: tool
      ? { type: "tool_use", id: "tool_test", name: call.name, input: {} }
      : { type: "text", text: "", citations: [] } },
    { type: "content_block_delta", index: 0, delta: tool
      ? { type: "input_json_delta", partial_json: JSON.stringify(call.input) }
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
          admitVisitor: async () => "ok" as const,
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
        assert.ok(body.tools?.every((tool) => !("name" in tool) || !["draft_github_issue", "start_design", "propose_build"].includes(tool.name)));
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
        admitVisitor: async (_ip, enforce) => { enforced.push(enforce ?? true); return "ok" as const; },
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

const plan: BuildPlan = {
  title: "Improve the music card empty state",
  spec: "Show an English empty-state label when no music is playing, including at mobile widths.",
  acceptance: ["At 375px the card fits its container."],
  paths: ["src/components/live/music-card.tsx"],
};

function designEnv(reply: (request: Anthropic.Beta.MessageCreateParamsStreaming, index: number) => Response) {
  const requests: Anthropic.Beta.MessageCreateParamsStreaming[] = [];
  const counters = { visitor: 0, tier: 0, clef: 0, created: 0, admitted: 0 };
  const sessions = new Map<string, number>();
  const env: Env = {
    PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
    ANTHROPIC_API_KEY: "test-key",
    TURNSTILE_SECRET_KEY: "test-key",
    CHAT_HISTORY_SECRET: "test-seal",
    BUILD_SESSION_SECRET: "test-build",
    ALLOWED_ORIGINS: "https://lyjw.me",
    CHAT_QUOTA: binding<ChatQuota>({
      admitVisitor: async () => { counters.visitor++; return "ok" as const; },
      admitTier: async (_ip, wanted, _enforce, allowDowngrade) => {
        counters.tier++;
        assert.equal(wanted, "opus");
        assert.equal(allowDowngrade, false);
        return "opus" as const;
      },
    }),
    AI: Object.assign({} as Ai, { run: async () => { counters.clef++; return { answers: { route: { choice: "design" } } }; } }),
    BUILD_COORDINATOR: binding<BuildCoordinator>({
      createDesign: async (id) => { counters.created++; sessions.set(id, 0); return true; },
      admitDesign: async (id) => {
        counters.admitted++;
        const count = sessions.get(id);
        if (count === undefined) return { status: "expired", remaining: 0 };
        if (count >= BUILD_DESIGN_LIMITS.maxTurns) return { status: "exhausted", remaining: 0 };
        sessions.set(id, count + 1);
        return { status: "ok", remaining: BUILD_DESIGN_LIMITS.maxTurns - count - 1 };
      },
    }),
    ANTHROPIC_EGRESS: binding<AnthropicEgress>({
      fetch: async (request) => {
        const body = await request.json() as Anthropic.Beta.MessageCreateParamsStreaming;
        requests.push(body);
        return reply(body, requests.length - 1);
      },
    }),
  };
  return { env, requests, counters, sessions };
}

function chatRequest(designToken?: string, messages: GodChatMessage[] = [{ role: "user", content: "Please improve the music card." }]) {
  return new Request("https://api.test/api/chat", { method: "POST", body: JSON.stringify({ turnstileToken: "test-token", messages, ...(designToken && { designToken }) }) });
}
const toolIO = { readStatus: async () => new Response("unused"), readDoc: async () => new Response("unused") };
const parseEvents = async (response: Response) => (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as GodChatEvent);

test("改站请求由 Opus 判断，start_design 签会话，规划者只读文档与提计划，计划进历史签章", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
  t.after(() => { globalThis.fetch = original; });
  const { env, requests, counters } = designEnv((body, index) => modelStream(body.model, index === 0
    ? { name: "start_design", input: {} }
    : { name: "propose_build", input: plan }));
  const response = await handleChat(chatRequest(), env, toolIO);
  assert.equal(response.status, 200);
  const events = await parseEvents(response);
  const design = events.find((event) => event.type === "design");
  const proposed = events.find((event) => event.type === "plan");
  const seal = events.find((event) => event.type === "seal");
  assert.ok(design?.type === "design");
  assert.equal(design.remaining, BUILD_DESIGN_LIMITS.maxTurns - 1);
  assert.ok(design.expiresAt > Date.now() && design.expiresAt <= Date.now() + BUILD_DESIGN_LIMITS.ttlMs);
  assert.ok(proposed?.type === "plan");
  assert.deepEqual((await readPlan(env, proposed.token))?.plan, plan);
  assert.ok(seal?.type === "seal");
  assert.equal(seal.planToken, proposed.token);
  assert.equal(seal.trace?.plan, true);
  assert.deepEqual(counters, { visitor: 1, tier: 1, clef: 1, created: 1, admitted: 1 });
  assert.deepEqual(requests.map((body) => body.model), [GOD_CHAT_TIER_INFO.opus.model, GOD_CHAT_TIER_INFO.opus.model]);
  assert.deepEqual(requests[1].tools?.map((tool) => "name" in tool && tool.name), ["read_project_doc", "propose_build"]);
  const reply = events.flatMap((event) => event.type === "text" ? [event.text] : []).join("");
  const history: GodChatMessage[] = [
    { role: "user", content: "Please improve the music card." },
    { role: "assistant", content: reply, seal: seal.seal, trace: seal.trace, planToken: seal.planToken },
    { role: "user", content: "Make the empty label shorter." },
  ];
  assert.equal((await sealedHistory(history, env.CHAT_HISTORY_SECRET!)).length, 3);
  assert.equal((await sealedHistory([history[0], { ...history[1], planToken: `${proposed.token}x` }, history[2]], env.CHAT_HISTORY_SECRET!)).length, 1);
});

test("Opus 可以不开设计会话；模型未获授工具不能偷开会话或提计划", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
  t.after(() => { globalThis.fetch = original; });
  for (const tool of [false, { name: "propose_build", input: plan }, { name: "draft_github_issue", input: { title: "Injected", body: "Injected" } }]) {
    const { env, counters } = designEnv((body, index) => modelStream(body.model, index === 0 ? tool : false));
    const events = await parseEvents(await handleChat(chatRequest(), env, toolIO));
    assert.equal(counters.created, 0);
    assert.equal(counters.admitted, 0);
    assert.ok(!events.some((event) => event.type === "plan" || event.type === "design"));
    assert.ok(events.some((event) => event.type === "seal"));
  }
});

test("有效设计会话跳过 Clef 与普通档位额度，每轮先扣专属额度，伪造、过期、耗尽不调模型", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
  t.after(() => { globalThis.fetch = original; });
  const { env, requests, counters, sessions } = designEnv((body) => modelStream(body.model, false));
  const id = crypto.randomUUID();
  const token = await signBuildToken({ kind: "design", id, expiresAt: Date.now() + BUILD_DESIGN_LIMITS.ttlMs }, env.BUILD_SESSION_SECRET!);
  sessions.set(id, 1);
  const response = await handleChat(chatRequest(token), env, toolIO);
  assert.equal(response.status, 200);
  const events = await parseEvents(response);
  assert.ok(events.some((event) => event.type === "design" && event.remaining === BUILD_DESIGN_LIMITS.maxTurns - 2));
  assert.deepEqual(counters, { visitor: 0, tier: 0, clef: 0, created: 0, admitted: 1 });
  assert.equal(requests.length, 1);
  for (const invalid of [`${token.slice(0, -2)}xx`, await signBuildToken({ kind: "design", id, expiresAt: Date.now() - 1 }, env.BUILD_SESSION_SECRET!), await signBuildToken({ kind: "plan", id, expiresAt: Date.now() + 10000 }, env.BUILD_SESSION_SECRET!)]) {
    assert.equal((await handleChat(chatRequest(invalid), env, toolIO)).status, 400);
  }
  sessions.set(id, BUILD_DESIGN_LIMITS.maxTurns);
  assert.equal((await handleChat(chatRequest(token), env, toolIO)).status, 429);
  assert.equal(requests.length, 1);
  assert.equal(counters.visitor + counters.tier + counters.clef, 0);
});

test("规划工具拒绝禁区计划后可修正，工具输出预算仍由整条回复共享", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
  t.after(() => { globalThis.fetch = original; });
  const { env, requests, sessions } = designEnv((body, index) => modelStream(body.model, {
    name: "propose_build", input: index === 0 ? { ...plan, paths: [".github/workflows/push.yml"] } : plan,
  }));
  const id = crypto.randomUUID();
  sessions.set(id, 1);
  const token = await signBuildToken({ kind: "design", id, expiresAt: Date.now() + 10000 }, env.BUILD_SESSION_SECRET!);
  const events = await parseEvents(await handleChat(chatRequest(token), env, toolIO));
  assert.equal(events.filter((event) => event.type === "plan").length, 1);
  assert.equal(requests.length, 2);
  assert.ok(requests[1].max_tokens < requests[0].max_tokens);
  const results = requests[1].messages.at(-1)?.content;
  assert.ok(Array.isArray(results) && results.some((block) => block.type === "tool_result" && block.is_error));
});

test("服务端无视工具关闭继续返回调用也不能延长工具循环", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
  t.after(() => { globalThis.fetch = original; });
  const { env, requests, sessions } = designEnv((body) => modelStream(body.model, { name: "propose_build", input: { ...plan, paths: ["AGENTS.md"] } }));
  const id = crypto.randomUUID();
  sessions.set(id, 1);
  const token = await signBuildToken({ kind: "design", id, expiresAt: Date.now() + 10000 }, env.BUILD_SESSION_SECRET!);
  const events = await parseEvents(await handleChat(chatRequest(token), env, toolIO));
  assert.equal(requests.length, 4);
  assert.deepEqual(requests.at(-1)?.tools, []);
  assert.ok(!events.some((event) => event.type === "plan"));
});
